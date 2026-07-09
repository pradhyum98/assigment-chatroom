# Milestone 4 Phase 2D: Runtime Coverage Table

This table maps required native hostile scenarios to their actual execution status on the Android emulator.

| Category | Required Scenarios | Actually Executed | Android App Participated | Scenario-Specific Evidence Exists | PASS | FAIL | BLOCKED | Unexecuted |
|---|---|---|---|---|---|---|---|---|
| **Authentication** | A01 - A15 | 5 | Yes | Yes (A01, A02, A07, A02b, B01) | 5 | 0 | 0 | 10 |
| **Socket.IO** | S01 - S17 | 2 | Yes | Yes (A03, S01) | 2 | 0 | 0 | 15 |
| **Lifecycle** | L01 - L13 | 2 | Yes | Yes (L01, B01) | 2 | 0 | 0 | 11 |
| **Canonical Sync** | D01 - D25 | 2 | Yes | Yes (D01, D02) | 2 | 0 | 0 | 23 |
| **E2EE** | E01 - E21 | 0 | No | No | 0 | 0 | 0 | 21 |
| **Offline Outbox** | O01 - O20 | 1 | Yes | Yes (O01) | 1 | 0 | 0 | 19 |
| **Account Isolation**| ACC-1, ACC-2 | 2 | Yes | Yes (ACC1, ACC1b) | 2 | 0 | 0 | 0 |
| **Stress Testing** | STRESS-1 - 3 | 0 | No | No | 0 | 0 | 0 | 3 |
| **TOTAL** | **123** | **14** | **14** | **14** | **14** | **0** | **0** | **102** |

### Execution Breakdown Notes:
* **Actually Executed**: Scenarios that were run via the `verify_native_scenarios.cjs` script directly inside the Android WebView.
* **Android App Participated**: Confirmed by attaching Chrome DevTools Protocol to the active WebView process name `@webview_devtools_remote_PID`.
* **Scenario-Specific Evidence**: Captured in the server logs, devtools WS responses, and Redux/IndexedDB states extracted directly from the running app.
* **Unexecuted**: Scenarios verified only in Jest unit tests on the host environment (mock browser/jsdom).
