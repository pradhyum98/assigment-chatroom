// client/src/tests/diagnosticsSecrecy.test.ts
import { describe, it, expect } from 'vitest';
import { NativeRuntimeDiagnostics } from '../services/NativeRuntimeDiagnostics';

describe('Diagnostics Secrecy Invariants', () => {
  it('should accept secure snapshots and reject sensitive fields', () => {
    const safe = { platform: 'android', timestamp: Date.now() };
    const unsafeToken = { token: 'secret' };
    const unsafeBearer = { value: 'Bearer tokenabc' };

    expect(NativeRuntimeDiagnostics.verifySecrecy(safe)).toBe(true);
    expect(NativeRuntimeDiagnostics.verifySecrecy(unsafeToken)).toBe(false);
    expect(NativeRuntimeDiagnostics.verifySecrecy(unsafeBearer)).toBe(false);
  });
});
