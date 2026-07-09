// client/scripts/android-runtime/verify-traceability-completeness.cjs
const { runValidator } = require('./structural-plan-validator.cjs');

try {
  runValidator();
  console.log('[Traceability Completeness] Validation passed.');
  process.exit(0);
} catch (e) {
  console.error('[Traceability Completeness] Validation failed:', e.message);
  process.exit(1);
}
