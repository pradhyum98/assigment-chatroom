// client/scripts/tests/release-runtime-security-assertions.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Release Runtime Security Assertions Unit Test] Starting...');

const gradlePath = path.join(__dirname, '../../android/app/build.gradle');
const gradleContent = fs.readFileSync(gradlePath, 'utf8');

// Assert no cleartext traffic permissions are permitted in build.gradle
assert(!gradleContent.includes('usesCleartextTraffic="true"'), 'build.gradle must not set cleartext traffic to true');

console.log('✓ Release Runtime Security Assertions validations passed.');
