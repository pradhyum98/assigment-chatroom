# Milestone 4 — Pre-Implementation Audit Report

This document serves as the pre-implementation audit for Milestone 4 of the Secure Real-Time Chat & Sharing PWA. It baselines the current Milestone 3 synchronization state, verifies all test suites, and plans the native mobile platform transition using Capacitor.

---

## Phase 0: Baseline State & Test Verification

### 1. Backend Server Verification
The backend server test suite was executed sequentially using the real MongoDB Atlas replica-set.
* **Total Test Suites**: 12 passed / 12 total
* **Total Tests**: 45 passed / 45 total
* **Compilation Status**: Zero TypeScript type errors (`npm run build` succeeds).

### 2. Client PWA Verification
The client PWA test suite was executed using the mock `fake-indexeddb` environment.
* **Total Test Files**: 11 passed / 11 total
* **Total Tests**: 69 passed / 69 total
* **Build Status**: Production bundle compilation succeeds without warnings or type errors (`tsc -b && vite build` succeeds).

---

## Phase 1: Native Mobile Platform Transition Planning

Transitioning from a Progressive Web Application (PWA) to a native mobile application via Capacitor requires replacing web-specific host APIs with cross-platform native plugin implementations.

### 1. Web API Native Replacements
* **Push Notifications**: Standard Service Worker Push API does not run in background WebViews on iOS/Android. Must transition to Firebase Cloud Messaging (FCM) and APNs via the `@capacitor/push-notifications` native plugin.
* **File Upload / Camera Access**: Native WebViews restrict standard `<input type="file">` file-system pickers or block web camera capture. Standard uploads will be complemented by `@capacitor/camera` and `@capacitor/filesystem` to capture photos, record videos, and read/write chunks securely in the device's native sandbox.
* **System Share Sheet**: Web Share API (`navigator.share`) will be replaced/complemented by `@capacitor/share` to hook into native OS share sheets.
* **Local OS Notifications**: Foreground/Background local notifications will utilize `@capacitor/local-notifications`.

### 2. Service Worker Limitations in Native WebViews
* **Asset Caching**: Service Workers do not run reliably or at all in some native mobile WebViews.
* **Remediation**: The offline app shell, assets, styles, and scripts must be pre-bundled and loaded directly from the local device assets directory (configured in `capacitor.config.json` via local bundle reference). Network requests will go directly to the API server without Service Worker interceptors.

### 3. Native Cookie & HTTP Header Restrictions
* **HttpOnly Access Control**: iOS and Android WebViews enforce strict cookie policies. Native applications run on custom origins (`capacitor://localhost` on iOS, `http://localhost` on Android) which are treated as third-party relative to the backend API origin (e.g. `http://localhost:5001`). As a result, HttpOnly cookies (`refreshToken`) will not persist or transmit correctly.
* **Remediation**: The authentication flow must be updated to store the refresh token securely using `@capacitor-community/safe-area` / `@ionic/secure-storage` or secure local storage properties, transmitting it as an authorization header instead of relying on HttpOnly session cookies.

### 4. Storage Quotas & Compaction
* **IndexedDB Volatility**: The OS can purge WebView IndexedDB storage under low-memory situations.
* **Remediation**: Implement a robust backup and export mechanism using `@capacitor/filesystem` to dump database snapshots to persistent OS native directories, or transition critical cryptographic metadata to `@capacitor-community/sqlite` which persists across OS compactions.

### 5. WebView Media Permissions
* **Inline Playback / Recording**: iOS WKWebView blocks inline video recording/playback and microphone capture by default.
* **Remediation**:
  * Set `allowsInlineMediaPlayback = true` on the WebView.
  * Configure `Info.plist` with required permission descriptions:
    * `NSCameraUsageDescription` (Camera capture)
    * `NSMicrophoneUsageDescription` (Voice note recorder)
    * `NSPhotoLibraryAddUsageDescription` / `NSPhotoLibraryUsageDescription` (Saving/Loading attachments)

### 6. Cleartext Development Network Configuration
* **Android Cleartext Block**: Modern Android WebViews block unencrypted cleartext HTTP traffic (e.g. `http://localhost:5001`) by default.
* **Remediation**: Create `res/xml/network_security_config.xml` allowing cleartext traffic for local development IPs and reference it in the `AndroidManifest.xml` via `android:networkSecurityConfig`.

---

## Phase 2: Transport Security and Verification Audit

### 1. Current Socket.IO Client Configuration
* **Connection Option**: Uses a standard WebSocket connection that transmits token credentials inside the handshake `auth: { token }` envelope.
* **Vulnerabilities**: Bypasses SSL certificate pinning, relying entirely on the native OS trust store which is vulnerable to MITM proxying on mobile.

### 2. Native TLS/SSL Certificate Pinning
* **Pinning Strategy**: To prevent traffic interception, implement SSL pinning for API and WebSocket requests.
* **Remediation**: Route HTTP/HTTPS traffic through `@capacitor-community/http` (which utilizes native HTTP clients supporting TLS certificate pinning) instead of browser-native `axios` / `fetch`. For WebSockets, configure fingerprint verification.

### 3. Socket.IO Transport Options
* Restrict Socket.IO client configuration strictly to `transports: ['websocket']` to bypass HTTP long-polling connection handshakes, avoiding origin-bound session cookie checks in WebViews.

### 4. Token Refresh Lifecycle on Socket Connections
* When the memory access token expires, the active Socket.IO connection must be updated dynamically without dropping the socket connection.
* **Remediation**: Listen to the API refresh success callback, update `socket.auth = { token: newAccessToken }`, and emit a custom `reauthenticate` event so the server updates the socket session association in memory.

### 5. E2EE Performance & Worker Threads
* Cryptographic operations (RSA-OAEP and AES-GCM) execute via the WebView's Web Cryptography API (`window.crypto.subtle`). While fast, large media processing or bulk message decryption blocks the single UI thread.
* **Remediation**: Offload bulk decryption/encryption operations to Web Workers to prevent UI frame drops and keep interactions fluid.

---

## Phase 3: Native Lifecycle and Storage Audits

### 1. Native Application Lifecycle States
* **Background / Suspension**: When the mobile app is backgrounded, the OS suspends the JavaScript thread and terminates active TCP/WebSocket connections.
* **Remediation**:
  * Listen to `@capacitor/app` lifecycle notifications (`appStateChange`).
  * On backgrounding, gracefully pause synchronization queues and close active socket connections.
  * On foregrounding, trigger an immediate connection handshake and initiate the `SyncEngine` recovery routine (`IncrementalSync` using the last event cursor).
  * Enable short ping/pong intervals on Socket.IO (`pingTimeout: 10000`, `pingInterval: 5000`) to quickly identify stale half-open connections.

### 2. Storage Persistence & Recovery
* **Data Recovery**: Provide database dump/restore options. Export IndexedDB JSON snapshots to the native filesystem using `@capacitor/filesystem`, allowing users to restore their offline message history in case of WebView cache clearing or device migration.
