// client/scripts/android-runtime/structural-plan-validator.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getRepoRoot() {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  if (!root) throw new Error("Empty path returned by git");
  return root;
}

function runValidator() {
  const repoRoot = getRepoRoot();
  const errors = [];
  const warnings = [];

  console.log('[Validator] Starting structural plan validation...');

  // 1. Verify decisionRegistry.cjs is resolved to Option B
  const decisionRegistryPath = path.join(repoRoot, 'client/scripts/android-runtime/decisionRegistry.cjs');
  if (!fs.existsSync(decisionRegistryPath)) {
    errors.push('decisionRegistry.cjs is missing');
  } else {
    const decisionRegistry = require(decisionRegistryPath);
    decisionRegistry.decisions.forEach(d => {
      if (d.approvalState !== 'APPROVED_OPTION_B') {
        errors.push(`Decision ${d.decisionId} is not APPROVED_OPTION_B (current: ${d.approvalState})`);
      }
    });
  }

  // 2. Load and verify registries
  const scenarioRegistryPath = path.join(repoRoot, 'client/scripts/android-runtime/scenarioRegistry.cjs');
  const infraRegistryPath = path.join(repoRoot, 'client/scripts/android-runtime/infrastructureRegistry.cjs');
  const reqRegistryPath = path.join(repoRoot, 'client/scripts/android-runtime/requirementRegistry.json');
  const traceRegistryPath = path.join(repoRoot, 'client/scripts/android-runtime/traceabilityRegistry.json');
  const fileInventoryPath = path.join(repoRoot, 'client/scripts/android-runtime/fileInventory.json');

  let scenarios = [];
  if (!fs.existsSync(scenarioRegistryPath)) {
    errors.push('scenarioRegistry.cjs is missing');
  } else {
    scenarios = require(scenarioRegistryPath).scenarios;
  }

  let infrastructures = [];
  if (!fs.existsSync(infraRegistryPath)) {
    errors.push('infrastructureRegistry.cjs is missing');
  } else {
    infrastructures = require(infraRegistryPath).infrastructures;
  }

  let requirementData = { requirements: [] };
  if (!fs.existsSync(reqRegistryPath)) {
    errors.push('requirementRegistry.json is missing');
  } else {
    requirementData = JSON.parse(fs.readFileSync(reqRegistryPath, 'utf8'));
  }

  let traceabilityData = { traceability: [] };
  if (!fs.existsSync(traceRegistryPath)) {
    errors.push('traceabilityRegistry.json is missing');
  } else {
    traceabilityData = JSON.parse(fs.readFileSync(traceRegistryPath, 'utf8'));
  }

  // Check requirement traceability
  const registeredCaseIds = new Set();
  const scenarioToCaseMap = new Map();

  traceabilityData.traceability.forEach(t => {
    registeredCaseIds.add(t.verificationCaseId);
    if (!scenarioToCaseMap.has(t.authoritativeScenarioId)) {
      scenarioToCaseMap.set(t.authoritativeScenarioId, []);
    }
    scenarioToCaseMap.get(t.authoritativeScenarioId).push(t.verificationCaseId);
  });

  // Verify scenario to trace linkages
  scenarios.forEach(s => {
    if (s.registryStatus === 'UNDEFINED_PLACEHOLDER') {
      errors.push(`Scenario ${s.authoritativeScenarioId} is designated as UNDEFINED_PLACEHOLDER`);
    }
    const linkedCases = scenarioToCaseMap.get(s.authoritativeScenarioId);
    if (!linkedCases) {
      errors.push(`Scenario ${s.authoritativeScenarioId} is not linked to any verificationCaseId in traceabilityRegistry`);
    } else {
      s.verificationCases.forEach(vc => {
        if (!registeredCaseIds.has(vc.verificationCaseId)) {
          errors.push(`Scenario ${s.authoritativeScenarioId} lists case ${vc.verificationCaseId} which is missing from traceabilityRegistry`);
        }
      });
    }
  });

  infrastructures.forEach(infra => {
    const linkedCases = scenarioToCaseMap.get(infra.authoritativeScenarioId);
    if (!linkedCases) {
      errors.push(`Infrastructure ${infra.authoritativeScenarioId} is not linked to any verificationCaseId in traceabilityRegistry`);
    } else {
      infra.verificationCases.forEach(vc => {
        if (!registeredCaseIds.has(vc.verificationCaseId)) {
          errors.push(`Infrastructure ${infra.authoritativeScenarioId} lists case ${vc.verificationCaseId} which is missing from traceabilityRegistry`);
        }
      });
    }
  });

  // Verify all R01-R94 are covered
  const coveredReqs = new Set();
  traceabilityData.traceability.forEach(t => {
    t.requirementIds.forEach(rid => coveredReqs.add(rid));
  });

  requirementData.requirements.forEach(req => {
    if (!coveredReqs.has(req.requirementId)) {
      errors.push(`Requirement ${req.requirementId} is not covered by any verificationCaseId in traceabilityRegistry`);
    }
  });

  // Verify file inventory is complete
  if (!fs.existsSync(fileInventoryPath)) {
    errors.push('fileInventory.json is missing');
  } else {
    const inventory = JSON.parse(fs.readFileSync(fileInventoryPath, 'utf8'));
    // Make sure files exist or will exist (warn if not found yet)
    inventory.newProductionFiles.concat(inventory.newTestFiles).forEach(f => {
      const fullPath = path.join(repoRoot, f);
      if (!fs.existsSync(fullPath)) {
        warnings.push(`File in inventory not yet created: ${f}`);
      }
    });
  }

  // 3. Write readiness report
  const reportPath = path.join(repoRoot, 'client/scripts/android-runtime/structural-readiness-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    status: errors.length === 0 ? 'READY' : 'BLOCKED',
    errors,
    warnings
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[Validator] Finished. Status: ${report.status}. Errors: ${errors.length}, Warnings: ${warnings.length}`);
  if (errors.length > 0) {
    console.error('[Validator] Errors found:', errors);
    process.exit(1);
  }
}

if (require.main === module) {
  runValidator();
}

module.exports = { runValidator };
