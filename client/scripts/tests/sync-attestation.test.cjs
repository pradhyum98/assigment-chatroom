// client/scripts/tests/sync-attestation.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { computeAssetTreeHash } = require('../cap-gate.cjs');

console.log('[Sync Attestation Unit Test] Starting...');

// Test assetTreeHash on empty or sample directories
const tempDir = path.join(__dirname, 'temp_test_tree');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir);

try {
  // Empty directory case
  const emptyHash = computeAssetTreeHash(tempDir);
  assert.strictEqual(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Empty dir must match standard empty SHA-256');

  // Directory with single file
  fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');
  // Hash matches the golden fixture spec: b7170b89887a7667d50da7904fb197cb97e4c340bce05f109c33fe50f20e1315
  const singleFileHash = computeAssetTreeHash(tempDir);
  assert.strictEqual(singleFileHash, 'b7170b89887a7667d50da7904fb197cb97e4c340bce05f109c33fe50f20e1315', 'Single file a.txt containing hello hash mismatch');

  console.log('✓ Sync Attestation validations passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
