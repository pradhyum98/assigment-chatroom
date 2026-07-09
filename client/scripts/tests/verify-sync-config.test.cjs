// client/scripts/tests/verify-sync-config.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Capacitor Config Unit Test] Starting...');

const configPath = path.join(__dirname, '../../capacitor.config.ts');
const configContent = fs.readFileSync(configPath, 'utf8');

// Ensure that it reads APP_BUILD_PROFILE dynamically
assert(configContent.includes('process.env.APP_BUILD_PROFILE'), 'capacitor.config.ts must inspect process.env.APP_BUILD_PROFILE');
assert(configContent.includes('androidScheme: scheme'), 'capacitor.config.ts must map androidScheme to the dynamic scheme');

console.log('✓ Capacitor Config validations passed.');
