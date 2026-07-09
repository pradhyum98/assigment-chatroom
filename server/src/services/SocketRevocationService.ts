import { Server, Socket } from 'socket.io';
import { logger } from '../middleware/logger';

/**
 * SocketRevocationService
 *
 * Canonical service for revoking active socket connections after an authorization-
 * invalidating server-side mutation (logout, logout-all, replay detection, identity reset,
 * password reset, admin revocation).
 *
 * ARCHITECTURE NOTES:
 * - userSockets is an in-memory Map owned by socketHandlers.ts and shared with this service.
 * - Revocation is user-scoped because the Socket.IO handshake token only carries userId;
 *   familyId/tokenId are not bound to the socket, making per-family revocation unsafe.
 * - SINGLE-INSTANCE LIMITATION: This service only disconnects sockets on the current
 *   process. In a multi-instance deployment, socket.io/redis-adapter + io.serverSideEmit
 *   would be required for cross-instance revocation. This limitation is documented here
 *   and must be addressed before horizontal-scale deployment.
 *
 * TRANSACTION SEMANTICS:
 * - Callers MUST commit the DB revocation BEFORE calling revokeUser().
 * - If revokeUser() fails (e.g., all sockets already disconnected), the DB revocation
 *   remains authoritative. The failure is logged but does not cause an error response.
 */

/** Terminal event emitted to clients before forced disconnection. */
export const FORCE_DISCONNECT_EVENT = 'force_disconnect' as const;

export interface ForceDisconnectPayload {
  reason: 'logout' | 'logout_all' | 'replay_detected' | 'password_reset' | 'identity_reset' | 'admin_revocation';
  message: string;
}

export class SocketRevocationService {
  private userSockets: Map<string, Set<Socket>>;

  constructor(userSockets: Map<string, Set<Socket>>) {
    this.userSockets = userSockets;
  }

  /**
   * Revoke ALL active socket connections for a given userId.
   *
   * Ordering:
   * 1. Emit `force_disconnect` terminal event so the client can clear state cleanly.
   * 2. Call Socket.IO `socket.disconnect(true)` — the server enforces disconnection
   *    regardless of whether the client handles the event.
   * 3. Remove the socket from the userSockets registry.
   *
   * @param userId   - MongoDB ObjectId string of the user whose sockets should be revoked.
   * @param payload  - Typed reason payload sent to client before disconnect.
   * @returns        - Number of sockets that were disconnected.
   */
  revokeUser(userId: string, payload: ForceDisconnectPayload): number {
    const sockets = this.userSockets.get(userId);

    if (!sockets || sockets.size === 0) {
      logger.debug(`[SocketRevocationService] No active sockets for user ${userId}. Revocation is a no-op.`);
      return 0;
    }

    let disconnectedCount = 0;
    const socketsToRevoke = Array.from(sockets); // snapshot before mutating

    for (const socket of socketsToRevoke) {
      try {
        // 1. Emit terminal event BEFORE disconnect so the client can clear state
        socket.emit(FORCE_DISCONNECT_EVENT, payload);
        // 2. Server-side forced disconnect (client cannot ignore this)
        socket.disconnect(true);
        disconnectedCount++;
      } catch (err) {
        // Individual socket disconnect failure is logged and skipped — never throws
        logger.error(`[SocketRevocationService] Failed to disconnect socket ${socket.id} for user ${userId}:`, err);
      }
    }

    // 3. Remove from registry — the 'disconnect' event handler in socketHandlers
    //    will also clean up, but we remove immediately to prevent race conditions
    //    where a concurrent revocation attempt iterates a stale set.
    this.userSockets.delete(userId);

    logger.info(`[SocketRevocationService] Revoked ${disconnectedCount} socket(s) for user ${userId}. Reason: ${payload.reason}`);
    return disconnectedCount;
  }

  /**
   * Idempotent check: returns true if the user has no active sockets after revocation
   * (or had none to begin with).
   */
  hasActiveSockets(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!(sockets && sockets.size > 0);
  }
}

/**
 * Module-level singleton instance, wired to the shared userSockets map
 * by socketHandlers.ts during setup.
 */
let _instance: SocketRevocationService | null = null;

export const initSocketRevocationService = (userSockets: Map<string, Set<Socket>>): SocketRevocationService => {
  _instance = new SocketRevocationService(userSockets);
  return _instance;
};

export const getSocketRevocationService = (): SocketRevocationService | null => {
  return _instance;
};
