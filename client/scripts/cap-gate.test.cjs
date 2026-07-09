// client/scripts/cap-gate.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

console.log('[Capacitor Gate Unit Test] Starting...');

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const distDir = path.join(repoRoot, 'client/dist');
const attestationPath = path.join(distDir, 'sync-attestation.json');

// Ensure distDir exists for test
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Run the cap-gate logic
const capGate = require('./cap-gate.cjs');
capGate.runGate();

// Assert sync-attestation.json is generated
assert(fs.existsSync(attestationPath), 'sync-attestation.json must exist in client/dist after running gate');

// Validate content schema
const att = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
assert.strictEqual(att.formatVersion, 2, 'formatVersion must be 2');
assert(att.apiOrigin, 'apiOrigin must be populated');
assert(att.socketOrigin, 'socketOrigin must be populated');
assert(att.mediaOrigin, 'mediaOrigin must be populated');
assert(att.assetTreeHash, 'assetTreeHash must be populated');
assert(att.gitCommitSha, 'gitCommitSha must be populated');
assert(att.timestampMs > 0, 'timestampMs must be a valid positive long integer');

console.log('✓ Capacitor Gate validations passed.');
