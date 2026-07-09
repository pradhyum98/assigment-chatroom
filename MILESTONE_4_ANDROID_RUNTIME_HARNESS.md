# Milestone 4 — Android Runtime Harness

This document describes the structure, requirements, and commands for running the reproducible Android WebView debugging and simulation harness.

---

## 1. Harness Requirements

The harness runs on the macOS host and uses the Chrome DevTools Protocol (CDP) WebSocket interface to execute remote scripting commands inside the Android WebView.

**Prerequisites**:
1. Node.js `v22` (packaged with `ws` dependency).
2. Android SDK platform-tools in PATH.
3. Pixel_API_34 emulator booted and running the target secure chat app.

---

## 2. Command Reference

All commands are driven via the harness CLI script located at [harness.js](file:///Users/pradhyumupadhyay/assigment%20chat%20room/client/scripts/android-runtime/harness.js):

### A. Port Forwarding Configuration
Establishes port forwarding from host port `9223` to the active WebView process UNIX socket:
```bash
node client/scripts/android-runtime/harness.js setup-forwarding
```

### B. Session Diagnostics
Fetches stored auth indicators, session state, and localStorage keys:
```bash
node client/scripts/android-runtime/harness.js diagnostics
```

### C. Programmatic Signup
Triggers form values input and submits the signup page flow:
```bash
node client/scripts/android-runtime/harness.js signup [custom_email@example.com]
```

### D. Programmatic Login
Navigates to `/login` and executes user signin:
```bash
node client/scripts/android-runtime/harness.js login user@example.com
```

### E. Simulate Network Off/On States
Dispatches HTML5 network visibility events inside the page:
```bash
node client/scripts/android-runtime/harness.js offline
node client/scripts/android-runtime/harness.js online
```

### F. Simulate Lifecycle Resume
Triggers platform state update events to wake up connection listeners:
```bash
node client/scripts/android-runtime/harness.js resume
```

### G. Database Metadata Inspection
Opens and queries IndexedDB schemas from within the WebView context:
```bash
node client/scripts/android-runtime/harness.js inspect-idb
```
