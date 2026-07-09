// client/scripts/tests/source-set-isolation.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Source-Set Isolation Unit Test] Starting...');

const mainRes = path.join(__dirname, '../../android/app/src/main/res');
const emulatorRes = path.join(__dirname, '../../android/app/src/emulatorRuntime/res');

// Check that verification_ca.pem is NOT present in src/main/res or src/main/assets
const mainAssetsCA = path.join(__dirname, '../../android/app/src/main/assets/verification_ca.pem');
const mainRawCA = path.join(__dirname, '../../android/app/src/main/res/raw/verification_ca.pem');

assert(!fs.existsSync(mainAssetsCA), 'Test CA must not exist in main assets');
assert(!fs.existsSync(mainRawCA), 'Test CA must not exist in main resources');

console.log('✓ Source-Set Isolation validations passed.');
