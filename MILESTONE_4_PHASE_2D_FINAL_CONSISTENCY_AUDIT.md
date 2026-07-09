# Milestone 4 Phase 2D: Final Consistency Audit

This document records the results of a final hostile evidence audit of Milestone 4 Phase 2D to resolve the contradiction between the full hostile runtime matrix and the actual executed automated script coverage.

---

## 1. The Contradiction: Full-Matrix vs. 13-Scenario Verification

During Phase 2D execution, the automation harness `verify_native_scenarios.cjs` successfully executed exactly **13 distinct scenarios** against the running Android WebView application. 

However, previous reports and checked task items claimed complete emulator runtime coverage of the entire security and hostile validation matrices (encompassing over 70 distinct test conditions including token expiration rotation, full sync conflict resolutions, history stress tests, and E2EE key rotated client-adds).

This audit resolves the contradiction by confirming that:
1. **Emulator Runtime Coverage**: Only the **13 basic smoke/recovery scenarios** were genuinely executed against the installed Android application on the emulator.
2. **Automated-Test-Only Coverage**: The remaining hostile validation checks (such as token expiration timers, sequence gap detection, out-of-order event replay, E2EE key purges, and outbox automatic re-encryption) were verified **only via automated unit/integration tests running under Jest/Node** (in-memory mock context).
3. **No 1,000-Message Stress Execution**: The 1,000-message history sync scenario was verified solely in automated Jest tests. No stress test was executed against the running WebView app inside the emulator, meaning UI responsiveness (60 FPS / ANR) under load remains unvalidated.

---

## 2. Detailed Audit Results by Target Area

### A. Authentication Scenarios (A01 - A15)
* **Genuinely Executed against Android App**:
  * **A01 (Fresh Signup)**: User input filled, form submitted, registration validated.
  * **A02 (Authenticated API Request)**: Token presence and synchronization check.
  * **A07 (Logout)**: Dispatch thunk, verify token wipe.
  * **A02b (Fresh Login after Logout)**: Fill credentials, submit login, verify state.
  * **B01 (Force-Stop and Relaunch)**: Close socket, kill process via ADB, start activity, re-attach, and verify session rehydration.
* **Automated-Test-Only / Unexecuted on Android App**:
  * **A05 (Access-token expiration)**: Unexecuted on emulator; token timeout logic verified only in mock Jest tests.
  * **A06 (Silent refresh)**: Partially verified on emulator (tested during cold relaunch).
  * **A08 (Concurrent 401 single-flight)**: Unexecuted on emulator; verified only in Axios tests.
  * **A12 (Logout-all from another client)**: Unexecuted on emulator; verified only in `SocketRevocationService` tests.
  * **A13 (Individual session revocation)**: Unexecuted on emulator.
  * **A14 (Refresh replay detection/family revocation)**: Unexecuted on emulator.
  * **A15 (Identity reset/session revocation)**: Unexecuted on emulator.

### B. Socket.IO Runtime Coverage
* **Genuinely Executed against Android App**:
  * **A03 (Socket.IO Connection)**: Initial handshake, state tracking, and socket ID validation.
  * **S01 (Network Drop/Reconnect)**: Dispatch offline/online events and check connection state.
* **Automated-Test-Only / Unexecuted on Android App**:
  * **Reconnect after backend restart**: Unexecuted on emulator.
  * **Token refresh while socket connected**: Unexecuted on emulator.
  * **Session / Replay Revocations**: Unexecuted on emulator.
  * **Out-of-order / sequence-gap detection**: Unexecuted on emulator; verified only in `SocketBuffer` unit tests.

### C. Lifecycle Invariants
* **Genuinely Executed against Android App**:
  * **L01 (Home + Foreground)**: Press HOME key, restart MainActivity, verify active session.
  * **B01 (Force-Stop & Relaunch)**: Process SIGKILL and cold restart.
* **Automated-Test-Only / Unexecuted on Android App**:
  * **Backend unavailable during recovery**: Unexecuted on emulator.
  * **Rapid repeated lifecycle transitions**: Unexecuted on emulator.

### D. Canonical Sync (D01 - D25)
* **Genuinely Executed against Android App**:
  * **D01 (IndexedDB Schema)**: Checked existence of 16 stores on startup.
  * **D02 (IDB Persistence)**: Checked database existence after app restart.
* **Automated-Test-Only / Unexecuted on Android App**:
  * **Contiguous application, edits/reactions preservation**: Unexecuted on emulator; validated only in unit tests.
  * **Continuation tokens, interrupted/resumed snapshots**: Unexecuted on emulator.

### E. E2EE Runtime Coverage
* **Genuinely Executed against Android App**:
  * None. Key pair creation is initialized on signup, but messaging is unverified.
* **Automated-Test-Only / Unexecuted on Android App**:
  * All E2EE scenarios (encryption/decryption of messages, key rotation, identity resets, key purges on membership loss) were validated **only in Vitest/Jest unit tests**.

### F. Offline Outbox (O01 - O20)
* **Genuinely Executed against Android App**:
  * **O01 (Outbox Store)**: Confirmed queryability of `offline_queue_v3`.
* **Automated-Test-Only / Unexecuted on Android App**:
  * All active outbox mutation queuing, re-encryption on rotation, and transactional ACK matches were validated **only in OutboxService tests**.

### G. Account Isolation
* **Genuinely Executed against Android App**:
  * **ACC1 / ACC1b**: Signup Account 2, verify state, log back into Account 1.
* **Automated-Test-Only / Unexecuted on Android App**:
  * Checking account-scoped store directories and switching mid-snapshot/mid-flush were unexecuted on the emulator.

### H. 1,000-Message Stress Test
* **Status**: **UNEXECUTED ON EMULATOR**
* **Verification Detail**: Validated solely via Jest `hostile_backend_verification.test.ts` on the host. No stress run occurred inside the native WebView container on the emulator.
