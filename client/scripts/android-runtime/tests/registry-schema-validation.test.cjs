// client/scripts/android-runtime/tests/registry-schema-validation.test.cjs
const assert = require('assert');
const path = require('path');
const scenarioRegistry = require('../scenarioRegistry.cjs');
const infrastructureRegistry = require('../infrastructureRegistry.cjs');

console.log('[Registry Schema Validation Unit Test] Starting...');

scenarioRegistry.scenarios.forEach(s => {
  assert(s.authoritativeScenarioId, 'Scenario must have authoritativeScenarioId');
  assert(s.namespace, 'Scenario must have namespace');
  assert(s.definingSourceDocument, 'Scenario must have definingSourceDocument');
  assert(s.definingSourceLocation, 'Scenario must have definingSourceLocation');
  assert(s.owningSuite, 'Scenario must have owningSuite');
  assert(s.requiredExecutionClass, 'Scenario must have requiredExecutionClass');
  assert(s.verificationCases && s.verificationCases.length > 0, 'Scenario must have verificationCases');
});

infrastructureRegistry.infrastructures.forEach(infra => {
  assert(infra.authoritativeScenarioId, 'Infrastructure must have authoritativeScenarioId');
  assert(infra.description, 'Infrastructure must have description');
  assert(infra.owningSuite, 'Infrastructure must have owningSuite');
  assert(infra.verificationCases && infra.verificationCases.length > 0, 'Infrastructure must have verificationCases');
});

console.log('✓ Registry Schema Validation passed.');
