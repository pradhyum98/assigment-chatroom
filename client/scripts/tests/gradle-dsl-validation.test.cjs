// client/scripts/tests/gradle-dsl-validation.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[Gradle DSL Unit Test] Starting...');

const gradlePath = path.join(__dirname, '../../android/app/build.gradle');
const gradleContent = fs.readFileSync(gradlePath, 'utf8');

assert(gradleContent.includes('task verifyProductionReleaseConfig'), 'build.gradle must define verifyProductionReleaseConfig');
assert(gradleContent.includes('task verifyAttestationFixture'), 'build.gradle must define verifyAttestationFixture');
assert(gradleContent.includes('tasks.whenTaskAdded'), 'build.gradle must wire the task using tasks.whenTaskAdded');

console.log('✓ Gradle DSL validations passed.');
