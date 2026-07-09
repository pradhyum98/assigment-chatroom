// client/scripts/android-runtime/tests/parsers/parsePhase2CRuntimeMatrix.test.cjs
const assert = require('assert');
const path = require('path');
const { parseCoverageTable } = require('../../parseCoverageTable.cjs');
const getRepoRoot = require('../../core/getRepoRoot.cjs');

console.log('[Parse Phase 2C Runtime Matrix Parser Unit Test] Starting...');

const repoRoot = getRepoRoot();
const docPath = path.join(repoRoot, 'MILESTONE_4_PHASE_2C_HOSTILE_RUNTIME_MATRIX.md');

const result = parseCoverageTable(docPath);
assert.strictEqual(result.documentFilename, 'MILESTONE_4_PHASE_2C_HOSTILE_RUNTIME_MATRIX.md');
assert.strictEqual(result.parseErrors.length, 0, 'Should parse without errors');

console.log('✓ parsePhase2CRuntimeMatrix validation passed.');
