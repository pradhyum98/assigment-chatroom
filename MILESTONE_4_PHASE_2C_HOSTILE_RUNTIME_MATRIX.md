# Phase 2C Hostile Runtime Verification Matrix

This matrix documents the verification results of all security, lifecycle, synchronization, E2EE, and outbox scenarios executed in the Android WebView runtime.

---

## 1. Authentication Scenarios

| Scenario ID | Description | Execution Method | Target AVD | Actual Runtime Evidence | Status |
|---|---|---|---|---|---|
| A01 | Fresh Login / Signup | DevTools fill inputs and submit form | Pixel_API_34 | `POST /api/auth/signup` returns user registration success (201) | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| A02 | Access Token Expiration | Vitest client interceptor mock tests | None | Access token refresh triggered on 401 | **VERIFIED — AUTOMATED TEST ONLY** |
| A03 | Silent Refresh | DevTools `bootstrapSession` on relaunch | Pixel_API_34 | `POST /api/auth/refresh` triggered on mount | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| A04 | Refresh Token Rotation | Jest token refresh rotation suite | None | Token rotated, previous family dropped | **VERIFIED — AUTOMATED TEST ONLY** |
| A05 | Concurrent 401 Silent Refresh | Axios failedQueue interceptor test | None | Concurrent requests queued and resolved | **VERIFIED — AUTOMATED TEST ONLY** |
| A06 | WebView Reload | DevTools `window.location.reload()` | Pixel_API_34 | App re-initializes on reload | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| A07 | Warm App Restart | Pause and resume lifecycle checks | None | App state changes preserved in tests | **VERIFIED — AUTOMATED TEST ONLY** |
| A08 | Force-Stop and Relaunch | `adb shell am force-stop` & start | Pixel_API_34 | Process killed, MainActivity restarts cleanly | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| A09 | Logout Data Wipe | `LocalAccountCleanupService` tests | None | Wipes all 16 IndexedDB accounts | **VERIFIED — AUTOMATED TEST ONLY** |
| A10 | Logout-All Revocation | `SocketRevocationService` tests | None | Force disconnect sent on session drop | **VERIFIED — AUTOMATED TEST ONLY** |
| A11 | Session Revocation | DevTools force disconnect listener | None | Redirects to login page in tests | **VERIFIED — AUTOMATED TEST ONLY** |

---

## 2. Socket.IO Scenarios

| Scenario ID | Description | Execution Method | Target AVD | Actual Runtime Evidence | Status |
|---|---|---|---|---|---|
| S01 | Authenticated Connection | App login auto-connect handshake | Pixel_API_34 | `Secure socket connected: TgLaj...` | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| S02 | Room Subscriptions | Socket joinRoom listeners | None | Subscriptions rebuilt after auth | **VERIFIED — AUTOMATED TEST ONLY** |
| S03 | Network Loss | DevTools dispatch offline event | Pixel_API_34 | Transition to offline state | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| S04 | Network Restoration | DevTools dispatch online event | Pixel_API_34 | Re-established socket connection | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| S05 | Server Restart | Force restart node process | Pixel_API_34 | Sockets auto-reconnected once online | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| S16 | Duplicate socket instance | SocketService instance check | None | SocketService singleton prevents duplicates | **VERIFIED — AUTOMATED TEST ONLY** |
| S17 | Duplicate listener | Event listener tracking checks | None | listeners count strictly bounds to 1 | **VERIFIED — AUTOMATED TEST ONLY** |

---

## 3. Native Lifecycle Scenarios

| Scenario ID | Description | Execution Method | Target AVD | Actual Runtime Evidence | Status |
|---|---|---|---|---|---|
| L01 | Cold Launch Sync | App launch from off-state | Pixel_API_34 | App boots and attempts bootstrap | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| L02 | Background → Foreground | `adb shell input keyevent KEYCODE_HOME` | Pixel_API_34 | `PlatformService` triggers resume | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| L03 | Rapid Pause/Resume | Repeated home and relaunch triggers | Pixel_API_34 | Recovery coordinator single-flight runs | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| L13 | Outbox background preservation | App pause state checks | None | Durable outbox stays in IndexedDB | **VERIFIED — AUTOMATED TEST ONLY** |

---

## 4. IndexedDB & Account Isolation

| Scenario ID | Description | Execution Method | Target AVD | Actual Runtime Evidence | Status |
|---|---|---|---|---|---|
| D01 | Database Creation | App signup initial schema mount | Pixel_API_34 | Mapped stores create successfully | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| D10 | Outbox Persistence | OutboxService queue serialization | None | Offline mutations stored in IDB | **VERIFIED — AUTOMATED TEST ONLY** |
| D12 | Cleanup Intent Recovery | Database cleanup interrupt tests | None | Resumes store purging on restart | **VERIFIED — AUTOMATED TEST ONLY** |
| D15 | Incremental Sync Recovery | SyncEngine sequence sync calls | Pixel_API_34 | `GET /api/sync/user` is requested | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| D25 | No direct socket-to-Redux write | Canonical reconciler flows | None | mutations flow strictly to IDB first | **VERIFIED — AUTOMATED TEST ONLY** |

---

## 5. E2EE & Outbox Scenarios

| Scenario ID | Description | Execution Method | Target AVD | Actual Runtime Evidence | Status |
|---|---|---|---|---|---|
| E01 | Identity Unlock | KeyPair generation on signup | Pixel_API_34 | SubtleCrypto key generation finishes | **VERIFIED — ANDROID EMULATOR RUNTIME** |
| E05 | Encrypted text messaging | SubtleCrypto wrap/unwrap tests | None | Ciphertexts wrap and decrypt cleanly | **VERIFIED — AUTOMATED TEST ONLY** |
| E21 | No decrypted room keys in IDB | SecretStore serialization checks | None | Keys remain in memory only | **VERIFIED — AUTOMATED TEST ONLY** |
| O01 | Offline Send queueing | OutboxService enqueue checks | None | Outbox status set to PENDING | **VERIFIED — AUTOMATED TEST ONLY** |
