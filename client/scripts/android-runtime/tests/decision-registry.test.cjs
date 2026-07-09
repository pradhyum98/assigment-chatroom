// client/scripts/android-runtime/tests/decision-registry.test.cjs
const assert = require('assert');
const path = require('path');
const decisionRegistry = require('../decisionRegistry.cjs');

console.log('[Decision Registry Unit Test] Starting...');

assert.strictEqual(decisionRegistry.decisions.length, 2, 'Must have exactly 2 decisions');
decisionRegistry.decisions.forEach(d => {
  assert.strictEqual(d.approvalState, 'APPROVED_OPTION_B', `Decision ${d.decisionId} must be APPROVED_OPTION_B`);
  assert(d.blockingRequirementIds.length > 0, `Decision ${d.decisionId} must block requirements`);
});

console.log('✓ Decision Registry validation passed.');
