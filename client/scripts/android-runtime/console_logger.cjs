const WebSocket = require('/Users/pradhyumupadhyay/assigment chat room/client/node_modules/ws');
const http = require('http');
const { execSync } = require('child_process');

const ADB = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools && adb';

function runAdb(cmd) {
  try {
    return execSync(`${ADB} ${cmd}`, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (err) {
    console.error(`[ADB] Command failed: adb ${cmd}`, err.message);
    throw err;
  }
}

function setupForwarding() {
  const output = runAdb('shell cat /proc/net/unix | grep devtools');
  const matches = output.match(/@webview_devtools_remote_\d+/);
  if (!matches) {
    throw new Error('No active WebView remote socket found. Is the app running?');
  }
  const socketName = matches[0];
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

async function run() {
  setupForwarding();
  const wsUrl = await getWebSocketUrl();
  console.log('[Console Logger] Connecting:', wsUrl);
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[Console Logger] Connected. Enabling Console & Runtime...');
    ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
    ws.send(JSON.stringify({ id: 3, method: 'Log.enable' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    
    // Check for console API calls (console.log, console.error, etc)
    if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params.type;
      const args = msg.params.args.map(arg => arg.value || JSON.stringify(arg)).join(' ');
      console.log(`[WebView Console ${type.toUpperCase()}]`, args);
    }
    
    // Check for unhandled exceptions
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[WebView Exception]', JSON.stringify(msg.params.exceptionDetails, null, 2));
    }

    // Check for standard log entries
    if (msg.method === 'Log.entryAdded') {
      console.log('[WebView Log]', msg.params.entry.text);
    }
  });

  ws.on('error', console.error);
}

run().catch(console.error);
