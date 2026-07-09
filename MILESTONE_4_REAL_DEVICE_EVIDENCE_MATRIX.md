# Milestone 4 — Real-Device Evidence Matrix

This document maps all native runtime verification scenarios to their actual validation results on native target environments.

---

## 1. Authentication & Cookie Verification

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| AUTH-1 | Fresh Login Session | Android / iOS | Emulator / Simulator | Cookie is stored in WebView container | Verified via A01 Fresh Signup scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| AUTH-2 | App Reload Session Persistence | Android / iOS | Emulator / Simulator | Session cookie is transmitted | Verified via A02 Authenticated API Request scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| AUTH-3 | Warm Restart Cookie Check | Android / iOS | Emulator / Simulator | Cookie is retained on focus change | Verified via L01 Lifecycle scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| AUTH-4 | Terminate and Relaunch Session | Android / iOS | Emulator / Simulator | Cookie persists across app relaunch | Verified via B01 Force-Stop/Relaunch scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| AUTH-5 | Access Token Expiration Refresh | Android / iOS | Emulator / Simulator | Silent refresh triggers via cookie | Unexecuted on emulator; verified via Axios test mocks only | **VERIFIED — AUTOMATED TEST ONLY** |
| AUTH-6 | Concurrent 401 Silent Refresh | Android / iOS | Emulator / Simulator | Single silent refresh request made | Unexecuted on emulator; verified via Axios test mocks only | **VERIFIED — AUTOMATED TEST ONLY** |
| AUTH-7 | Refresh Token Rotation (RTR) | Android / iOS | Emulator / Simulator | Old token rotated, new token set | Unexecuted on emulator; verified via token rotation tests only | **VERIFIED — AUTOMATED TEST ONLY** |
| AUTH-8 | Stale Refresh Token Replay | Android / iOS | Emulator / Simulator | Session family tree revoked | Unexecuted on emulator; verified via token rotation tests only | **VERIFIED — AUTOMATED TEST ONLY** |
| AUTH-9 | Logout Session & Data Wipe | Android / iOS | Emulator / Simulator | Local storage & IDB wiped | Verified via A07 Logout scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| AUTH-10| Logout-All Remote Revocation | Android / iOS | Emulator / Simulator | Sockets of other sessions dropped | Unexecuted on emulator; verified via SocketRevocationService tests | **VERIFIED — AUTOMATED TEST ONLY** |
| AUTH-11| Physical Device Session Retention | Android / iOS | Physical Hardware | Cookie remains secure in OS keychain | Deferred due to missing physical hardware | **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE** |

---

## 2. Native Lifecycle Invariants

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| LIFE-1 | Cold Launch Sync | Android / iOS | Emulator / Simulator | Recovery coordinator triggers | Verified via B01 Force-Stop/Relaunch scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| LIFE-2 | Background → Foreground | Android / iOS | Emulator / Simulator | AppStateChange triggers recovery | Verified via L01 App Lifecycle scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| LIFE-3 | Rapid Pause / Resume Cycles | Android / iOS | Emulator / Simulator | Synchronization requests throttled | Verified via single-flight RecoveryCoordinator runs | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| LIFE-4 | Offline During Resume | Android / iOS | Emulator / Simulator | Transition to offline state | Unexecuted on emulator; verified via outbox wait tests | **VERIFIED — AUTOMATED TEST ONLY** |
| LIFE-5 | Logout while backgrounded | Android / iOS | Emulator / Simulator | Recovery loop is cancelled | Unexecuted on emulator; verified via local account cleanup tests | **VERIFIED — AUTOMATED TEST ONLY** |
| LIFE-6 | Relaunch Rehydrates Outbox | Android / iOS | Emulator / Simulator | Outbox items loaded from IndexedDB | Verified via O01 Offline Outbox scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| LIFE-7 | Lock Screen / Unlock | Android / iOS | Physical Hardware | App state transitions gracefully | Deferred due to missing physical hardware | **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE** |

---

## 3. Socket.IO Real-Device Invariants

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| SOCK-1 | Network Drop and Restore | Android / iOS | Emulator / Simulator | Socket reconnects automatically | Verified via S01 Network Drop scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| SOCK-2 | Server Restart Recovery | Android / iOS | Emulator / Simulator | Sockets reconnect once up | Unexecuted on emulator; verified via socket retry tests | **VERIFIED — AUTOMATED TEST ONLY** |
| SOCK-3 | Token Expiry Re-Auth | Android / iOS | Emulator / Simulator | Socket updates authentication | Unexecuted on emulator; verified via query token rotation tests | **VERIFIED — AUTOMATED TEST ONLY** |
| SOCK-4 | Out-of-Order Socket Events | Android / iOS | Emulator / Simulator | SocketBuffer stores out of order | Unexecuted on emulator; verified via SocketBuffer unit tests | **VERIFIED — AUTOMATED TEST ONLY** |
| SOCK-5 | Wi-Fi / Cellular Transition | Android / iOS | Physical Hardware | Socket handles connection handoff | Deferred due to missing physical hardware | **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE** |

---

## 4. IndexedDB & Account Isolation

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| IDB-1 | Schema Migration (v1 → v2) | Android / iOS | Emulator / Simulator | Migration runs without data loss | Verified via D01 IndexedDB Schema scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| IDB-2 | Account Switch Data Isolation | Android / iOS | Emulator / Simulator | Account B cannot access A's data | Verified via ACC1 and ACC1b scenarios in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| IDB-3 | Rollback mid-transaction | Android / iOS | Emulator / Simulator | IDB rolls back on transaction abort | Unexecuted on emulator; verified via abort tests | **VERIFIED — AUTOMATED TEST ONLY** |
| IDB-4 | Relaunch Staging Recovery | Android / iOS | Emulator / Simulator | Restores staging area safely | Verified via D02 IDB Persistence scenario in `verify_native_scenarios.cjs` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| IDB-5 | OS Low Storage Pressure | Android / iOS | Physical Hardware | DB retains critical cryptographic keys | Deferred due to missing physical hardware | **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE** |

---

## 5. E2EE & Outbox Invariants

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| E2EE-1 | Message Encryption & Decrypt | Android / iOS | Emulator / Simulator | Senders encrypt, receivers decrypt | Unexecuted on emulator; verified via subtle crypto tests | **VERIFIED — AUTOMATED TEST ONLY** |
| E2EE-2 | Offline Send Re-Encryption | Android / iOS | Emulator / Simulator | Re-encrypts mutations if key rotated | Unexecuted on emulator; verified via OutboxService tests | **VERIFIED — AUTOMATED TEST ONLY** |
| E2EE-3 | Key Rotation Offline Re-auth | Android / iOS | Emulator / Simulator | Outbox quarantines bad keys | Unexecuted on emulator; verified via mutation quarantine tests | **VERIFIED — AUTOMATED TEST ONLY** |
| E2EE-4 | Revocation Wipes Keys | Android / iOS | Emulator / Simulator | Membership revocation deletes keys | Unexecuted on emulator; verified via SecretStore tests | **VERIFIED — AUTOMATED TEST ONLY** |
| E2EE-5 | Multiple Queued Outbox Sends | Android / iOS | Emulator / Simulator | Deterministic sequence preserved | Unexecuted on emulator; verified via outbox sequence tests | **VERIFIED — AUTOMATED TEST ONLY** |

---

## 6. History Stress Verification

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| STRESS-1| 1,000 Messages Sync | Android / iOS | Emulator / Simulator | Complete history sync without frame drops | Unexecuted on emulator; verified via hostile backend tests only | **VERIFIED — AUTOMATED TEST ONLY** |
| STRESS-2| Page Snapshot Interruption | Android / iOS | Emulator / Simulator | Recovery resumes sync on relaunch | Unexecuted on emulator; verified via continuation token tests | **VERIFIED — AUTOMATED TEST ONLY** |
| STRESS-3| UI Responsiveness | Android / iOS | Physical Hardware | 60 FPS scrolling during sync | Deferred due to missing physical hardware | **NOT EXECUTED — PHYSICAL DEVICE UNAVAILABLE** |

---

## 7. Web / PWA Regressions

| ID | Scenario Description | Platform | Target | Expected Result | Actual Result / Evidence | Status |
|---|---|---|---|---|---|---|
| PWA-1 | Service Worker Registration | Desktop Web | Chrome / Safari | Register succeeds on web | Verified via SW registration load callbacks | **PASS** |
| PWA-2 | SameSite=Strict Cookie Trans | Desktop Web | Chrome / Safari | Strictly transmits cookies on web | Verified via Chrome browser network tab inspections | **PASS** |
| PWA-3 | Offline PWA Shell Cache | Desktop Web | Chrome / Safari | App shell loads while disconnected | Verified via local static page shell loads | **PASS** |
