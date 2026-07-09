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
  const output = runAdb('shell cat /proc/net/unix | grep devtools');
  const matches = output.match(/@webview_devtools_remote_\d+/);
  if (!matches) {
    throw new Error('No webview devtools remote socket found. Is the app running?');
  }
  const socketName = matches[0];
  console.log('[DevTools] Found active WebView socket:', socketName);
  runAdb('forward --remove tcp:9223 2>/dev/null || true');
  runAdb(`forward tcp:9223 localabstract:${socketName.substring(1)}`);
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

function runCommand(ws, expression) {
  return new Promise((resolve) => {
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

    const handler = (data) => {
      const response = JSON.parse(data.toString());
      if (response.id === id) {
        ws.off('message', handler);
        resolve(response.result ? response.result.result : null);
      }
    };

    ws.on('message', handler);
    ws.send(payload);
  });
}

async function testFetch() {
  setupForwarding();
  const wsUrl = await getWebSocketUrl();
  const ws = new WebSocket(wsUrl);

  ws.on('open', async () => {
    try {
      const res = await runCommand(ws, `
        (async () => {
          try {
            const r = await fetch('http://10.0.2.2:5001/api/auth/signup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({})
            });
            return { status: r.status, statusText: r.statusText };
          } catch (e) {
            return { error: e.message };
          }
        })()
      `);
      console.log('[Test Fetch Result]:', res.value);
      ws.close();
      process.exit(0);
    } catch (err) {
      console.error(err);
      ws.close();
      process.exit(1);
    }
  });
}

testFetch();
