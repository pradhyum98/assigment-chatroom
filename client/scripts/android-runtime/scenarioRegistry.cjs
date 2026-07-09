// client/scripts/android-runtime/scenarioRegistry.cjs
module.exports = {
  scenarios: [
    // Preflight
    {
      authoritativeScenarioId: 'PROD-TOPOLOGY-COOKIE-PARTY-PREFLIGHT',
      namespace: 'PREFLIGHT',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§5.2',
      owningSuite: 'auth.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'BLOCKING',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: 'PROD-TOPOLOGY-COOKIE-PARTY-PREFLIGHT',
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: 'Empirically verify H0 and H1 cookie semantics on same APK',
        requirementIds: ["R94"]
      }]
    },
    // A01-A11
    ...['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'AUTH_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'auth.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R57"]
      }]
    })),
    // AUTH-1 to AUTH-10
    ...Array.from({length: 10}, (_, i) => `AUTH-${i+1}`).map(id => ({
      authoritativeScenarioId: id,
      namespace: 'AUTH_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'auth.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R58"]
      }]
    })),
    // S01-S05, S16, S17
    ...['S01', 'S02', 'S03', 'S04', 'S05', 'S16', 'S17'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'SOCKET_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'socket.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R59"]
      }]
    })),
    // SOCK-1 to SOCK-4
    ...['SOCK-1', 'SOCK-2', 'SOCK-3', 'SOCK-4'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'SOCKET_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'socket.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R60"]
      }]
    })),
    // L01-L03, L13
    ...['L01', 'L02', 'L03', 'L13'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'LIFECYCLE_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'life.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R61"]
      }]
    })),
    // LIFE-1 to LIFE-6
    ...['LIFE-1', 'LIFE-2', 'LIFE-3', 'LIFE-4', 'LIFE-5', 'LIFE-6'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'LIFECYCLE_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'life.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R62"]
      }]
    })),
    // D01, D10, D12, D15, D25
    ...['D01', 'D10', 'D12', 'D15', 'D25'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'DIRECT_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'direct.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R63"]
      }]
    })),
    // IDB-1 to IDB-4
    ...['IDB-1', 'IDB-2', 'IDB-3', 'IDB-4'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'INDEXEDDB_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: id === 'IDB-2' ? '§19' : '§16.2',
      owningSuite: 'canonicalSync.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: id === 'IDB-2' ? 'BASE-IDB-2-POST-LOGOUT-ISOLATION' : `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: [id === 'IDB-2' ? 'R71' : 'R64']
      }]
    })),
    // E01, E05, E21
    ...['E01', 'E05', 'E21'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'IDENTITY_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'identity.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R65"]
      }]
    })),
    // E2EE-1 to E2EE-5
    ...['E2EE-1', 'E2EE-2', 'E2EE-3', 'E2EE-4', 'E2EE-5'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'E2EE_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'identity.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R66"]
      }]
    })),
    // O01
    {
      authoritativeScenarioId: 'O01',
      namespace: 'ORIGIN_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'identity.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: 'RUNTIME-CASE-O01',
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: 'Runtime check for scenario O01',
        requirementIds: ["R67"]
      }]
    },
    // E1 to E5
    ...['E1', 'E2', 'E3', 'E4', 'E5'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'DIAG_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'identity.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R68"]
      }]
    })),
    // ACC-1, ACC-2
    ...['ACC-1', 'ACC-2'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'ACC_PROD',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'identity.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'ANDROID_PRODUCTION_EQUIVALENT_HTTPS',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R69"]
      }]
    })),
    // D1 to D20 (D1, D2, ..., D20 - no hyphen)
    ...Array.from({length: 20}, (_, i) => `D${i+1}`).map(id => ({
      authoritativeScenarioId: id,
      namespace: 'SYNC_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'canonicalSync.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Runtime check for scenario ${id}`,
        requirementIds: ["R70"]
      }]
    })),
    // STRESS-1, STRESS-2
    ...['STRESS-1', 'STRESS-2'].map(id => ({
      authoritativeScenarioId: id,
      namespace: 'STRESS_LOOPBACK',
      definingSourceDocument: 'MILESTONE_4_PHASE_2E_FINAL_PLAN.md',
      definingSourceLocation: '§16.2',
      owningSuite: 'canonicalSync.runtime.cjs',
      registryStatus: 'DEFINED',
      coverageSourceDocuments: ['MILESTONE_4_PHASE_2E_FINAL_PLAN.md'],
      crossReferences: [],
      legacyEvidenceReferenceIds: [],
      severity: 'CRITICAL',
      requiredExecutionClass: 'ANDROID_RUNTIME',
      verificationCases: [{
        verificationCaseId: `RUNTIME-CASE-${id}`,
        topology: 'LOOPBACK_HTTP',
        description: `Stress check for scenario ${id}`,
        requirementIds: [id === 'STRESS-1' ? 'R72' : 'R73']
      }]
    }))
  ]
};
