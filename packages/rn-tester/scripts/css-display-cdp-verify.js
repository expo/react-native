/**
 * CDP verification for the css-display example screens (Display: block,
 * Display: inline): launches RNTester directly into each screen via the
 * `-route <name>` launch argument (AppDelegate maps it to
 * rntester://example/<name>Example as initial props — no URL-scheme
 * confirmation dialogs), lets the cases publish their rects to
 * `globalThis.__displayVerify` (measureInWindow in TextChildrenShared's
 * usePublishRects), reads them from the Hermes instance through Metro's
 * inspector proxy, and asserts the display:'block'/'inline' and
 * margin-collapsing layout relations — view-tree numbers, no screenshots.
 *
 * Usage: node css-display-cdp-verify.js   (Metro on :8081, simulator booted,
 *        RNTester installed)
 *
 * @noflow
 * @format
 */

const {execSync} = require('node:child_process');
const WebSocket = require('ws');

const BUNDLE_ID = 'dev.expo.rntester';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readVerifyObject() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const target = targets.find(t => t.webSocketDebuggerUrl != null);
  if (!target) {
    throw new Error(
      'no debug target: ' + JSON.stringify(targets.map(t => t.title)),
    );
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    headers: {Origin: 'http://localhost:8081'},
  });
  await new Promise(r => ws.on('open', r));
  const send = (id, method, params) =>
    ws.send(JSON.stringify({id, method, params}));
  const result = await new Promise((resolve, reject) => {
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.id === 2) {
        resolve(msg.result);
      }
    });
    send(1, 'Runtime.enable', {});
    send(2, 'Runtime.evaluate', {
      expression: 'JSON.stringify(globalThis.__displayVerify ?? null)',
      returnByValue: true,
    });
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  ws.close();
  return JSON.parse(result.result.value);
}

// Launches the app into one example screen and polls until its rects publish
// (each relaunch restarts Hermes, so rects are read per screen and merged).
async function readScreen(route) {
  execSync(`xcrun simctl terminate booted ${BUNDLE_ID} 2>/dev/null || true`);
  await sleep(1000);
  execSync(`xcrun simctl launch booted ${BUNDLE_ID} -route ${route}`);
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(3000);
    try {
      const v = await readVerifyObject();
      if (v != null) {
        return v;
      }
    } catch (e) {
      // Bundle still loading / inspector target not up yet — retry.
    }
  }
  throw new Error(`rects never published for route ${route}`);
}

function check(name, actual, expected, tolerance = 0.5) {
  const pass = Math.abs(actual - expected) <= tolerance;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}: ${actual} ${
      pass ? '≈' : '≠'
    } ${expected}`,
  );
  return pass;
}

async function main() {
  const v = {
    ...(await readScreen('DisplayBlock')),
    ...(await readScreen('DisplayInline')),
  };
  console.log('rects:', JSON.stringify(v, null, 1));
  let ok = true;

  // Atomic inline box: 30x40 box makes the block container's line 40pt tall
  // (well above a ~18pt text line), and the box sits inside the container,
  // offset to the right of "before".
  ok = check('inlineBox.w', v.inlineBox.w, 30) && ok;
  ok = check('inlineBox.h', v.inlineBox.h, 40) && ok;
  ok =
    check(
      'inline container is at least box-tall',
      v.inlineContainer.h >= 40 ? 1 : 0,
      1,
      0,
    ) && ok;
  ok =
    check(
      'box starts inside container, after text',
      v.inlineBox.x > v.inlineContainer.x + 10 ? 1 : 0,
      1,
      0,
    ) && ok;

  // Blockified in flex: the flex container stacks text + box + text, so it
  // must be strictly taller than the inline (one-line) container.
  ok =
    check(
      'flex contrast taller than inline flow',
      v.flexContrast.h > v.inlineContainer.h ? 1 : 0,
      1,
      0,
    ) && ok;

  // Sibling margin collapsing (native block): 10 + max(20,30) + 10 = 50.
  // The flex emulation (flag off) would give 70.
  ok = check('marginSiblings.h (collapsed)', v.marginSiblings.h, 50) && ok;

  // Nested escape: outer 30 (20 escaped margin + 10 bar), mid stays 10.
  ok = check('escapeOuter.h', v.escapeOuter.h, 30) && ok;
  ok = check('escapeMid.h', v.escapeMid.h, 10) && ok;
  ok =
    check(
      'mid pushed down by escaped margin',
      v.escapeMid.y - v.escapeOuter.y,
      20,
    ) && ok;

  // none/abs contiguity: same content with a display:'none' and an absolute
  // child must lay out exactly like the control (same height).
  ok =
    check('contiguity height parity', v.contigAbs.h, v.contigControl.h) && ok;

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
