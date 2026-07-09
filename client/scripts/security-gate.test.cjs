// client/scripts/security-gate.test.cjs
const assert = require('assert');
const { runGate } = require('./security-gate.cjs');

console.log('[Security Gate Unit Test] Starting...');

const originalExit = process.exit;
const originalEnv = { ...process.env };

let exitCodeCalled = null;
process.exit = (code) => {
  exitCodeCalled = code;
  throw new Error(`ExitCalled:${code}`);
};

try {
  // Test case 1: Unknown profile should fail
  process.env.APP_BUILD_PROFILE = 'invalid_profile';
  exitCodeCalled = null;
  try {
    runGate();
  } catch (e) {
    assert.strictEqual(exitCodeCalled, 1, 'Should call process.exit(1) on invalid profile');
  }

  // Test case 2: Production with loopback should fail
  process.env.APP_BUILD_PROFILE = 'production';
  process.env.VITE_API_URL = 'http://127.0.0.1:5001/api';
  process.env.VITE_SOCKET_URL = 'http://127.0.0.1:5001';
  process.env.TEST_HARNESS = 'false';
  exitCodeCalled = null;
  try {
    runGate();
  } catch (e) {
    assert.strictEqual(exitCodeCalled, 1, 'Should fail production build containing loopback');
  }

  // Test case 3: Production with harness active should fail
  process.env.APP_BUILD_PROFILE = 'production';
  process.env.VITE_API_URL = 'https://chat.engage.tata.com/api';
  process.env.VITE_SOCKET_URL = 'https://chat.engage.tata.com';
  process.env.TEST_HARNESS = 'true';
  exitCodeCalled = null;
  try {
    runGate();
  } catch (e) {
    assert.strictEqual(exitCodeCalled, 1, 'Should fail production build with active test harness');
  }

  // Test case 4: Valid production configurations should pass
  process.env.APP_BUILD_PROFILE = 'production';
  process.env.VITE_API_URL = 'https://chat.engage.tata.com/api';
  process.env.VITE_SOCKET_URL = 'https://chat.engage.tata.com';
  process.env.TEST_HARNESS = 'false';
  exitCodeCalled = null;
  runGate();
  assert.strictEqual(exitCodeCalled, null, 'Valid production config should not trigger exit');

  // Test case 5: Valid emulator configurations should pass
  process.env.APP_BUILD_PROFILE = 'emulator';
  process.env.VITE_API_URL = 'http://10.0.2.2:5001/api';
  process.env.VITE_SOCKET_URL = 'http://10.0.2.2:5001';
  process.env.TEST_HARNESS = 'true';
  exitCodeCalled = null;
  runGate();
  assert.strictEqual(exitCodeCalled, null, 'Valid emulator config should not trigger exit');

  console.log('✓ All security gate test cases passed.');
} finally {
  process.exit = originalExit;
  process.env = originalEnv;
}
