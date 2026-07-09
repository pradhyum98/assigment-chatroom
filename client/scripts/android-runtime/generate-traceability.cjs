const fs = require('fs');
const path = require('path');

const baseCases = [
  { "verificationCaseId": "BASE-RESOLVER-IMPORTS-ISOLATION", "authoritativeScenarioId": "INFRA-RESOLVER", "requirementIds": ["R01"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-POLICY-PARITY", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R02"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-POLICY-MISSING-PROFILE-FAIL", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R03"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-POLICY-PROD-INVARIANTS", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R04"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-POLICY-EMULATOR-INVARIANTS", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R05"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-POLICY-WEB-INVARIANTS", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R06"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-POLICY-COMPILER-RUN-BEFORE-BUILD", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R07"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-POLICY-STALE-DETECTION", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R08"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-IMPORT-API-TRANSPORT", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R09"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-IMPORT-SOCKET-TRANSPORT", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R10"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-IMPORT-CHATWINDOW-TRANSPORT", "authoritativeScenarioId": "INFRA-POLICY", "requirementIds": ["R11"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-GATE-A-MISSING-PROFILE", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R12"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-A-LOOPBACK-REJECTION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R13"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-A-HARNESS-REJECTION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R14"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-B-SYNC-WRAPPER", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R15"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-B-COPY-WRAPPER", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R16"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-C-STALE-ATTESTATION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R17"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-ATTESTATION-HASH-BINDINGS", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R18"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-C-ASSEMBLE-VALIDATION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R19"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-D-BUNDLE-VALIDATION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R20"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-GATE-E-AS-BUILD-TRIGGER", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R21"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-GATE-F-CI-PROFILE-VALIDATION", "authoritativeScenarioId": "INFRA-GATES", "requirementIds": ["R22"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-RELEASE-CORS-ALLOWLIST-ENFORCEMENT", "authoritativeScenarioId": "INFRA-CORS", "requirementIds": ["R38"], "owningSuite": "CORS.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-SOCKETIO-CREDENTIALS-PROD", "authoritativeScenarioId": "INFRA-SOCKETIO", "requirementIds": ["R39"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-SOURCE-SET-ISOLATION", "authoritativeScenarioId": "INFRA-SOURCE-SET", "requirementIds": ["R40"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-RELEASE-APK-NO-TEST-CA", "authoritativeScenarioId": "INFRA-KEY-ISOLATION", "requirementIds": ["R41"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-PRIVATE-KEY-SOURCE-ISOLATION", "authoritativeScenarioId": "INFRA-KEY-ISOLATION", "requirementIds": ["R42"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-PRIVATE-KEY-GIT-ISOLATION", "authoritativeScenarioId": "INFRA-KEY-ISOLATION", "requirementIds": ["R43"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-DIAGNOSTICS-ELIMINATION", "authoritativeScenarioId": "INFRA-DIAGNOSTICS", "requirementIds": ["R44"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-DIAGNOSTICS-SCHEMA-MATCH", "authoritativeScenarioId": "INFRA-DIAGNOSTICS", "requirementIds": ["R45"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-DIAGNOSTICS-KEY-SECRECY", "authoritativeScenarioId": "INFRA-DIAGNOSTICS", "requirementIds": ["R46"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-DIAGNOSTICS-VALUE-SECRECY", "authoritativeScenarioId": "INFRA-DIAGNOSTICS", "requirementIds": ["R47"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-REGISTRY-SOURCE-VERIFICATION", "authoritativeScenarioId": "INFRA-REGISTRIES", "requirementIds": ["R49"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-REGISTRY-UNIQUE-OWNERSHIP", "authoritativeScenarioId": "INFRA-REGISTRIES", "requirementIds": ["R50"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-REGISTRY-UNIQUE-CASEIDS", "authoritativeScenarioId": "INFRA-REGISTRIES", "requirementIds": ["R51"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-EVIDENCE-SCHEMA-VALIDATION", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R52"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-EVIDENCE-WRITE-ATOMICITY", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R53"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-EVIDENCE-DUPLICATE-REJECTION", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R54"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-EVIDENCE-SUPERSESSION-RULES", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R55"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-EVIDENCE-RUN-DIR-IMMUTABILITY", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R56"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-APK-AUDIT-FIXTURE-TESTS", "authoritativeScenarioId": "INFRA-AUDITS", "requirementIds": ["R79"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-RELEASE-APK-AUDIT-PASS", "authoritativeScenarioId": "INFRA-AUDITS", "requirementIds": ["R80"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-RELEASE-AAB-AUDIT-PASS", "authoritativeScenarioId": "INFRA-AUDITS", "requirementIds": ["R81"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-EVIDENCE-APK-HASH", "authoritativeScenarioId": "INFRA-AUDITS", "requirementIds": ["R82"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-EVIDENCE-AAB-HASH", "authoritativeScenarioId": "INFRA-AUDITS", "requirementIds": ["R83"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-EVIDENCE-TOPOLOGY-ID", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R84"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-EVIDENCE-TOPOLOGY-HASH", "authoritativeScenarioId": "INFRA-EVIDENCE", "requirementIds": ["R85"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-VERDICT-AFTER-CLEANUP", "authoritativeScenarioId": "INFRA-VERDICTS", "requirementIds": ["R86"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-VERDICT-CLEANUP-BLOCK", "authoritativeScenarioId": "INFRA-VERDICTS", "requirementIds": ["R87"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-REPORT-EVIDENCE-CONSISTENCY", "authoritativeScenarioId": "INFRA-REPORTS", "requirementIds": ["R88"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-CLIENT-REGRESSION", "authoritativeScenarioId": "INFRA-REGRESSIONS", "requirementIds": ["R89"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-SERVER-REGRESSION", "authoritativeScenarioId": "INFRA-REGRESSIONS", "requirementIds": ["R90"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-SYNC-PRIOR-VERDICTS", "authoritativeScenarioId": "INFRA-VERDICTS", "requirementIds": ["R91"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "REQUIRED" },
  { "verificationCaseId": "BASE-DECISION-I01-I16-RESOLVED", "authoritativeScenarioId": "INFRA-DECISION", "requirementIds": ["R92"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "BASE-DECISION-E22-RESOLVED", "authoritativeScenarioId": "INFRA-DECISION", "requirementIds": ["R93"], "owningSuite": "accountIsolation.runtime.cjs", "topology": "STATIC_INSPECTION", "requiredExecutionClass": "STATIC_INSPECTION", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-TOPOLOGY-COOKIE-PARTY-PREFLIGHT", "authoritativeScenarioId": "PROD-TOPOLOGY-COOKIE-PARTY-PREFLIGHT", "requirementIds": ["R94"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-AUTH-COOKIE-HTTPONLY-ENFORCEMENT", "authoritativeScenarioId": "A01", "requirementIds": ["R23","R48"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-AUTH-COOKIE-DOCUMENT-COOKIE-EMPTY", "authoritativeScenarioId": "A01", "requirementIds": ["R24"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-AUTH-DIAGNOSTICS-NO-COOKIE", "authoritativeScenarioId": "A01", "requirementIds": ["R25"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "BLOCKING" },
  { "verificationCaseId": "PROD-AUTH-COOKIE-PERSISTENCE-FORCE-STOP", "authoritativeScenarioId": "A08", "requirementIds": ["R26"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-TOKEN-EXPIRY-SILENT-REFRESH", "authoritativeScenarioId": "A02", "requirementIds": ["R27"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-CONCURRENT-401-SINGLE-FLIGHT", "authoritativeScenarioId": "A05", "requirementIds": ["R28"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-REFRESH-TOKEN-ROTATION", "authoritativeScenarioId": "A01", "requirementIds": ["R29"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-REPLAY-FAMILY-REVOCATION", "authoritativeScenarioId": "A01", "requirementIds": ["R30"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-FORCE-STOP-SESSION-RESTORE", "authoritativeScenarioId": "A08", "requirementIds": ["R31"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-LOGOUT-FULL", "authoritativeScenarioId": "A09", "requirementIds": ["R32"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-LOGOUT-ALL", "authoritativeScenarioId": "A10", "requirementIds": ["R33"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-INDIVIDUAL-SESSION-REVOKE", "authoritativeScenarioId": "A11", "requirementIds": ["R34"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-SOCK-REAUTH-AFTER-ROTATION", "authoritativeScenarioId": "S03", "requirementIds": ["R35"], "owningSuite": "socket.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-SOCK-STALE-AUTH-REJECTED", "authoritativeScenarioId": "S03", "requirementIds": ["R36"], "owningSuite": "socket.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "PROD-AUTH-IDENTITY-RESET-REVOCATION", "authoritativeScenarioId": "A10", "requirementIds": ["R37"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-IDB-2-POST-LOGOUT-ISOLATION", "authoritativeScenarioId": "IDB-2", "requirementIds": ["R71"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },

  // Infrastructure cases
  { "verificationCaseId": "BASE-D1-D20-RUN-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R70"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-1-RUN-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R72"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-2-RUN-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R73"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-DUPLICATE-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R74"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-TOMBSTONE-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R75"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-MISMATCH-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R76"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-CRASH-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R77"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" },
  { "verificationCaseId": "BASE-STRESS-ANR-CHECK", "authoritativeScenarioId": "INFRA-RUN-SUITES", "requirementIds": ["R78"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" }
];

const cases = [...baseCases];

["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R57"], "owningSuite": "auth.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

for (let i = 1; i <= 10; i++) {
  const id = `AUTH-${i}`;
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R58"], "owningSuite": "auth.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
}

["S01", "S02", "S03", "S04", "S05", "S16", "S17"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R59"], "owningSuite": "socket.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["SOCK-1", "SOCK-2", "SOCK-3", "SOCK-4"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R60"], "owningSuite": "socket.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["L01", "L02", "L03", "L13"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R61"], "owningSuite": "life.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["LIFE-1", "LIFE-2", "LIFE-3", "LIFE-4", "LIFE-5", "LIFE-6"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R62"], "owningSuite": "life.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["D01", "D10", "D12", "D15", "D25"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R63"], "owningSuite": "direct.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["IDB-1", "IDB-3", "IDB-4"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R64"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["E01", "E05", "E21"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R65"], "owningSuite": "identity.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["E2EE-1", "E2EE-2", "E2EE-3", "E2EE-4", "E2EE-5"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R66"], "owningSuite": "identity.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

cases.push({ "verificationCaseId": "RUNTIME-CASE-O01", "authoritativeScenarioId": "O01", "requirementIds": ["R67"], "owningSuite": "identity.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });

["E1", "E2", "E3", "E4", "E5"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R68"], "owningSuite": "identity.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

["ACC-1", "ACC-2"].forEach(id => {
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R69"], "owningSuite": "identity.runtime.cjs", "topology": "ANDROID_PRODUCTION_EQUIVALENT_HTTPS", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
});

for (let i = 1; i <= 20; i++) {
  const id = `D${i}`;
  cases.push({ "verificationCaseId": `RUNTIME-CASE-${id}`, "authoritativeScenarioId": id, "requirementIds": ["R70"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
}

cases.push({ "verificationCaseId": "RUNTIME-CASE-STRESS-1", "authoritativeScenarioId": "STRESS-1", "requirementIds": ["R72"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });
cases.push({ "verificationCaseId": "RUNTIME-CASE-STRESS-2", "authoritativeScenarioId": "STRESS-2", "requirementIds": ["R73"], "owningSuite": "canonicalSync.runtime.cjs", "topology": "LOOPBACK_HTTP", "requiredExecutionClass": "ANDROID_RUNTIME", "severity": "CRITICAL" });

fs.writeFileSync(
  path.join(__dirname, 'traceabilityRegistry.json'),
  JSON.stringify({ traceability: cases }, null, 2)
);
console.log('Successfully generated static traceabilityRegistry.json!');
