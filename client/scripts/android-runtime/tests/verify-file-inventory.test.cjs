// client/scripts/android-runtime/tests/verify-file-inventory.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('[File Inventory Unit Test] Starting...');

const inventoryPath = path.join(__dirname, '../fileInventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

assert.strictEqual(inventory.formatVersion, 2, 'Inventory formatVersion must be 2');
assert(inventory.newProductionFiles.length > 0, 'Must define newProductionFiles');
assert(inventory.newTestFiles.length > 0, 'Must define newTestFiles');

console.log('✓ File Inventory validation passed.');
