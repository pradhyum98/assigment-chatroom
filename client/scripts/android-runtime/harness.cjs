const WebSocket = require('/Users/pradhyumupadhyay/assigment chat room/client/node_modules/ws');
const http = require('http');
const { execSync } = require('child_process');

function runAdb(cmd) {
  try {
    const adbPath = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools && adb';
    return execSync(`${adbPath} ${cmd}`, { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error(`[ADB] Command failed: adb ${cmd}`, err.message);
    throw err;
  }
}

function setupForwarding() {
  try {
    const output = runAdb('shell cat /proc/net/unix | grep devtools');
    const matches = output.match(/@webview_devtools_remote_\d+/);
    if (!matches) {
      throw new Error('No webview devtools remote socket found in unix sockets list. Is the app running?');
    }
    const socketName = matches[0];
    console.log('[DevTools] Found active WebView socket:', socketName);
    runAdb('forward --remove tcp:9223 2>/dev/null || true');
    runAdb(`forward tcp:9223 localabstract:${socketName.substring(1)}`);
    console.log('[DevTools] Port forward established: tcp:9223 -> localabstract:' + socketName.substring(1));
  } catch (err) {
    console.error('[DevTools] Failed to setup port forwarding:', err.message);
    throw err;
  }
}

function getWebSocketUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9223/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.length > 0) {
            resolve(json[0].webSocketDebuggerUrl);
          } else {
            reject(new Error('No active WebView targets found.'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function runCommand(ws, expression, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const payload = JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression,
        returnByValue: true,
        awaitPromise: true
      }
    });

    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Runtime.evaluate timed out after ${timeoutMs}ms for expression: ${expression.slice(0, 80)}`));
    }, timeoutMs);

    const handler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(response.result ? response.result.result : null);
        }
      } catch (e) { /* ignore non-matching messages */ }
    };

    ws.on('message', handler);
    ws.send(payload);
  });
}

async function executeAction(action, args) {
  setupForwarding();
  const wsUrl = await getWebSocketUrl();
  console.log('[DevTools] Connecting to WebView target:', wsUrl);
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    ws.on('open', async () => {
      console.log('[DevTools] Debugger session attached.');
      try {
        // Enable the Runtime domain — required on Android WebViews before Runtime.evaluate responds
        await new Promise((res) => {
          const enableId = Math.floor(Math.random() * 1000000);
          const timer = setTimeout(res, 3000); // proceed even if no ack
          const handler = (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.id === enableId) {
                clearTimeout(timer);
                ws.off('message', handler);
                res();
              }
            } catch (e) {}
          };
          ws.on('message', handler);
          ws.send(JSON.stringify({ id: enableId, method: 'Runtime.enable' }));
        });
        let result;
        switch (action) {
          case 'url':
            result = await runCommand(ws, 'window.location.href');
            console.log('[WebView] URL:', result.value);
            break;

          case 'signup': {
            const email = args[0] || `emu_${Math.floor(Math.random() * 100000)}@example.com`;
            console.log(`[WebView] Executing Signup with: ${email}`);
            result = await runCommand(ws, `
              (async () => {
                function setReactInputValue(input, value) {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                  setter.call(input, value);
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // If not on signup, click link
                if (!window.location.href.includes('/signup')) {
                  const signupLink = document.querySelector('a[href="/signup"]');
                  if (signupLink) signupLink.click();
                  await new Promise(r => setTimeout(r, 1000));
                }

                const firstInput = document.querySelector('input[name="firstName"]');
                const lastInput = document.querySelector('input[name="lastName"]');
                const emailInput = document.querySelector('input[name="email"]');
                const passInput = document.querySelector('input[name="password"]');

                if (firstInput && lastInput && emailInput && passInput) {
                  setReactInputValue(firstInput, 'Emu');
                  setReactInputValue(lastInput, 'Tester');
                  setReactInputValue(emailInput, '${email}');
                  setReactInputValue(passInput, 'Password123!');

                  const submitBtn = document.querySelector('button[type="submit"]');
                  if (submitBtn) {
                    submitBtn.click();
                    return 'Triggered signup form submission';
                  }
                }
                return 'Signup input elements not found';
              })()
            `);
            console.log('[WebView] Signup Trigger:', result.value);
            break;
          }

          case 'login': {
            const email = args[0];
            const password = args[1] || '123456';
            if (!email) {
              console.error('Error: login action requires email parameter');
              break;
            }
            console.log(`[WebView] Executing Login with: ${email}`);
            result = await runCommand(ws, `
              (async () => {
                function setReactInputValue(input, value) {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                  setter.call(input, value);
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }

                if (!window.location.href.includes('/login')) {
                  window.location.hash = '/login';
                  await new Promise(r => setTimeout(r, 1000));
                }

                const emailInput = document.querySelector('input[type="email"]');
                const passInput = document.querySelector('input[type="password"]');

                if (emailInput && passInput) {
                  setReactInputValue(emailInput, '${email}');
                  setReactInputValue(passInput, '${password}');

                  const submitBtn = document.querySelector('button[type="submit"]');
                  if (submitBtn) {
                    submitBtn.click();
                    return 'Triggered login form submission';
                  }
                }
                return 'Login input elements not found';
              })()
            `);
            console.log('[WebView] Login Trigger:', result.value);
            break;
          }

          case 'logout':
            result = await runCommand(ws, `
              (() => {
                const logoutBtn = document.querySelector('button[title="Logout"]');
                if (logoutBtn) {
                  logoutBtn.click();
                  return 'Clicked logout button';
                }
                return 'Logout button not found';
              })()
            `);
            console.log('[WebView] Logout Trigger:', result.value);
            break;

          case 'clear':
            result = await runCommand(ws, `
              (() => {
                localStorage.clear();
                window.location.hash = '/login';
                return 'Session cleared, redirected to /login';
              })()
            `);
            console.log('[WebView] Session Clear:', result.value);
            break;

          case 'offline':
            result = await runCommand(ws, 'window.dispatchEvent(new Event("offline"))');
            console.log('[WebView] Dispatched offline event');
            break;

          case 'online':
            result = await runCommand(ws, 'window.dispatchEvent(new Event("online"))');
            console.log('[WebView] Dispatched online event');
            break;

          case 'resume':
            result = await runCommand(ws, 'window.dispatchEvent(new Event("resume"))');
            console.log('[WebView] Dispatched resume event');
            break;

          case 'diagnostics':
            result = await runCommand(ws, `
              (() => {
                return {
                  url: window.location.href,
                  localStorageKeys: Object.keys(localStorage),
                  hasSession: localStorage.getItem('hasSession'),
                  isLoggedIn: !!document.querySelector('.sidebar')
                };
              })()
            `);
            console.log('[WebView] Diagnostics Snapshot:', result.value);
            break;

          case 'body-text':
            result = await runCommand(ws, 'document.body.innerText');
            console.log('[WebView] Body Text:\n', result.value);
            break;

          case 'inspect-idb':
            result = await runCommand(ws, `
              new Promise((resolve) => {
                const req = indexedDB.open('secure_chat_canonical');
                req.onsuccess = () => {
                  const db = req.result;
                  const storeNames = Array.from(db.objectStoreNames);
                  db.close();
                  resolve({
                    dbName: db.name,
                    version: db.version,
                    stores: storeNames
                  });
                };
                req.onerror = () => resolve({ error: 'Failed to open canonical IDB' });
              })
            `);
            console.log('[WebView] IndexedDB Metadata:', result.value);
            break;

          case 'inspect-store': {
            const storeName = args[0] || 'user_cursor';
            console.log(`[WebView] Reading from store: ${storeName}`);
            result = await runCommand(ws, `
              new Promise((resolve) => {
                const req = indexedDB.open('secure_chat_canonical');
                req.onsuccess = () => {
                  const db = req.result;
                  if (!Array.from(db.objectStoreNames).includes('${storeName}')) {
                    db.close();
                    resolve({ error: 'Store "${storeName}" not found' });
                    return;
                  }
                  const tx = db.transaction('${storeName}', 'readonly');
                  const store = tx.objectStore('${storeName}');
                  const fetchReq = store.getAll();
                  fetchReq.onsuccess = () => {
                    db.close();
                    resolve(fetchReq.result);
                  };
                  fetchReq.onerror = () => {
                    db.close();
                    resolve({ error: 'Failed to read store "${storeName}"' });
                  };
                };
                req.onerror = () => resolve({ error: 'Failed to open canonical IDB' });
              })
            `);
            console.log('[WebView] Store Data:', result.value);
            break;
          }

          case 'eval': {
            const code = args.join(' ');
            console.log(`[WebView] Evaluating: ${code}`);
            result = await runCommand(ws, code);
            console.log('[WebView] Result:', result ? result.value : null);
            break;
          }

          case 'accept-all-requests': {
            result = await runCommand(ws, `
              (() => {
                const btns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Accept');
                btns.forEach(b => b.click());
                return 'Clicked ' + btns.length + ' accept buttons';
              })()
            `);
            console.log('[WebView] Accept requests:', result ? result.value : null);
            break;
          }

          case 'send-message': {
            const msg = args.join(' ') || 'Hello from harness';
            result = await runCommand(ws, `
              (async () => {
                const inp = document.querySelector('textarea, input[placeholder*="message"], input[placeholder*="Message"]');
                if (!inp) return 'Message input not found';
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, '${msg.replace(/'/g, "\\'").replace(/"/g, '\\"')}');
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 300));
                const sendBtn = document.querySelector('button[type="submit"], button[aria-label*="Send"], button[title*="Send"]');
                if (sendBtn) { sendBtn.click(); return 'Message sent: ${msg.slice(0,40)}'; }
                inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                return 'Pressed Enter to send';
              })()
            `);
            console.log('[WebView] Send Message:', result ? result.value : null);
            break;
          }

          default:
            console.log(`Unknown harness action: ${action}`);
        }
        ws.close();
        resolve();
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

function printUsage() {
  console.log(`
Usage: node harness.cjs <action> [args]

Actions:
  setup-forwarding     Scan remote debugging ports and set port forwarding to 9223
  url                  Get current WebView page URL
  signup [email]       Simulate React user signup
  login <email>        Simulate React user login
  logout               Trigger user logout
  offline              Dispatch HTML5 offline event
  online               Dispatch HTML5 online event
  resume               Dispatch app state resume event
  diagnostics          Retrieve active storage and UI session indicators
  inspect-idb          Inspect local canonical IndexedDB stores schema
`);
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  if (!action || action === '--help' || action === '-h') {
    printUsage();
    process.exit(0);
  }

  if (action === 'setup-forwarding') {
    setupForwarding();
    process.exit(0);
  }

  try {
    await executeAction(action, args.slice(1));
    process.exit(0);
  } catch (err) {
    console.error('[Harness] Error executing action:', err.message);
    process.exit(1);
  }
}

main();
