const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const clientRoot = path.resolve(__dirname, '..');
const configPath = path.join(clientRoot, 'src/config/production-config.json');

if (!fs.existsSync(configPath)) {
  console.error(`Production config not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const apiUrl = config.apiOrigin;
const socketUrl = config.socketOrigin;

if (!apiUrl || !socketUrl) {
  console.error('production-config.json must define apiOrigin and socketOrigin.');
  process.exit(1);
}

const env = {
  ...process.env,
  APP_BUILD_PROFILE: 'production',
  VITE_API_URL: apiUrl,
  VITE_SOCKET_URL: socketUrl,
};

const commands = [
  ['node', ['scripts/security-gate.cjs']],
  ['npx', ['tsc', '-b']],
  ['npx', ['vite', 'build']],
];

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, {
    cwd: clientRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
