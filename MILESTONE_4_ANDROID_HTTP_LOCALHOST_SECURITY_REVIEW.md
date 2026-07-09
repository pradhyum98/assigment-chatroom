# Milestone 4: Android HTTP Localhost Security Review

This document contains a hostile security review of the development/testing configuration changes introduced to enable cookie transport inside the Android Emulator WebView.

---

## 1. Security Analysis of Localhost HTTP Topology

### A. Is `adb reverse` strictly an emulator/development testing mechanism?
**Yes.** `adb reverse` requires direct client-to-host bridge connections initialized via the Android Debug Bridge (ADB) daemon. Real production users running the app on physical hardware will have no ADB host connection, making any local loopback routing impossible.

### B. What API URL and transport does a release build use on a physical device?
A release build uses a production domain name (e.g. `https://api.securechat.com/api`) targeting the remote backend server over secure HTTP (HTTPS) and secure WebSockets (WSS).

### C. Can a release build accidentally use `http://localhost:5001`, `10.0.2.2`, or cleartext HTTP?
**Yes, if misconfigured.** The current build configurations use `VITE_API_URL` baked in at build time. If the build environment lacks a production environment variable override, Vite will fall back to using `.env` values (`http://localhost:5001/api`).
Additionally, if `cleartextTrafficPermitted="true"` is not stripped or isolated to debug-only files, a release APK could potentially allow cleartext HTTP fallback, exposing users to eavesdropping.

### D. Does the release build enforce HTTPS for the remote backend?
Yes, provided the build environment injects a valid `https://` URL during the asset compilation step, and the Android Network Security Config restricts cleartext traffic.

### E. Does changing `androidScheme` from HTTPS to HTTP weaken security?
**Yes, significantly.** 
* **Secure Contexts**: While modern Chromium treats `http://localhost` as a secure context, running the app container itself on `http` opens up the application code to loopback interception if another process runs on the device.
* **Mixed-Content Protection**: Operating the WebView on an HTTP origin (`http://localhost`) relaxes the browser's mixed-content restrictions, allowing the app to make cleartext requests to external HTTP sources without triggering default secure console blocks.
* **Secure Cookies**: If the app runs on `http://localhost`, it loses the strict guarantee of secure HTTPS transmission for all locally stored assets.

### F. Are refresh cookies still marked Secure in production?
**Yes.** The server's `auth.ts` configures:
`secure: process.env.NODE_ENV === 'production'`
This ensures that when the server is deployed to production, the cookie is sent with the `Secure` flag.

### G. Can Secure cookies function under the current emulator HTTP topology?
**No.** If `secure` were set to `true` in the emulator, the browser would refuse to send the cookie over `http://localhost:5001` because the connection lacks TLS.

### H. Is authentication behavior being changed between emulator and production?
**Yes, there is a configuration drift.**
* **In Emulator (Dev)**: Cookies are `secure: false`, `sameSite: 'lax'`, and app runs on `http://localhost`.
* **In Production (Prod)**: Cookies are `secure: true`, `sameSite: 'none'`, and app runs on `https://localhost` targeting an HTTPS server.
This mismatch means the production cookie paths, SameSite matching, and Secure contexts are not being verified in their final production configuration during local runtime testing.

### I. Is `CookieManager.flush()` sufficient for all termination cases?
**No.** `CookieManager.flush()` writes in-memory WebView cookies to disk asynchronously. While calling it during `onPause` guarantees persistence during typical user lifecycle events (home press, backgrounding), it does **not** protect against immediate process crashes, system low-memory terminations (`SIGKILL` while in foreground), or kernel panics, where the app process is terminated before executing any lifecycle methods.

### J. Does persistence of the refresh cookie after force-stop violate the threat model?
**No.** The design of silent refresh requires the refresh token to persist on-disk so that the user does not have to re-enter credentials on cold app launches. Security is enforced through Refresh Token Rotation (RTR) on the server, which detects replay attacks and revokes the token family.

---

## 2. Release Security Blocker Findings

Based on this review, we have identified **two critical release blockers** that must be resolved before Phase 3:
1. **App Origin Scheme Drift**: Changing `androidScheme` to `http` in `capacitor.config.ts` applies globally. In a production build, the native app will run on `http://localhost`, violating secure transport rules.
2. **Missing Build Verification**: The project lacks a release build gate check to ensure that the baked `VITE_API_URL` uses secure HTTPS/WSS and fails if it references localhost or loopback addresses.
