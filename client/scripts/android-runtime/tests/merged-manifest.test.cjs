// client/scripts/android-runtime/tests/merged-manifest.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const getRepoRoot = require('../core/getRepoRoot.cjs');

console.log('[Merged Manifest Unit Test] Starting...');

const repoRoot = getRepoRoot();
const manifestPath = path.join(repoRoot, 'client/android/app/src/main/AndroidManifest.xml');

assert(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist');
const content = fs.readFileSync(manifestPath, 'utf8');

// The production version must not have debuggable enabled.
assert(!content.includes('android:debuggable="true"'), 'Production android:debuggable="true" is forbidden');

console.log('✓ Merged Manifest validations passed.');
