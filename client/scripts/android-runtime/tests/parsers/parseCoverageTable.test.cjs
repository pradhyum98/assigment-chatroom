// client/scripts/android-runtime/tests/parsers/parseCoverageTable.test.cjs
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { parseCoverageTable } = require('../../parseCoverageTable.cjs');
const getRepoRoot = require('../../core/getRepoRoot.cjs');

console.log('[Parse Coverage Table Parser Unit Test] Starting...');

const repoRoot = getRepoRoot();
const docPath = path.join(repoRoot, 'MILESTONE_4_PHASE_2D_RUNTIME_COVERAGE_TABLE.md');

const result = parseCoverageTable(docPath);
assert.strictEqual(result.documentFilename, 'MILESTONE_4_PHASE_2D_RUNTIME_COVERAGE_TABLE.md');
assert.strictEqual(result.parseErrors.length, 0, 'Should parse without errors');

console.log('✓ parseCoverageTable validation passed.');
