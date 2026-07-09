# Android Security Configuration Audit

This document presents a hostile security audit of the Android Capacitor container native settings, manifest properties, and URL resolution logic.

---

## 1. WebView Security Configuration Audit

### A. Mixed Content Policy (`setMixedContentMode`)
- **Configured Mode**: `WebSettings.MIXED_CONTENT_ALWAYS_ALLOW`
- **Audit Findings**: Enabling mixed content is required in local development to allow the app loaded over a secure origin (`https://localhost`) to make REST and WebSocket requests to the cleartext local host loopback interface (`http://10.0.2.2:5001`).
- **Defensive Safeguards**: Wrapped strictly within a debuggable flag check in [MainActivity.java](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/android/app/src/main/java/com/securechat/pwa/MainActivity.java):
  ```java
  boolean isDebuggable = (0 != (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE));
  if (isDebuggable) {
      settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
  }
  ```
- **Production Boundary**: In production release builds, `isDebuggable` is false. The WebView rejects mixed content, ensuring that no arbitrary HTTP resources can load under the secure context.

### B. Third-Party Cookie Policy (`setAcceptThirdPartyCookies`)
- **Audit Findings**: Because the web application container runs on origin `https://localhost` while the API backend runs on `http://10.0.2.2:5001`, requests are cross-site. Android WebView defaults to dropping third-party cookies.
- **Defensive Safeguards**: Centralized and bound strictly to debug builds inside [MainActivity.java](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/android/app/src/main/java/com/securechat/pwa/MainActivity.java):
  ```java
  if (isDebuggable) {
      CookieManager cookieManager = CookieManager.getInstance();
      cookieManager.setAcceptThirdPartyCookies(webView, true);
  }
  ```
- **Production Boundary**: In production, the client (`https://localhost`) and production API backend (e.g. `https://api.securechat.com`) run under HTTPS, so cookies are securely handled without requiring wildcard third-party overrides.

---

## 2. OS-Level Manifest Security Audit

### C. Cleartext Traffic Policy (`usesCleartextTraffic`)
- **Audit Findings**: Android 9+ disables cleartext HTTP by default. Putting `android:usesCleartextTraffic="true"` in the main manifest is a security risk for production packages.
- **Remediation Implemented**:
  1. Removed `usesCleartextTraffic` entirely from the main manifest [AndroidManifest.xml](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/android/app/src/main/AndroidManifest.xml).
  2. Created a dedicated debug manifest [AndroidManifest.xml](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/android/app/src/debug/AndroidManifest.xml) containing:
     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <manifest xmlns:android="http://schemas.android.com/apk/res/android">
         <application android:usesCleartextTraffic="true">
         </application>
     </manifest>
     ```
- **Compilation Merged Manifest Verification**:
  - Debug compiled merged manifest: **CONTAINS** `usesCleartextTraffic="true"` (line 29).
  - Release compiled merged manifest: **DOES NOT CONTAIN** `usesCleartextTraffic` (grep query returns empty).

---

## 3. Hostname Translation Logic (`localhost` -> `10.0.2.2`)

- **Centralized Resolution Helper**: Implemented centralized resolver `resolveUrl` in [PlatformService.ts](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/src/platform/PlatformService.ts):
  ```typescript
  resolveUrl(url: string): string {
    const isDev = import.meta.env.DEV;
    const caps = this.getCapabilities();
    if (isDev && caps.isNative && caps.platform === 'android' && url.includes('localhost')) {
      return url.replace('localhost', '10.0.2.2');
    }
    return url;
  }
  ```
- **Target Invariant Validation**:
  - **Android Emulator**: Translates `localhost` to `10.0.2.2` in development.
  - **iOS Simulator**: `caps.platform` is `'ios'`, so it does not translate, preserving `localhost` (which maps to host 127.0.0.1 on macOS).
  - **Physical Devices**: Do not contain `localhost` in production backend API configurations, so no translation occurs.
  - **Production Builds**: `import.meta.env.DEV` is false, ensuring production API URLs can never be mutated.
- **Axios & Sockets Integration**: Centralized resolution is shared across:
  - Axios service configuration [api.ts](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/src/services/api.ts).
  - Socket.IO service configuration [socket.ts](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/src/services/socket.ts).
  - Chat Window media rendering [ChatWindow.tsx](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/src/features/chat/ChatWindow.tsx).
- **Regression Verification**: Added comprehensive unit tests in [platformLifecycle.test.ts](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/src/tests/platformLifecycle.test.ts) confirming all platform constraints.
