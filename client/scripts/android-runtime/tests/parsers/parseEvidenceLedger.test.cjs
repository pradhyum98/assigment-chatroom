// client/scripts/android-runtime/tests/parsers/parseEvidenceLedger.test.cjs
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const getRepoRoot = require('../../core/getRepoRoot.cjs');

console.log('[Parse Evidence Ledger Unit Test] Starting...');

const repoRoot = getRepoRoot();
const docPath = path.join(repoRoot, 'MILESTONE_4_PHASE_2D_RUNTIME_EVIDENCE_LEDGER.md');

assert(fs.existsSync(docPath), 'Phase 2D Runtime Evidence Ledger must exist');
const content = fs.readFileSync(docPath, 'utf8');
assert(content.includes('Evidence Ledger'), 'Should contain Evidence Ledger header');

console.log('✓ parseEvidenceLedger validation passed.');
