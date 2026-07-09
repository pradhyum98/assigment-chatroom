// client/scripts/android-runtime/tests/gate-e-direct-gradle.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const getRepoRoot = require('../core/getRepoRoot.cjs');

console.log('[Gate E Direct Gradle Unit Test] Starting...');

const repoRoot = getRepoRoot();
const gradlePath = path.join(repoRoot, 'client/android/app/build.gradle');
const content = fs.readFileSync(gradlePath, 'utf8');

assert(content.includes('task verifyAttestationFixture'), 'verifyAttestationFixture must be defined in build.gradle');
assert(content.includes('ValidationInputs'), 'ValidationInputs class must be defined in build.gradle');

console.log('✓ Gate E Direct Gradle validations passed.');
