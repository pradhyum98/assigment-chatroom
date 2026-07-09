// client/scripts/android-runtime/tests/repo-root-resolver.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const getRepoRoot = require('../core/getRepoRoot.cjs');

console.log('[Repo Root Resolver Unit Test] Starting...');

const root = getRepoRoot();
assert(fs.existsSync(path.join(root, 'client/package.json')), 'client/package.json must exist in git root');
assert(fs.existsSync(path.join(root, 'server/package.json')), 'server/package.json must exist in git root');

console.log('✓ Repo Root Resolver validation passed.');
