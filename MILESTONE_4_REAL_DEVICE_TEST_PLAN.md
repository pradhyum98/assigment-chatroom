# Milestone 4 — Real-Device Test Plan

This document outlines the real-device test execution procedures required to validate the native iOS and Android environments before store deployment.

---

## 1. Application Lifecycle & Startup

### ANDROID (Physical Device) & iOS (Physical Device)
- **Cold Start**: Force close the application. Launch app from launcher icon. Verify that `CanonicalDatabase` opens, authentication bootstrap validates, socket connects, and `SyncEngine` completes recovery without hangs or UI freezes.
- **Warm Start**: Send the application to background. Immediately bring it back. Verify that the UI remains interactive and does not reload the full app.
- **Background / Suspension**: Background the app for 5 minutes. Bring it to foreground. Verify that the native `appStateChange` event triggers the `PlatformService` subscription, running `RecoveryCoordinator` execution to synchronize missed events.
- **Process Kill & Relaunch**: Background the app and terminate the process from the system app switcher. Relaunch it. Verify that the user session is preserved (if not logged out) and outbox items remain intact.

---

## 2. Sync & Outbox Recovery

- **Offline Send**: Enable Airplane mode. Send 3 messages in a room. Verify:
  - Messages appear in UI with optimistic overlay state.
  - Senders can see their mutations enqueued in IndexedDB `offline_queue_v3`.
- **Outbox Recovery on Reconnection**: Disable Airplane mode. Watch messages transition from optimistic to sent as socket reconnects. Check that room sequence numbers are correct and no duplicates exist.
- **Network Switching**: Initiate a call/message stream. Walk from Wi-Fi range to cellular coverage. Verify that the socket drops, enters a reconnecting state, and re-establishes connectivity without duplicate listeners or SyncEngine recovery storms.

---

## 3. WebView Cookie & ATS Transport Checks

- **iOS WKWebView Session Preservation**: Verify that the refresh token cookie persists across app restarts on iOS. Since WKWebView enforces strict cookie boundaries, verify that the custom secure scheme (`https://localhost`) correctly maps SameSite properties.
- **Android Cleartext Policy**: Verify that native calls are restricted to HTTPS (using secure local schemes) and debug configs only permit local development cleartext endpoints (e.g. `10.0.2.2`).

---

## 4. Native Device Capabilities (Future Integration Verification)

- **Camera Capture**: Trigger a photo attachment action. Grant native permissions when prompted. Capture image and verify WebView receives correct Blob size.
- **Gallery / File Selection**: Select a file from the local file manager. Verify that the WebView chunked reader reads the bytes and queues them in `upload_checkpoints` correctly.
- **Voice Recording**: Record a 10-second audio clip. Verify that `MediaRecorder` API works inside WKWebView/Android WebView, saving the audio chunk correctly.

---

## 5. Security & Verification

- **Remote Dev URL Leak**: Ensure `capacitor.config.ts` has no `server.url` property active in production mode.
- **Wildcard CORS Check**: Verify that `Access-Control-Allow-Origin: *` is NOT configured on the server when sending cookies.
- **Database Wipe on Sign-Out**: Perform a logout. Verify that all 16 IndexedDB stores are wiped clean of metadata.
