// client/scripts/tests/policy-parity.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Policy Parity Unit Test] Starting...');

const cjsPolicy = require('../compiled-policy/viteTransportAdapter.cjs').TRANSPORT_POLICIES;

// Read TS policy source
const tsPath = path.join(__dirname, '../../src/config/transport/transportPolicy.ts');
const tsContent = fs.readFileSync(tsPath, 'utf8');

// Assert both contain identical profiles and fields
const profiles = ['web', 'emulator', 'emulatorProductionTopology', 'production'];
profiles.forEach(profile => {
  const cjsP = cjsPolicy[profile];
  assert(cjsP, `CJS policy must define profile: ${profile}`);
  
  // Verify TS source contains the profile keyword
  assert(tsContent.includes(profile), `TS source must reference profile: ${profile}`);
  
  // Verify matching property configurations
  assert.strictEqual(cjsP.webViewScheme, profile === 'production' || profile === 'emulatorProductionTopology' ? 'https' : 'http');
  assert.strictEqual(cjsP.allowEmulatorRouting, profile !== 'production');
  assert.strictEqual(cjsP.allowCleartext, profile === 'web' || profile === 'emulator');
  assert.strictEqual(cjsP.allowMixedContent, profile === 'web' || profile === 'emulator');
});

console.log('✓ Policy parity validation passed.');
