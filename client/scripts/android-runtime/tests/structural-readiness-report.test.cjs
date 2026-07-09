// client/scripts/android-runtime/tests/structural-readiness-report.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runValidator } = require('../structural-plan-validator.cjs');

console.log('[Structural Readiness Report Unit Test] Starting...');

// Run validator to ensure clean report exists
runValidator();

const reportPath = path.join(__dirname, '../structural-readiness-report.json');
assert(fs.existsSync(reportPath), 'structural-readiness-report.json must be generated');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert.strictEqual(report.status, 'READY', 'Readiness status must be READY');
assert.strictEqual(report.errors.length, 0, 'Must have zero errors');

console.log('✓ Structural Readiness Report validation passed.');
