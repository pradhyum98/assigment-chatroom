// client/scripts/tests/release-audit.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Release Audit Unit Test] Starting...');

const manifestPath = path.join(__dirname, '../../android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert(!manifest.includes('android:debuggable="true"'), 'Production manifest must not set debuggable to true');
}

console.log('✓ Release Audit validations passed.');
