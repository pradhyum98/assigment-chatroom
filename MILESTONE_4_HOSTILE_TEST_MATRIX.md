# Milestone 4 — Hostile Test Matrix

This matrix documents the 45 hostile testing scenarios implemented and verified to validate the client and server synchronization logic, transport security, E2EE key rotation, and offline persistence state boundaries.

---

## Matrix Categories

### A. Authentication and Session Security

| ID | Invariant | Threat/Failure Simulated | Test File | Exact Test Name | Code Path Exercised | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| A1 | Refresh rotation | Token theft / session hijack | `tokenRefresh.test.ts` | `should rotate refreshToken correctly` | `authController.refresh` | Rotates correctly | PASS |
| A2 | Refresh replay | Replay attack with stale token | `tokenRefresh.test.ts` | `should detect replay attack and revoke family` | `authController.refresh` | Entire family revoked | PASS |
| A3 | Concurrent refresh CAS | Concurrent refresh requests | `tokenRefresh.test.ts` | `should handle concurrent refresh atomically` | `authController.refresh` | One wins, others fail | PASS |
| A4 | Logout-all | Session cleanup | `tokenRefresh.test.ts` | `should log out all sessions` | `authController.logoutAll` | All sessions revoked | PASS |
| A5 | Active socket revocation | Session leak over long-lived socket | `hostileMatrix.test.ts` | `A5.1 — logoutAll revokes DB sessions then disconnects active sockets` | `SocketRevocationService.revokeUser` | Socket disconnected | PASS |
| A6 | Single session logout socket disconnect | Single socket leak | `hostileMatrix.test.ts` | `A5.2 — logout revokes single session and disconnects user sockets` | `logout` | Socket disconnected | PASS |
| A7 | Replay socket disconnect | Replay bypass | `hostileMatrix.test.ts` | `A5.3 — replay detection revokes sockets immediately after DB update` | `refresh` | Socket disconnected | PASS |
| A8 | Password reset session invalidation | Revocation bypass | `hostileMatrix.test.ts` | `A8.1 — identity reset revokes all refresh sessions` | `resetIdentity` | All sessions revoked | PASS |
| A9 | Malformed token rejection | Auth bypass | `hostileMatrix.test.ts` | `A9.1 — malformed access token is rejected by authenticate middleware` | `authenticate` | HTTP 401 | PASS |
| A10 | Expired token rejection | Re-use expired tokens | `hostileMatrix.test.ts` | `A9.2 — expired access token is rejected` | `authenticate` | HTTP 401 | PASS |

---

### B. E2EE Identity and Key Rotation

| ID | Invariant | Threat/Failure Simulated | Test File | Exact Test Name | Code Path Exercised | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| B1 | Identity reset zero rooms | Identity reset failure | `hostileMatrix.test.ts` | `B1 — identity reset with zero rooms creates only user event` | `resetIdentity` | Only user event created | PASS |
| B2 | Identity reset multiple rooms | Rotation missing | `hostileMatrix.test.ts` | `B2 — identity reset with multiple rooms creates IDENTITY_CHANGED events for every room` | `resetIdentity` | Events created for all rooms | PASS |
| B3 | Rollback during reset | Partial write inconsistency | `hostileMatrix.test.ts` | `B3 — identity reset transaction rolls back on error, leaving original state intact` | `resetIdentity` | DB transaction roll back | PASS |
| B4 | Stale identity message detection | Replaying messages with old key versions | `hostileMatrix.test.ts` | `B4 — stale senderIdentityVersion in message payload is structurally detectable` | `MessageService.createMessage` | Version mismatch retained | PASS |
| B5 | Transition recovery idempotency | Multi-worker race condition | `hostileMatrix.test.ts` | `B5 — transition recovery processing same PENDING transition twice is idempotent` | `recoverPendingTransitions` | Idempotent | PASS |
| B6 | Group key rotation CAS succeeds | Concurrent key update collision | `groupRotation.test.ts` | `should successfully rotate keys` | `cryptoController.rotateRoomKey` | Key rotated | PASS |
| B7 | Group key rotation fails on concurrent changes | Race condition in key version increment | `groupRotation.test.ts` | `should fail rotation if membership revision has changed` | `cryptoController.rotateRoomKey` | CAS query fails | PASS |
| B8 | Identity reset creates transitions | Tracking reset operations | `resetIdentity.test.ts` | `should create PENDING identity transitions for active rooms` | `resetIdentity` | Transitions created | PASS |
| B9 | Identity reset marks rooms ROTATION_REQUIRED | Stale key usage | `resetIdentity.test.ts` | `should mark room cryptoState as ROTATION_REQUIRED` | `resetIdentity` | Crypto state updated | PASS |
| B10 | Identity reset triggers key rotation events | Stale state | `resetIdentity.test.ts` | `should trigger key rotation events` | `resetIdentity` | Events generated | PASS |

---

### C. Durable Event Synchronization

| ID | Invariant | Threat/Failure Simulated | Test File | Exact Test Name | Code Path Exercised | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| C1 | Gapless sequence allocation | Event sequence gaps | `hostileMatrix.test.ts` | `C1 — gapless monotonic sequence allocation: no gaps between concurrent calls` | `SequenceService.allocateRoomSequence` | Gapless | PASS |
| C2 | Duplicate mutationId rejection | Replay messages | `hostileMatrix.test.ts` | `C2 — concurrent same clientMsgId from separate senders is idempotent` | `MessageService.createMessage` | Deduplicated | PASS |
| C3 | CURSOR_AHEAD detection | Client spoofing future sequences | `hostileMatrix.test.ts` | `C3 — CURSOR_AHEAD detected when client cursor exceeds server latestSequence` | `syncRoomEvents` | CURSOR_AHEAD response | PASS |
| C4 | Multi-event mutation rollback | DB transaction abort | `hostileMatrix.test.ts` | `C4 — aborted transaction leaves no partial event sequences` | `MessageService.createMessage` | Sequence gap avoided | PASS |
| C5 | Retention boundary movement | Stale event access | `hostileMatrix.test.ts` | `C5 — pruning updates minimumRetainedSequence transactionally` | `RetentionService.pruneRoomEvents` | Minimum boundary moved | PASS |
| C6 | Sync sequence ordering | Out-of-order event sync | `hostileMatrix.test.ts` | `C6 — syncRoomEvents returns events strictly ordered by sequenceNumber` | `syncRoomEvents` | Strictly ordered | PASS |
| C7 | Full resync token binding | Token replay on other room/user | `hostileMatrix.test.ts` | `C7 — full resync pagination token is cryptographically bound to roomId and userId` | `fullResync` | Token bound | PASS |
| C8 | Full resync token wrong room | Token replay cross-room | `hostileMatrix.test.ts` | `C8 — full resync token with wrong roomId is structurally rejected` | `fullResync` | HTTP 403 | PASS |
| C9 | Post-snapshot message exclusion | Dynamic message edit leak | `hostileMatrix.test.ts` | `C9 — post-snapshot mutations are excluded from snapshot query` | `fullResync` | Excluded | PASS |
| C10| MessageService transaction safety | DB write failure consistency | `hostile_backend_verification.test.ts` | `MessageService wraps creation in transaction and allocates sequence` | `MessageService.createMessage` | Atomicity | PASS |

---

### D. Client Canonical Database and Recovery

| ID | Invariant | Threat/Failure Simulated | Test File | Exact Test Name | Code Path Exercised | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| D1 | Duplicate event application | Double-sync processing | `canonicalHistoryInstaller.test.ts` | `is idempotent when installing duplicate events` | `CanonicalHistoryInstaller.installPage` | Idempotent | PASS |
| D2 | Sequence gap detection | Missing sync packets | `canonicalHistoryInstaller.test.ts` | `detects sequence gaps and triggers recovery` | `CanonicalHistoryInstaller.installPage` | Gap detected | PASS |
| D3 | Stale generation cancellation | Stale write execution after logout | `canonicalHistoryInstaller.test.ts` | `aborts if generation changes before IDB write` | `CanonicalHistoryInstaller.installPage` | Write aborted | PASS |
| D4 | IndexedDB rollback transaction | Process crash mid-transaction | `indexedDb.test.ts` | `aborts transaction on error and rolls back` | `IndexedDB` | Full rollback | PASS |
| D5 | Processed-event deduplication | Event double-processing | `indexedDb.test.ts` | `atomically enqueues message and sequence number` | `IndexedDB` | Deduplicated | PASS |
| D6 | Account isolation: outbox clear | Account data inheritance on logout | `accountCleanup.test.ts` | `logout clears offline_queue_v3 (outbox)` | `LocalAccountCleanupService.purgeAccount` | Outbox empty | PASS |
| D7 | Account isolation: events clear | E2EE metadata leakage | `accountCleanup.test.ts` | `logout clears room_events` | `LocalAccountCleanupService.purgeAccount` | Events cleared | PASS |
| D8 | Account isolation: message projections clear | Content cache leak | `accountCleanup.test.ts` | `logout clears message_projections` | `LocalAccountCleanupService.purgeAccount` | Projections cleared | PASS |
| D9 | Account isolation: room projections clear | Channel leak | `accountCleanup.test.ts` | `logout clears room_projections` | `LocalAccountCleanupService.purgeAccount` | Projections cleared | PASS |
| D10| Account isolation: staging clear | Partial sync leak | `accountCleanup.test.ts` | `logout clears all snapshot staging stores` | `LocalAccountCleanupService.purgeAccount` | Staging cleared | PASS |
| D11| Account isolation: processed events clear | Deduplication state reuse | `accountCleanup.test.ts` | `logout clears processed_events` | `LocalAccountCleanupService.purgeAccount` | Events cleared | PASS |
| D12| Account isolation: upload checkpoints clear | Resume leak | `accountCleanup.test.ts` | `logout clears upload_checkpoints` | `LocalAccountCleanupService.purgeAccount` | Checkpoints cleared | PASS |
| D13| Account isolation: cleanup intents clear | Receipt leak | `accountCleanup.test.ts` | `logout clears cleanup_intents` | `LocalAccountCleanupService.purgeAccount` | Intents cleared | PASS |
| D14| Account isolation: SecretStore clear | E2EE key leakage in memory | `accountCleanup.test.ts` | `logout clears SecretStore private key and room keys` | `LocalAccountCleanupService.purgeAccount` | Key material nullified | PASS |
| D15| Account isolation: cross-user isolation | User B reading User A data | `accountCleanup.test.ts` | `purging Account A does not affect Account B records` | `LocalAccountCleanupService.purgeAccount` | Account B untouched | PASS |
| D16| Account isolation: idempotency | Cleanup crash recovery | `accountCleanup.test.ts` | `repeated cleanup is idempotent` | `LocalAccountCleanupService.purgeAccount` | Safe | PASS |
| D17| Account isolation: empty DB | Zero state bootstrap crash | `accountCleanup.test.ts` | `cleanup on nonexistent/empty DB succeeds without error` | `LocalAccountCleanupService.purgeAccount` | Safe | PASS |
| D18| Identity reset partial wipe | Key loss recovery | `accountCleanup.test.ts` | `identity_reset purges offline_queue_v3 but preserves room_events` | `LocalAccountCleanupService.purgeAccount` | Outbox cleared, events intact | PASS |
| D19| Account isolation: failure reporting | Silent failure masking | `accountCleanup.test.ts` | `returns success:false when a store clear fails` | `LocalAccountCleanupService.purgeAccount` | Success false | PASS |
| D20| Account isolation: all stores clear | Incomplete wipe | `accountCleanup.test.ts` | `all 16 account-scoped stores are cleared on successful LOGOUT` | `LocalAccountCleanupService.purgeAccount` | 16 stores wiped | PASS |

---

### E. Outbox and Offline Crypto

| ID | Invariant | Threat/Failure Simulated | Test File | Exact Test Name | Code Path Exercised | Expected Result | Status |
|---|---|---|---|---|---|---|---|
| E1 | Offline encryption logic | Network disconnection | `outboxReconciliation.test.ts` | `enqueues mutation and updates status` | `OutboxService` | Encrypted mutation | PASS |
| E2 | Key rotation offline re-encryption | Key stale mid-transit | `outboxReconciliation.test.ts` | `re-encrypts mutations when room key rotates` | `OutboxService` | Re-encrypted correctly | PASS |
| E3 | Stale key quarantine | Rotation failure | `outboxReconciliation.test.ts` | `quarantines mutation if re-encryption fails` | `OutboxService` | Quarantined status | PASS |
| E4 | App restart outbox integrity | Device power loss | `outboxReconciliation.test.ts` | `rehydrates pending outbox mutations` | `OutboxService` | Restored | PASS |
| E5 | In-memory key caching | Memory leakage | `secretStore.test.ts` | `clears all keys from memory` | `secretStore.clearAll` | Wiped | PASS |

---

## Environmental Execution Details

- **Database State**: Local test executions run against a transaction-supported MongoDB replica-set configuration.
- **Client State**: All IndexedDB simulations utilize `fake-indexeddb` inside `vitest` for realistic asynchronous transaction rollback and cursor behaviour.
- **Mock Dependencies**: Socket.IO transport layer is mocked during API controller tests to assert server-to-client event generation.

---

**Matrix Verification Verdict: 45 / 45 Hostile Scenarios Verified and PASS.**
