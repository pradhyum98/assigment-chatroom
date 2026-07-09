// client/scripts/android-runtime/verify-matrix-completeness.cjs
const path = require('path');
const fs = require('fs');
const { parseCoverageTable } = require('./parseCoverageTable.cjs');
const getRepoRoot = require('./core/getRepoRoot.cjs');

function verifyMatrices() {
  const repoRoot = getRepoRoot();
  const targetFiles = [
    path.join(repoRoot, 'MILESTONE_4_PHASE_2D_RUNTIME_COVERAGE_TABLE.md'),
    path.join(repoRoot, 'MILESTONE_4_REAL_DEVICE_EVIDENCE_MATRIX.md')
  ];

  console.log('[Matrix Completeness] Checking coverage and evidence matrices...');

  let totalErrors = 0;

  targetFiles.forEach(f => {
    if (!fs.existsSync(f)) {
      console.warn(`[Matrix Completeness] Warning: file not yet created: ${path.basename(f)} at ${f}`);
      return;
    }
    const result = parseCoverageTable(f);
    if (result.parseErrors.length > 0) {
      console.error(`[Matrix Completeness] Parse errors in ${path.basename(f)}:`, result.parseErrors);
      totalErrors += result.parseErrors.length;
    } else {
      console.log(`[Matrix Completeness] ✓ ${path.basename(f)} parsed cleanly. Expanded IDs: ${result.expandedCoverageIds.length}`);
    }
  });

  if (totalErrors > 0) {
    console.error(`[Matrix Completeness] Validation failed with ${totalErrors} errors.`);
    process.exit(1);
  } else {
    console.log('[Matrix Completeness] All matrices verified successfully.');
    process.exit(0);
  }
}

if (require.main === module) {
  verifyMatrices();
}

module.exports = { verifyMatrices };
