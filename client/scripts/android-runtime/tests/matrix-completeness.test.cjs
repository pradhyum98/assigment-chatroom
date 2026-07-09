// client/scripts/android-runtime/tests/matrix-completeness.test.cjs
const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');

console.log('[Matrix Completeness Unit Test] Starting...');

const scriptPath = path.join(__dirname, '../../android-runtime/verify-matrix-completeness.cjs');
const output = execSync(`node "${scriptPath}"`, { encoding: 'utf8' });

assert(output.includes('All matrices verified successfully'), 'Should print success message');

console.log('✓ Matrix Completeness validations passed.');
