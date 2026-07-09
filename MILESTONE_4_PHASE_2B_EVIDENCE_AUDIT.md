# ... (same content as above) ...
# Milestone 4 — Native Runtime Evidence Quality Audit

This document records the Phase 0 Claim Verification Table and audits the verification evidence sources for all mobile runtime scenarios.

---

## 1. Claim Verification Table

| CLAIM | EVIDENCE | ACTUAL STATUS | DISCREPANCY | REQUIRED ACTION |
|---|---|---|---|---|
| Client production build passes | Compiled successfully via `tsc -b && vite build` | **VERIFIED** | None | None |
| Server production build passes | Compiled successfully via `tsc` | **VERIFIED** | None | None |
| Client unit tests pass | 91 Vitest tests execute successfully | **VERIFIED** | None | None |
| Server unit tests pass | 79 Jest tests execute successfully | **VERIFIED** | None | None |
| Active Socket Revocation (B1) | Socket disconnection logic integrated and verified via `socketRevocation.test.ts` | **VERIFIED** | Sockets are successfully disconnected on auth events. Multi-instance broadcast is stutted (instance-local only). | None for single-instance WebView testing; multi-instance horizontal scaling requires Redis in production phase. |
| Account-Safe IndexedDB Cleanup (B2) | Store clearing and memory purging verified via `accountCleanup.test.ts` | **VERIFIED** | None | None |
| Full Resync Snapshot Consistency (H1) | replaced token and page queries verified via `hostile_backend_verification.test.ts` | **VERIFIED** | None | None |
| Android debug build passes | `./gradlew compileDebugSources` executes and packages resources | **FAIL** | Failed due to compiler source target mismatch: Capacitor 6/8 requires Java 21, but active JVM is Java 17. | Upgrade build host SDK to JDK 21 to support compile targets. |
| iOS native build passes | Xcode target compilation | **UNVERIFIED** | Xcode developer toolkit not configured on local build host. | Build and sign on macOS host containing active Xcode configuration. |

---

## 2. Evidence Source Classification

Every scenario in the evidence matrix is audited and classified by its primary validation source:

| Scenario Category | Scenario IDs | Primary Evidence Source | Validation Invariant / Test Target |
|---|---|---|---|
| **Authentication & Cookies** | AUTH-1 to AUTH-10 | **AUTOMATED TEST** & **MANUAL CODE INSPECTION** | `tests/silentRefresh.test.ts`, `tests/tokenRefresh.test.ts`, and Express `setRefreshTokenCookie` dynamic SameSite/origin config overrides. |
| **Native Lifecycle** | LIFE-1 to LIFE-6 | **AUTOMATED TEST** | `client/src/tests/platformLifecycle.test.ts` (triggers single-flight recovery and ignores background loops). |
| **Socket.IO Real-Device** | SOCK-1 to SOCK-4 | **AUTOMATED TEST** | `client/src/tests/platformLifecycle.test.ts` and `server/tests/socketRevocation.test.ts` (reconnect handles credential updates). |
| **IndexedDB & Isolation** | IDB-1 to IDB-4 | **AUTOMATED TEST** | `client/src/tests/accountCleanup.test.ts` (all 16 stores isolation and partial purges). |
| **E2EE & Outbox** | E2EE-1 to E2EE-5 | **AUTOMATED TEST** | `client/src/tests/secretStore.test.ts` and `client/src/tests/outboxReconciliation.test.ts`. |
| **History Sync Stress** | STRESS-1 to STRESS-2 | **AUTOMATED TEST** | `server/tests/hostile_backend_verification.test.ts` (continuation tokens, page snapshot boundaries). |
| **Web / PWA Regressions** | PWA-1 to PWA-3 | **AUTOMATED TEST** & **MANUAL INSPECTION** | `/sw.js` registration and standard Web visibility checks. |

*Note: All physical-device verification checks (AUTH-11, LIFE-7, SOCK-5, IDB-5, STRESS-3) are strictly classified as **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE**.*

---

## 3. AUDIT VERDICT: DOWNGRADED

**CONDITIONAL PASS — AUTOMATED SECURITY VERIFICATION COMPLETE, NATIVE RUNTIME VERIFICATION REMAINS**
