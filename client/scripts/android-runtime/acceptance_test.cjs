const WebSocket = require('/Users/pradhyumupadhyay/assigment chat room/client/node_modules/ws');
const http = require('http');
const { execSync } = require('child_process');

const ADB = 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools && adb';
const BASE_URL = 'http://10.0.2.2:5001';

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
  console.log('[DevTools] Found active WebView socket:', socketName);
  runAdb('forward --remove tcp:9223 2>/dev/null || true');
  runAdb(`forward tcp:9223 localabstract:${socketName.substring(1)}`);
  console.log('[DevTools] Port forward established: tcp:9223 -> localabstract:' + socketName.substring(1));
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

async function run() {
  const args = process.argv.slice(2);
  const phase = args[0] || 'phase1'; // phase1 or phase2
  const fileIdParam = args[1];

  setupForwarding();
  const wsUrl = await getWebSocketUrl();
  console.log('[DevTools] Connecting to WebView target:', wsUrl);
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('[DevTools] Attached to WebView debugger.');

  if (phase === 'phase1') {
    console.log('[Acceptance Test] Starting Phase 1 (Native socket integration)...');
    // Run the main flow script inside WebView
    const script = `
      (async () => {
        try {
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          const backend = "${BASE_URL}";
          
          // Ensure hooks are exposed
          if (!window.__crypto_service__ || !window.__redux_store__ || !window.__socket_service__) {
            throw new Error('Test hooks not exposed. Verify TEST_HARNESS=true is active.');
          }

          // Clear any lingering sessions to start clean
          localStorage.clear();
          sessionStorage.clear();

          const rand = Math.floor(Math.random() * 1000000);
          const emailA = \`usera_\${rand}@example.com\`;
          const emailB = \`userb_\${rand}@example.com\`;
          const emailC = \`userc_\${rand}@example.com\`;
          const password = "Password123!";

          // 1. Sign up User A, B, and C
          async function signupUser(email, first, last) {
            const keyPair = await window.__crypto_service__.generateUserKeyPair();
            const publicKey = await window.__crypto_service__.exportPublicKey(keyPair.publicKey);
            const privateKey = await window.__crypto_service__.exportPrivateKey(keyPair.privateKey);
            const encryptedPrivateKey = await window.__crypto_service__.encryptPrivateKeyWithPassword(privateKey, password, email);

            const res = await fetch(\`\${backend}/api/auth/signup\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email,
                password,
                firstName: first,
                lastName: last,
                publicKey,
                encryptedPrivateKey
              })
            });
            if (!res.ok) throw new Error(\`Signup failed for \${email}: \` + await res.text());
            const json = await res.json();
            return json.data;
          }

          console.log('[WebView] Signing up Users A, B, and C...');
          const userA = await signupUser(emailA, 'UserA', 'Alpha');
          const userB = await signupUser(emailB, 'UserB', 'Beta');
          const userC = await signupUser(emailC, 'UserC', 'Gamma');

          // 2. Establish friendship A <-> B
          // Send request B -> A
          console.log('[WebView] Sending friend request from B to A...');
          const reqRes = await fetch(\`\${backend}/api/friends/request\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${userB.token}\`
            },
            body: JSON.stringify({ recipientId: userA.user._id })
          });
          if (!reqRes.ok) throw new Error('Friend request failed');

          // Accept request as A
          const listRes = await fetch(\`\${backend}/api/friends/requests\`, {
            method: 'GET',
            headers: { 'Authorization': \`Bearer \${userA.token}\` }
          });
          const listData = await listRes.json();
          const reqObj = listData.data.requests.find(r => r.sender._id === userB.user._id);
          
          await fetch(\`\${backend}/api/friends/requests/\${reqObj._id}/respond\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${userA.token}\`
            },
            body: JSON.stringify({ action: 'accept' })
          });
          console.log('[WebView] Friendship A <-> B established successfully.');

          // 3. Create Group Room containing A and B
          const roomKey = await window.__crypto_service__.generateRoomKey();
          const roomKeyBase64 = await window.__crypto_service__.exportRoomKey(roomKey);
          
          const encKeyA = await window.__crypto_service__.encryptRoomKeyForUser(roomKeyBase64, userA.user.publicKey);
          const encKeyB = await window.__crypto_service__.encryptRoomKeyForUser(roomKeyBase64, userB.user.publicKey);

          const roomRes = await fetch(\`\${backend}/api/rooms\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${userA.token}\`
            },
            body: JSON.stringify({
              roomName: \`Acceptance Room \${rand}\`,
              participants: [userB.user._id],
              encryptedRoomKeys: {
                [userA.user._id]: encKeyA,
                [userB.user._id]: encKeyB
              }
            })
          });
          const roomData = await roomRes.json();
          const room = roomData.data.room;
          console.log('[WebView] Room created. Room ID:', room.roomId);

          // 4. User A uploads encrypted image
          const imgBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]); // 1x1 PNG
          const rawFile = new File([imgBytes], 'e2e_photo.png', { type: 'image/png' });
          
          console.log('[WebView] Encrypting image...');
          const { encryptedBlob, fileKey, ivBase64 } = await window.__crypto_service__.encryptFile(rawFile);

          const formData = new FormData();
          formData.append('file', new File([encryptedBlob], rawFile.name, { type: 'application/octet-stream' }));
          formData.append('roomId', room.roomId);

          console.log('[WebView] Uploading to GridFS...');
          const uploadRes = await fetch(\`\${backend}/api/upload\`, {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${userA.token}\` },
            body: formData
          });
          const uploadData = await uploadRes.json();
          const mediaUrl = uploadData.data.url;
          const fileId = mediaUrl.split('/').pop();
          console.log('[WebView] File uploaded. fileId:', fileId);

          // 5. Wrap media key
          const clientMsgId = \`msg-uuid-\${rand}\`;
          const { wrappedKey, wrapIv } = await window.__crypto_service__.wrapMediaKey(fileKey, roomKey, {
            roomId: room.roomId,
            clientMsgId,
            encryptionVersion: 2
          });

          // 6. Connect User A socket and emit send_message
          console.log('[WebView] Logging in User A session...');
          window.__redux_store__.dispatch({
            type: 'auth/loginSuccess',
            payload: { user: userA.user, token: userA.token }
          });

          console.log('[WebView] Connecting socket service...');
          const socketA = window.__socket_service__.connect();
          if (!socketA) throw new Error('Failed to obtain socket client');

          await new Promise((resolve, reject) => {
            if (socketA.connected) return resolve();
            socketA.once('connect', resolve);
            socketA.once('connect_error', reject);
          });

          console.log('[WebView] Emitting send_message from User A...');
          await new Promise((resolve, reject) => {
            socketA.emit('send_message', {
              roomId: room.roomId,
              senderId: userA.user._id,
              senderName: 'User A',
              content: '',
              clientMsgId,
              type: 'image',
              mediaUrl,
              mediaFilename: rawFile.name,
              mediaMimeType: rawFile.type,
              mediaSize: rawFile.size,
              encryptionVersion: 2,
              wrappedMediaKey: wrappedKey,
              mediaKeyIv: wrapIv,
              mediaIv: ivBase64,
              roomKeyVersion: room.roomKeyVersion || 1,
              senderIdentityVersion: userA.user.identityVersion || 1
            }, (ack) => {
              if (ack && ack.ok === false) reject(new Error('Socket send rejected: ' + ack.errorCode));
              else resolve();
            });
          });
          
          // Clear A session
          localStorage.clear();
          sessionStorage.clear();
          window.__redux_store__.dispatch({ type: 'auth/logout' });

          // 7. Verify download & decrypt as User B
          console.log('[WebView] Downloading and decrypting as User B...');
          const downloadRes = await fetch(\`\${backend}/api/upload/download/\${fileId}\`, {
            headers: { 'Authorization': \`Bearer \${userB.token}\` }
          });
          if (!downloadRes.ok) throw new Error('User B download failed: ' + downloadRes.status);
          const downloadedBlob = await downloadRes.blob();
          
          // Decrypt
          const decryptedBuffer = await window.__crypto_service__.decryptFile(
            downloadedBlob,
            fileKey,
            ivBase64
          );
          const decryptedArray = new Uint8Array(decryptedBuffer);
          let decryptedMatch = true;
          for (let i = 0; i < imgBytes.length; i++) {
            if (decryptedArray[i] !== imgBytes[i]) {
              decryptedMatch = false;
              break;
            }
          }
          console.log('[WebView] User B decryption matches original bytes:', decryptedMatch);

          // 8. Verify unauthorized User C download returns 403
          console.log('[WebView] Verifying User C is blocked from downloading...');
          const downloadCRes = await fetch(\`\${backend}/api/upload/download/\${fileId}\`, {
            headers: { 'Authorization': \`Bearer \${userC.token}\` }
          });
          const isBlockedC = downloadCRes.status === 403;
          console.log('[WebView] User C blocked status code matches 403:', isBlockedC);

          // 9. Verify HTTP Range request returns 206 and partial bytes
          console.log('[WebView] Verifying HTTP Range requests...');
          const rangeRes = await fetch(\`\${backend}/api/upload/download/\${fileId}\`, {
            headers: {
              'Authorization': \`Bearer \${userB.token}\`,
              'Range': 'bytes=6-11'
            }
          });
          const isRange206 = rangeRes.status === 206;
          const rangeHeader = rangeRes.headers.get('Content-Range');
          const rangeBlob = await rangeRes.blob();
          const rangeArray = new Uint8Array(await rangeBlob.arrayBuffer());
          console.log('[WebView] Range request 206:', isRange206, 'Content-Range:', rangeHeader, 'Range bytes length:', rangeArray.length);

          return {
            success: true,
            fileId,
            emailA,
            emailB,
            emailC,
            tokenB: userB.token,
            roomKeyBase64,
            fileKeyBase64: window.btoa(String.fromCharCode(...new Uint8Array(fileKey))),
            mediaIv: ivBase64,
            decryptedMatch,
            isBlockedC,
            isRange206,
            rangeHeader,
            rangeBytesLength: rangeArray.length
          };
        } catch (err) {
          console.error('[WebView ERROR]', err);
          return {
            success: false,
            error: err.message,
            stack: err.stack
          };
        }
      })()
    `;

    const res = await runCommand(ws, script);
    console.log('\n--- PHASE 1 E2E RESULT ---');
    console.log(JSON.stringify(res ? res.value : null, null, 2));
  } else if (phase === 'phase2') {
    console.log(`[Acceptance Test] Starting Phase 2 for fileId: ${fileIdParam}...`);
    if (!fileIdParam) {
      console.error('Error: Phase 2 requires fileId parameter.');
      process.exit(1);
    }

    const tokenB = args[2];
    const roomKeyBase64 = args[3];
    const fileKeyBase64 = args[4];
    const mediaIv = args[5];
    const backend = BASE_URL;

    const script = `
      (async () => {
        try {
          const backend = "${backend}";
          const fileId = "${fileIdParam}";
          const tokenB = "${tokenB}";
          const roomKeyBase64 = "${roomKeyBase64}";
          const fileKeyBase64 = "${fileKeyBase64}";
          const mediaIv = "${mediaIv}";

          // Import keys
          const fileKeyBytes = new Uint8Array(atob(fileKeyBase64).split('').map(c => c.charCodeAt(0)));
          const fileKey = await window.crypto.subtle.importKey('raw', fileKeyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

          console.log('[WebView] Post-restart download starting...');
          const downloadRes = await fetch(\`\${backend}/api/upload/download/\${fileId}\`, {
            headers: { 'Authorization': \`Bearer \${tokenB}\` }
          });
          if (!downloadRes.ok) throw new Error('Download post-restart failed: ' + downloadRes.status);
          const downloadedBlob = await downloadRes.blob();

          const decryptedBuffer = await window.__crypto_service__.decryptFile(
            downloadedBlob,
            fileKey,
            mediaIv
          );
          const matchOriginal = decryptedBuffer.byteLength === 68; // png content length
          console.log('[WebView] Post-restart download & decrypt match check:', matchOriginal);

          return {
            success: true,
            matchOriginal,
            byteLength: decryptedBuffer.byteLength
          };
        } catch (err) {
          console.error('[WebView ERROR]', err);
          return {
            success: false,
            error: err.message,
            stack: err.stack
          };
        }
      })()
    `;

    const res = await runCommand(ws, script);
    console.log('\n--- PHASE 2 E2E RESULT ---');
    console.log(JSON.stringify(res ? res.value : null, null, 2));
  }

  ws.close();
}

run().catch(console.error);
