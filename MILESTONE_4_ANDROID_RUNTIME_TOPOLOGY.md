# Android WebView Runtime & Network Topology

This document describes the runtime network paths, port mappings, and security transport boundaries configured for executing the Capacitor application inside the Android WebView.

---

## 1. Network Topology Map

```
Android WebView (Pixel_API_34)
  │
  │ Origin: https://localhost (Secure Scheme)
  ▼
API / WebSocket Client
  │
  ├─► HTTP API Base: http://10.0.2.2:5001/api
  └─► Socket.IO Connection: http://10.0.2.2:5001
  │
  ▼
Android Emulator NAT Gateway
  │
  ▼
Host Machine Loopback (macOS Host)
  ├─► Node.js / Express Server (Port 5001)
  │     └─► MongoDB Atlas (Cloud Database Cluster)
  │     └─► Local Media Storage Fallback
  ▼
Chrome DevTools Debug Protocol
  ├─► Local forward: tcp:9223 -> localabstract:webview_devtools_remote_5807
  └─► DevTools WebSocket Client (WS Connection on Port 9223)
```

---

## 2. Security Boundaries & Transport Invariants

### A. Mixed Content WebView Restrictions
Because our application is loaded inside WebView over a secure scheme (`https://localhost`), Chromium restricts calling insecure endpoints (`http://10.0.2.2:5001`) under the **Mixed Content policy**.
- *Resolution implemented*: Configured `MainActivity.java` programmatically in the development build:
  `settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);`
  This enables cleartext API requests to local subnet addresses without failing compile checks.

### B. Network Security Configuration
Android 9 (API 28+) disables cleartext HTTP traffic by default.
- *Resolution implemented*: Added `android:usesCleartextTraffic="true"` to `AndroidManifest.xml` to allow network requests to bypass OS security boundaries for development debugging.

---

## 3. Cookie Transport Blocker Analysis

During warm restart and relaunch verification, the refresh token cookie was dropped, triggering `401: Refresh token is missing`.

This is a fundamental browser-security layout blocker:
1. **Cross-Site Context**: Since the client origin is `https://localhost` and the API server is `http://10.0.2.2:5001`, this is cross-site. Mapped cookies require `SameSite=None`.
2. **Secure Enforce Invariant**: Modern browser specs dictate that any cookie with `SameSite=None` **must** be set with the `Secure` flag.
3. **Insecure Transport Drop**: If `Secure` is true, the WebView blocks storing/sending the cookie because the API request is made over insecure HTTP (`http://10.0.2.2:5001`). If `Secure` is false, it gets blocked because `SameSite=None` requires `Secure`.

**Conclusion**: Cross-origin cleartext development endpoints cannot securely support HttpOnly authentication cookie persistence in native WebViews. This blocker resolves naturally in production environments where both client and server communicate strictly over HTTPS.
