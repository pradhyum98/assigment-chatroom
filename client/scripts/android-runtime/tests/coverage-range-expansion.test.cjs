// client/scripts/android-runtime/tests/coverage-range-expansion.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCoverageTable } = require('../parseCoverageTable.cjs');

console.log('[Coverage Range Expansion Unit Test] Starting...');

const tempMd = path.join(__dirname, 'temp_coverage_test.md');

function runTestWithContent(markdownText) {
  fs.writeFileSync(tempMd, markdownText, 'utf8');
  try {
    return parseCoverageTable(tempMd);
  } finally {
    if (fs.existsSync(tempMd)) {
      fs.unlinkSync(tempMd);
    }
  }
}

// 1. Test Valid Expansion
const validTable = `
| Scenario ID | Target |
|---|---|
| A01-A03 | Auth checks |
`;
const validRes = runTestWithContent(validTable);
assert.strictEqual(validRes.parseErrors.length, 0, 'Should have no errors on valid expansion');
assert.strictEqual(validRes.parsedIds.length, 3, 'Should expand A01-A03 to 3 IDs');
assert.deepStrictEqual(validRes.parsedIds.map(x => x.id), ['A01', 'A02', 'A03']);

// 2. Test Descending Range Error
const descendingTable = `
| Scenario ID | Target |
|---|---|
| A03-A01 | Descending |
`;
const descRes = runTestWithContent(descendingTable);
assert.strictEqual(descRes.parseErrors.length, 1, 'Should produce 1 error on descending range');
assert.strictEqual(descRes.parseErrors[0].errorCode, 'DESCENDING_RANGE', 'Error code should be DESCENDING_RANGE');

// 3. Test Mixed Prefix Error
const mixedPrefixTable = `
| Scenario ID | Target |
|---|---|
| A01-B03 | Mixed |
`;
const mixedPrefixRes = runTestWithContent(mixedPrefixTable);
assert.strictEqual(mixedPrefixRes.parseErrors.length, 1, 'Should fail mixed prefixes');
assert.strictEqual(mixedPrefixRes.parseErrors[0].errorCode, 'MIXED_PREFIX');

// 4. Test Mixed Padding Error
const mixedPaddingTable = `
| Scenario ID | Target |
|---|---|
| A1-A10 | Mixed padding |
`;
const mixedPaddingRes = runTestWithContent(mixedPaddingTable);
assert.strictEqual(mixedPaddingRes.parseErrors.length, 1, 'Should fail mixed padding widths');
assert.strictEqual(mixedPaddingRes.parseErrors[0].errorCode, 'MIXED_PADDING');

// 5. Test Malformed Range Error
const malformedTable = `
| Scenario ID | Target |
|---|---|
| A01-A02-A03 | Malformed |
`;
const malformedRes = runTestWithContent(malformedTable);
assert.strictEqual(malformedRes.parseErrors.length, 1, 'Should fail double separators');
assert.strictEqual(malformedRes.parseErrors[0].errorCode, 'MALFORMED_RANGE_EXPRESSION');

console.log('✓ Coverage Range Expansion validations passed.');
