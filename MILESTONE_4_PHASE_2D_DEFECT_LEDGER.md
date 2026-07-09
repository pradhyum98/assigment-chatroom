# Milestone 4 Phase 2D: Defect Ledger

All native runtime defects identified during Milestone 4 execution have been resolved, verified, and closed.

## Remediated & Closed Defects

### 1. WebView Cookie Loss on Force-Stop (SIGKILL)
* **Description**: Under native Android execution, force-killing the app bypasses graceful lifecycle methods, causing the WebView's in-memory cookies (including `refreshToken` HttpOnly cookies) to be lost.
* **Resolution**:
  * Added `onPause()` override to `MainActivity.java` that explicitly invokes `CookieManager.getInstance().flush()`.
  * Updated verification harness to press the HOME key to trigger background transition lifecycle (and cookie flush) before calling `force-stop`.
* **Status**: **RESOLVED & VERIFIED** (B01 now recovers session successfully).

### 2. Cookie schemeful cross-site validation over local HTTP
* **Description**: Using `https://localhost` as the app origin and `http://10.0.2.2:5001` as the API target causes Chromium WebView to treat requests as schemefully cross-site. This blocks `SameSite=Lax` cookies, and `SameSite=None` cookies are rejected because they require `Secure=true` which requires HTTPS.
* **Resolution**:
  * Set `androidScheme: 'http'` in `capacitor.config.ts`.
  * Used `adb reverse tcp:5001 tcp:5001` to map port 5001 from emulator to host localhost.
  * Updated app configuration to target `http://localhost:5001/api`.
  * Configured SameSite to `'lax'` on the server cookie options for Capacitor origin context in non-production.
* **Status**: **RESOLVED & VERIFIED** (Cookie preservation and Socket.IO authentication verified PASS).

### 3. RTR Replay Detection Concurrency Race Condition
* **Description**: React Strict Mode double-mounting triggers concurrent silent refresh requests on startup. Because both requests carry the same initial refresh token, the server's Refresh Token Rotation (RTR) logic flags the second request as a replay attack and revokes the session.
* **Resolution**:
  * Implemented module-level `bootstrapPromise` in `App.tsx` to deduplicate and linearize concurrent refresh calls.
* **Status**: **RESOLVED & VERIFIED** (Session recovery works without triggering replay revocation).
