// client/scripts/cap-gate.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function getRepoRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest();
}

function computeStringSha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function computeAssetTreeHash(distDir) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(distDir, fullPath).replace(/\\/g, '/');

      // Match exclusions
      if (relPath === 'sync-attestation.json' || relPath.endsWith('.tmp') || relPath.includes('.DS_Store')) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        const symTarget = fs.readlinkSync(fullPath);
        const resolvedTarget = path.normalize(path.resolve(path.dirname(fullPath), symTarget));
        if (!fs.existsSync(resolvedTarget)) {
          throw new Error(`Dangling symlink encountered: ${relPath}`);
        }
        if (!resolvedTarget.startsWith(path.normalize(distDir))) {
          throw new Error(`Symlink target escapes root: ${relPath}`);
        }
        const targetString = path.relative(distDir, resolvedTarget).replace(/\\/g, '/');
        files.push({ path: relPath, targetString, isSym: true });
      } else if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push({ path: relPath, fullPath, isSym: false });
      }
    }
  }

  walk(distDir);

  if (files.length === 0) {
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }

  // Lexicographical sort using unsigned bytes (UTF-8 bytes of path)
  files.sort((a, b) => {
    const aBytes = Buffer.from(a.path, 'utf8');
    const bBytes = Buffer.from(b.path, 'utf8');
    const minLen = Math.min(aBytes.length, bBytes.length);
    for (let i = 0; i < minLen; i++) {
      if (aBytes[i] !== bBytes[i]) {
        return aBytes[i] - bBytes[i];
      }
    }
    return aBytes.length - bBytes.length;
  });

  // Write records to byte stream using strict binary framing
  const buffers = [];
  for (const entry of files) {
    const pathBytes = Buffer.from(entry.path, 'utf8');
    const header = Buffer.alloc(3); // 1 byte type + 2 bytes length
    header[0] = entry.isSym ? 0x02 : 0x01;
    header.writeUInt16BE(pathBytes.length, 1);
    buffers.push(header);
    buffers.push(pathBytes);

    if (!entry.isSym) {
      const fileHash = computeSha256(entry.fullPath);
      buffers.push(fileHash); // 32 bytes binary
    } else {
      const targetBytes = Buffer.from(entry.targetString, 'utf8');
      const targetLen = Buffer.alloc(2);
      targetLen.writeUInt16BE(targetBytes.length, 0);
      buffers.push(targetLen);
      buffers.push(targetBytes);
    }
  }

  const finalStream = Buffer.concat(buffers);
  return crypto.createHash('sha256').update(finalStream).digest('hex');
}

function runGate() {
  console.log('[Gate B] Starting compile-time attestation hash binding...');
  const repoRoot = getRepoRoot();
  const buildProfile = process.env.APP_BUILD_PROFILE || 'emulator';
  const rawApiUrl = process.env.VITE_API_URL || 'http://localhost:5001/api';
  const apiOrigin = new URL(rawApiUrl).origin;
  const rawSocketUrl = process.env.VITE_SOCKET_URL || 'http://localhost:5001';
  const socketOrigin = new URL(rawSocketUrl).origin;
  const mediaOrigin = apiOrigin;

  const gitCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const distDir = path.join(repoRoot, 'client/dist');

  if (!fs.existsSync(distDir)) {
    console.error(`[Gate B] Error: dist/ directory not found at: ${distDir}`);
    process.exit(1);
  }

  // File paths for attestation inputs
  const productionConfigPath = path.join(repoRoot, 'client/src/config/production-config.json');
  const policySourceFiles = [
    path.join(repoRoot, 'client/src/config/transport/types.ts'),
    path.join(repoRoot, 'client/src/config/transport/transportPolicy.ts'),
    path.join(repoRoot, 'client/src/config/transport/resolveTransportConfig.ts')
  ];
  const compiledPolicyPath = path.join(repoRoot, 'client/scripts/compiled-policy/viteTransportAdapter.cjs');
  const capacitorConfigPath = path.join(repoRoot, 'client/capacitor.config.ts');

  // Verify files exist or write fallback config if needed
  if (!fs.existsSync(productionConfigPath)) {
    // Generate default production-config.json if not present
    fs.writeFileSync(productionConfigPath, JSON.stringify({
      apiOrigin: "https://chat.engage.tata.com",
      socketOrigin: "https://chat.engage.tata.com",
      mediaOrigin: "https://chat.engage.tata.com"
    }, null, 2));
  }

  const assetTreeHash = computeAssetTreeHash(distDir);
  const productionConfigHash = crypto.createHash('sha256').update(fs.readFileSync(productionConfigPath)).digest('hex');

  let policySourceText = '';
  for (const f of policySourceFiles) {
    policySourceText += fs.readFileSync(f, 'utf8');
  }
  const policySourceHash = computeStringSha256(policySourceText);
  const compiledPolicyHash = crypto.createHash('sha256').update(fs.readFileSync(compiledPolicyPath)).digest('hex');
  const capacitorConfigHash = crypto.createHash('sha256').update(fs.readFileSync(capacitorConfigPath)).digest('hex');

  const attestation = {
    formatVersion: 2,
    buildProfile,
    apiOrigin,
    socketOrigin,
    mediaOrigin,
    capacitorScheme: (buildProfile === 'production') ? 'https' : 'http',
    gitCommitSha,
    assetTreeHash,
    productionConfigHash,
    policySourceHash,
    compiledPolicyHash,
    capacitorConfigHash,
    timestampMs: Date.now()
  };

  const attestationPath = path.join(distDir, 'sync-attestation.json');
  fs.writeFileSync(attestationPath, JSON.stringify(attestation, null, 2));
  console.log(`[Gate B] sync-attestation.json generated at ${attestationPath}`);
}

if (require.main === module) {
  runGate();
}

module.exports = { computeAssetTreeHash, runGate };
