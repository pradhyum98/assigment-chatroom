// client/scripts/security-gate.cjs
const { resolveTransportConfig } = require('./compiled-policy/viteTransportAdapter.cjs');

function runGate() {
  const profile = process.env.APP_BUILD_PROFILE || 'emulator';
  const apiOrigin = process.env.VITE_API_URL || '';
  const socketOrigin = process.env.VITE_SOCKET_URL || '';
  const isHarnessActive = process.env.TEST_HARNESS === 'true';

  console.log(`[Gate A] Vite Build Security Gate starting. Profile: "${profile}"`);

  // Reject missing/unknown profile in production context
  if (profile === 'production') {
    if (!apiOrigin || !socketOrigin) {
      console.error('[Gate A] Error: Production API and Socket URLs must be explicitly provided in environment.');
      process.exit(1);
    }
    if (isHarnessActive) {
      console.error('[Gate A] Error: TEST_HARNESS must not be active in production builds.');
      process.exit(1);
    }

    try {
      resolveTransportConfig(profile, 'web', apiOrigin, socketOrigin);
      console.log('[Gate A] Production build invariants validated successfully.');
    } catch (e) {
      console.error(`[Gate A] Invariant Violation: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Non-production builds: validate that the profile is recognized
    try {
      resolveTransportConfig(profile, 'web', apiOrigin || 'http://localhost:5001/api', socketOrigin || 'http://localhost:5001');
      console.log(`[Gate A] Non-production profile "${profile}" validated successfully.`);
    } catch (e) {
      console.error(`[Gate A] Validation Error: ${e.message}`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  runGate();
}

module.exports = { runGate };
