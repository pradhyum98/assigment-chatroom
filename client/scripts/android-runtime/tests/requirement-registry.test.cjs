// client/scripts/android-runtime/tests/requirement-registry.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('[Requirement Registry Unit Test] Starting...');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../requirementRegistry.json'), 'utf8'));

assert(data.requirements.length >= 94, 'Must have at least 94 requirements');
const ids = data.requirements.map(r => r.requirementId);
for (let i = 1; i <= 94; i++) {
  const expectedId = `R${String(i).padStart(2, '0')}`;
  assert(ids.includes(expectedId), `Missing requirement: ${expectedId}`);
}

console.log('✓ Requirement Registry validation passed.');
