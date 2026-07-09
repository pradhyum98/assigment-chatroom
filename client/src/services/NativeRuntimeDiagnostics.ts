import { platformService } from '../platform/PlatformService';
import { syncEngine } from './SyncEngine';
import { socketService } from './socket';

export interface DiagnosticsSnapshot {
  platform: 'web' | 'android' | 'ios';
  isNative: boolean;
  syncGeneration: number;
  socketConnected: boolean;
  outboxPendingCount: number;
  indexedDbVersion: number;
  timestamp: number;
}

export class NativeRuntimeDiagnostics {
  /**
   * Safe snapshot for debugging. Excludes all credentials, tokens, cookies,
   * private keys, room keys, and message content.
   */
  static getSafeSnapshot(): DiagnosticsSnapshot | null {
    // Hard check: diagnostics are compiled/executed ONLY in development/debug environments
    const isEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DIAGNOSTICS === 'true';
    if (!isEnabled) {
      return null;
    }

    try {
      const caps = platformService.getCapabilities();
      const generation = (syncEngine as any).generationRef?.current ?? 0;
      const socketConn = socketService.connect()?.connected ?? false;

      return {
        platform: caps.platform,
        isNative: caps.isNative,
        syncGeneration: generation,
        socketConnected: socketConn,
        outboxPendingCount: 0,
        indexedDbVersion: 1,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error('[NativeRuntimeDiagnostics] Failed to collect safe snapshot:', err);
      return null;
    }
  }

  /**
   * Asserts that a diagnostics snapshot does not contain any sensitive secret keys,
   * private keys, tokens, or raw message text.
   */
  static verifySecrecy(snapshot: any): boolean {
    if (!snapshot) return true;

    const sensitiveFields = [
      'token', 'accessToken', 'refreshToken', 'cookie', 'password', 'key',
      'privateKey', 'roomKey', 'secret', 'content', 'text', 'message'
    ];

    const keys = Object.keys(snapshot);
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      const isSensitiveKey = sensitiveFields.some(field => lowerKey.includes(field)) ||
        lowerKey === 'iv' ||
        lowerKey.endsWith('_iv') ||
        lowerKey.endsWith('iv');

      if (isSensitiveKey) {
        return false;
      }
      
      const val = snapshot[key];
      if (typeof val === 'string') {
        const lowerVal = val.toLowerCase();
        if (lowerVal.includes('bearer') || lowerVal.includes('eyj') || lowerVal.includes('private')) {
          return false;
        }
      }
    }
    return true;
  }
}
export default NativeRuntimeDiagnostics;
