// client/scripts/android-runtime/core/getRepoRoot.cjs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = function getRepoRoot() {
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    if (!root) throw new Error("Empty path returned by git");
    if (!fs.existsSync(path.join(root, 'client/package.json')) || 
        !fs.existsSync(path.join(root, 'server/package.json'))) {
      throw new Error("Missing package.json files at root");
    }
    return root;
  } catch (e) {
    throw new Error(`Git root resolution failed: ${e.message}`);
  }
};
