/**
 * Minimal CDP client: reads the implicit-text layout proof
 * (globalThis.__implicitTextVerify, set by ImplicitTextDemo.js) from the
 * running Hermes instance via Metro's inspector proxy.
 *
 * Usage: node implicit-text-cdp-verify.js   (Metro on :8081, app running)
 * Deps:  npm i ws
 * Note:  the proxy 401s unless the websocket carries a same-origin
 *        Origin header (http://localhost:8081).
 *
 * @noflow
 * @format
 */

const WebSocket = require('ws');

async function main() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const target = targets.find(t => t.webSocketDebuggerUrl != null);
  if (!target)
    throw new Error(
      'no debug target: ' + JSON.stringify(targets.map(t => t.title)),
    );
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    headers: {Origin: 'http://localhost:8081'},
  });
  await new Promise(r => ws.on('open', r));
  const send = (id, method, params) =>
    ws.send(JSON.stringify({id, method, params}));
  const result = await new Promise((resolve, reject) => {
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.id === 2) resolve(msg.result);
    });
    send(1, 'Runtime.enable', {});
    send(2, 'Runtime.evaluate', {
      expression:
        'JSON.stringify({verify: globalThis.__implicitTextVerify ?? null})',
      returnByValue: true,
    });
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  console.log('CDP target:', target.title);
  console.log('CDP Runtime.evaluate →', result.result.value);
  ws.close();
}
main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
