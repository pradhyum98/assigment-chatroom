import { describe, it, expect } from 'vitest';
import { NativeRuntimeDiagnostics } from '../services/NativeRuntimeDiagnostics';

describe('Milestone 4 — Native Diagnostics Secrecy Verification', () => {
  it('verifySecrecy accepts valid non-secret metadata snapshots', () => {
    const validSnapshot = {
      platform: 'android',
      isNative: true,
      syncGeneration: 3,
      socketConnected: true,
      outboxPendingCount: 0,
      timestamp: Date.now()
    };

    expect(NativeRuntimeDiagnostics.verifySecrecy(validSnapshot)).toBe(true);
  });

  it('verifySecrecy rejects keys with sensitive labels (token, key, password)', () => {
    const bad1 = { platform: 'web', accessToken: 'eyJ...' };
    const bad2 = { platform: 'web', privateKey: 'RSA-Key' };
    const bad3 = { platform: 'web', passwordField: 'mypassword' };
    const bad4 = { platform: 'web', roomKey: '123' };

    expect(NativeRuntimeDiagnostics.verifySecrecy(bad1)).toBe(false);
    expect(NativeRuntimeDiagnostics.verifySecrecy(bad2)).toBe(false);
    expect(NativeRuntimeDiagnostics.verifySecrecy(bad3)).toBe(false);
    expect(NativeRuntimeDiagnostics.verifySecrecy(bad4)).toBe(false);
  });

  it('verifySecrecy rejects values containing bearer tokens or private keys', () => {
    const badValue1 = { platform: 'web', customMeta: 'Bearer eyJ...' };
    const badValue2 = { platform: 'web', customMeta: 'My PRIVATE credentials' };

    expect(NativeRuntimeDiagnostics.verifySecrecy(badValue1)).toBe(false);
    expect(NativeRuntimeDiagnostics.verifySecrecy(badValue2)).toBe(false);
  });
});
