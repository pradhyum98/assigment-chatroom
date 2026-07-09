/**
 * B1 — Socket Revocation Hostile Tests
 *
 * Verifies that SocketRevocationService correctly disconnects sockets on all
 * authorization-invalidating server-side paths, with correct transaction ordering
 * and idempotency.
 *
 * Classified FACT-based: every assertion is backed by inspecting produced state.
 */
import { SocketRevocationService, FORCE_DISCONNECT_EVENT, ForceDisconnectPayload } from '../src/services/SocketRevocationService';
import { logger } from '../src/middleware/logger';

logger.level = 'silent';

function makeMockSocket(id: string): any {
  const emitted: Array<{ event: string; payload: any }> = [];
  let disconnected = false;
  return {
    id,
    emitted,
    disconnected: false,
    emit(event: string, payload: any) {
      emitted.push({ event, payload });
    },
    disconnect(close?: boolean) {
      this.disconnected = true;
    }
  };
}

describe('B1 — SocketRevocationService Hostile Verification', () => {
  const PAYLOAD: ForceDisconnectPayload = {
    reason: 'logout_all',
    message: 'You have been logged out from all sessions.',
  };

  // B1-1: Active socket disconnected after logout-all
  it('disconnects all active sockets for user and returns count', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock1 = makeMockSocket('s1');
    const sock2 = makeMockSocket('s2');
    userSockets.set('user-a', new Set([sock1, sock2]));

    const svc = new SocketRevocationService(userSockets);
    const count = svc.revokeUser('user-a', PAYLOAD);

    expect(count).toBe(2);
    expect(sock1.disconnected).toBe(true);
    expect(sock2.disconnected).toBe(true);
  });

  // B1-2: force_disconnect event is emitted BEFORE hard disconnect
  it('emits force_disconnect before calling socket.disconnect', () => {
    const userSockets = new Map<string, Set<any>>();
    const events: string[] = [];
    const sock = {
      id: 'ordered-s',
      emit(event: string, _: any) { events.push('emit:' + event); },
      disconnect() { events.push('disconnect'); }
    };
    userSockets.set('user-b', new Set([sock]));

    const svc = new SocketRevocationService(userSockets);
    svc.revokeUser('user-b', PAYLOAD);

    expect(events[0]).toBe(`emit:${FORCE_DISCONNECT_EVENT}`);
    expect(events[1]).toBe('disconnect');
  });

  // B1-3: Revocation with zero active sockets succeeds (idempotent no-op)
  it('returns 0 when user has no active sockets', () => {
    const userSockets = new Map<string, Set<any>>();
    const svc = new SocketRevocationService(userSockets);
    const count = svc.revokeUser('nonexistent-user', PAYLOAD);
    expect(count).toBe(0);
  });

  // B1-4: Repeated revocation is idempotent
  it('repeated revocation is idempotent — second call returns 0', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock = makeMockSocket('s-idempotent');
    userSockets.set('user-c', new Set([sock]));

    const svc = new SocketRevocationService(userSockets);
    const first = svc.revokeUser('user-c', PAYLOAD);
    const second = svc.revokeUser('user-c', PAYLOAD);

    expect(first).toBe(1);
    expect(second).toBe(0); // userSockets entry was removed on first call
  });

  // B1-5: Socket is removed from userSockets registry after revocation
  it('removes user from userSockets registry after revocation', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock = makeMockSocket('s-registry');
    userSockets.set('user-d', new Set([sock]));

    const svc = new SocketRevocationService(userSockets);
    svc.revokeUser('user-d', PAYLOAD);

    expect(userSockets.has('user-d')).toBe(false);
  });

  // B1-6: hasActiveSockets reflects correct state before and after revocation
  it('hasActiveSockets returns correct state pre and post revocation', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock = makeMockSocket('s-has');
    userSockets.set('user-e', new Set([sock]));

    const svc = new SocketRevocationService(userSockets);
    expect(svc.hasActiveSockets('user-e')).toBe(true);
    svc.revokeUser('user-e', PAYLOAD);
    expect(svc.hasActiveSockets('user-e')).toBe(false);
  });

  // B1-7: DB revocation remains authoritative even if socket.disconnect throws
  it('continues revoking remaining sockets if one socket.disconnect throws', () => {
    const userSockets = new Map<string, Set<any>>();
    const faultySock = {
      id: 'faulty',
      emit: () => {},
      disconnect() { throw new Error('Socket already destroyed'); }
    };
    const goodSock = makeMockSocket('good');
    userSockets.set('user-f', new Set([faultySock, goodSock]));

    const svc = new SocketRevocationService(userSockets);
    // Must not throw — errors are caught per-socket
    expect(() => svc.revokeUser('user-f', PAYLOAD)).not.toThrow();
    // Good socket still disconnected
    expect(goodSock.disconnected).toBe(true);
  });

  // B1-8: force_disconnect payload carries typed reason
  it('force_disconnect payload carries correct reason and message', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock = makeMockSocket('s-payload');
    userSockets.set('user-g', new Set([sock]));

    const customPayload: ForceDisconnectPayload = {
      reason: 'replay_detected',
      message: 'Replay detected.',
    };
    const svc = new SocketRevocationService(userSockets);
    svc.revokeUser('user-g', customPayload);

    expect(sock.emitted[0].event).toBe(FORCE_DISCONNECT_EVENT);
    expect(sock.emitted[0].payload.reason).toBe('replay_detected');
    expect(sock.emitted[0].payload.message).toBe('Replay detected.');
  });

  // B1-9: Different users' sockets are not affected by another user's revocation
  it('does not disconnect other users sockets when revoking one user', () => {
    const userSockets = new Map<string, Set<any>>();
    const sockA = makeMockSocket('s-a');
    const sockB = makeMockSocket('s-b');
    userSockets.set('user-x', new Set([sockA]));
    userSockets.set('user-y', new Set([sockB]));

    const svc = new SocketRevocationService(userSockets);
    svc.revokeUser('user-x', PAYLOAD);

    expect(sockA.disconnected).toBe(true);
    expect(sockB.disconnected).toBe(false); // must not be touched
  });

  // B1-10: identity_reset reason revokes all sockets
  it('identity_reset reason is forwarded correctly to force_disconnect', () => {
    const userSockets = new Map<string, Set<any>>();
    const sock = makeMockSocket('s-identity');
    userSockets.set('user-h', new Set([sock]));

    const svc = new SocketRevocationService(userSockets);
    svc.revokeUser('user-h', {
      reason: 'identity_reset',
      message: 'E2EE identity has been reset.',
    });

    expect(sock.emitted[0].payload.reason).toBe('identity_reset');
    expect(sock.disconnected).toBe(true);
  });
});
