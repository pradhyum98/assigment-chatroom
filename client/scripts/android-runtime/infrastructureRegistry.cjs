// client/scripts/android-runtime/infrastructureRegistry.cjs
module.exports = {
  infrastructures: [
    {
      authoritativeScenarioId: 'INFRA-RESOLVER',
      description: 'Pure resolver imports verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-RESOLVER-IMPORTS-ISOLATION', requirementIds: ['R01'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-POLICY',
      description: 'Transport policy rules verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-POLICY-PARITY', requirementIds: ['R02'] },
        { verificationCaseId: 'BASE-POLICY-MISSING-PROFILE-FAIL', requirementIds: ['R03'] },
        { verificationCaseId: 'BASE-POLICY-PROD-INVARIANTS', requirementIds: ['R04'] },
        { verificationCaseId: 'BASE-POLICY-EMULATOR-INVARIANTS', requirementIds: ['R05'] },
        { verificationCaseId: 'BASE-POLICY-WEB-INVARIANTS', requirementIds: ['R06'] },
        { verificationCaseId: 'BASE-POLICY-COMPILER-RUN-BEFORE-BUILD', requirementIds: ['R07'] },
        { verificationCaseId: 'BASE-POLICY-STALE-DETECTION', requirementIds: ['R08'] },
        { verificationCaseId: 'BASE-IMPORT-API-TRANSPORT', requirementIds: ['R09'] },
        { verificationCaseId: 'BASE-IMPORT-SOCKET-TRANSPORT', requirementIds: ['R10'] },
        { verificationCaseId: 'BASE-IMPORT-CHATWINDOW-TRANSPORT', requirementIds: ['R11'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-GATES',
      description: 'Vite, Capacitor, and Gradle compile/bundle gates verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-GATE-A-MISSING-PROFILE', requirementIds: ['R12'] },
        { verificationCaseId: 'BASE-GATE-A-LOOPBACK-REJECTION', requirementIds: ['R13'] },
        { verificationCaseId: 'BASE-GATE-A-HARNESS-REJECTION', requirementIds: ['R14'] },
        { verificationCaseId: 'BASE-GATE-B-SYNC-WRAPPER', requirementIds: ['R15'] },
        { verificationCaseId: 'BASE-GATE-B-COPY-WRAPPER', requirementIds: ['R16'] },
        { verificationCaseId: 'BASE-GATE-C-STALE-ATTESTATION', requirementIds: ['R17'] },
        { verificationCaseId: 'BASE-ATTESTATION-HASH-BINDINGS', requirementIds: ['R18'] },
        { verificationCaseId: 'BASE-GATE-C-ASSEMBLE-VALIDATION', requirementIds: ['R19'] },
        { verificationCaseId: 'BASE-GATE-D-BUNDLE-VALIDATION', requirementIds: ['R20'] },
        { verificationCaseId: 'BASE-GATE-E-AS-BUILD-TRIGGER', requirementIds: ['R21'] },
        { verificationCaseId: 'BASE-GATE-F-CI-PROFILE-VALIDATION', requirementIds: ['R22'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-CORS',
      description: 'CORS allowlist domain checks',
      owningSuite: 'CORS.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'PROD-RELEASE-CORS-ALLOWLIST-ENFORCEMENT', requirementIds: ['R38'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-SOCKETIO',
      description: 'Socket credentials verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-SOCKETIO-CREDENTIALS-PROD', requirementIds: ['R39'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-SOURCE-SET',
      description: 'source-set compilation safety check',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-SOURCE-SET-ISOLATION', requirementIds: ['R40'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-KEY-ISOLATION',
      description: 'CA trust anchors and private key safety checks',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-RELEASE-APK-NO-TEST-CA', requirementIds: ['R41'] },
        { verificationCaseId: 'BASE-PRIVATE-KEY-SOURCE-ISOLATION', requirementIds: ['R42'] },
        { verificationCaseId: 'BASE-PRIVATE-KEY-GIT-ISOLATION', requirementIds: ['R43'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-DIAGNOSTICS',
      description: 'Diagnostic key and value secrecy audits',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-DIAGNOSTICS-ELIMINATION', requirementIds: ['R44'] },
        { verificationCaseId: 'BASE-DIAGNOSTICS-SCHEMA-MATCH', requirementIds: ['R45'] },
        { verificationCaseId: 'BASE-DIAGNOSTICS-KEY-SECRECY', requirementIds: ['R46'] },
        { verificationCaseId: 'BASE-DIAGNOSTICS-VALUE-SECRECY', requirementIds: ['R47'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-REGISTRIES',
      description: 'Registry completeness checks',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-REGISTRY-SOURCE-VERIFICATION', requirementIds: ['R49'] },
        { verificationCaseId: 'BASE-REGISTRY-UNIQUE-OWNERSHIP', requirementIds: ['R50'] },
        { verificationCaseId: 'BASE-REGISTRY-UNIQUE-CASEIDS', requirementIds: ['R51'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-EVIDENCE',
      description: 'Evidence schema, atomic write, and directory checks',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-EVIDENCE-SCHEMA-VALIDATION', requirementIds: ['R52'] },
        { verificationCaseId: 'BASE-EVIDENCE-WRITE-ATOMICITY', requirementIds: ['R53'] },
        { verificationCaseId: 'BASE-EVIDENCE-DUPLICATE-REJECTION', requirementIds: ['R54'] },
        { verificationCaseId: 'BASE-EVIDENCE-SUPERSESSION-RULES', requirementIds: ['R55'] },
        { verificationCaseId: 'BASE-EVIDENCE-RUN-DIR-IMMUTABILITY', requirementIds: ['R56'] },
        { verificationCaseId: 'BASE-EVIDENCE-TOPOLOGY-ID', requirementIds: ['R84'] },
        { verificationCaseId: 'BASE-EVIDENCE-TOPOLOGY-HASH', requirementIds: ['R85'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-AUDITS',
      description: 'base-module AAB and APK verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-APK-AUDIT-FIXTURE-TESTS', requirementIds: ['R79'] },
        { verificationCaseId: 'BASE-RELEASE-APK-AUDIT-PASS', requirementIds: ['R80'] },
        { verificationCaseId: 'BASE-RELEASE-AAB-AUDIT-PASS', requirementIds: ['R81'] },
        { verificationCaseId: 'BASE-EVIDENCE-APK-HASH', requirementIds: ['R82'] },
        { verificationCaseId: 'BASE-EVIDENCE-AAB-HASH', requirementIds: ['R83'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-VERDICTS',
      description: 'Verdict calculation and cleanup safety audits',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-VERDICT-AFTER-CLEANUP', requirementIds: ['R86'] },
        { verificationCaseId: 'BASE-VERDICT-CLEANUP-BLOCK', requirementIds: ['R87'] },
        { verificationCaseId: 'BASE-SYNC-PRIOR-VERDICTS', requirementIds: ['R91'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-REPORTS',
      description: 'Completion report parity validation',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-REPORT-EVIDENCE-CONSISTENCY', requirementIds: ['R88'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-REGRESSIONS',
      description: 'Vitest and Jest regression runs',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-CLIENT-REGRESSION', requirementIds: ['R89'] },
        { verificationCaseId: 'BASE-SERVER-REGRESSION', requirementIds: ['R90'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-DECISION',
      description: 'Registry approval resolutions',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-DECISION-I01-I16-RESOLVED', requirementIds: ['R92'] },
        { verificationCaseId: 'BASE-DECISION-E22-RESOLVED', requirementIds: ['R93'] }
      ]
    },
    {
      authoritativeScenarioId: 'INFRA-RUN-SUITES',
      description: 'Harness suite runner verification',
      owningSuite: 'accountIsolation.runtime.cjs',
      verificationCases: [
        { verificationCaseId: 'BASE-D1-D20-RUN-CHECK', requirementIds: ['R70'] },
        { verificationCaseId: 'BASE-STRESS-1-RUN-CHECK', requirementIds: ['R72'] },
        { verificationCaseId: 'BASE-STRESS-2-RUN-CHECK', requirementIds: ['R73'] },
        { verificationCaseId: 'BASE-STRESS-DUPLICATE-CHECK', requirementIds: ['R74'] },
        { verificationCaseId: 'BASE-STRESS-TOMBSTONE-CHECK', requirementIds: ['R75'] },
        { verificationCaseId: 'BASE-STRESS-MISMATCH-CHECK', requirementIds: ['R76'] },
        { verificationCaseId: 'BASE-STRESS-CRASH-CHECK', requirementIds: ['R77'] },
        { verificationCaseId: 'BASE-STRESS-ANR-CHECK', requirementIds: ['R78'] }
      ]
    }
  ]
};
