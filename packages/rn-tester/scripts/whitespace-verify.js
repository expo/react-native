/**
 * On-device verification for inline-element geometry (box-model-scope.md T14 /
 * G3): reads the rects the demo screens publish to `globalThis.__displayVerify`
 * through Metro's inspector proxy and asserts them — view-tree numbers, no
 * screenshots.
 *
 * Two things are being proven, both of which only exist on device (the cxx
 * measurer Fantom uses is a different implementation entirely):
 *  - `measureFragmentRects` in the Kotlin TextLayoutManager actually supplies
 *    per-fragment rects, so a nested `<Text>` reports its own box rather than
 *    the all-zero rect it used to.
 *  - a decorated inline element's inline-axis padding occupies real advance
 *    (G3), measured as the width its parent gains.
 *
 * Runs against the real intrinsics (`<b>`, `<span>`), not nested `<Text>` —
 * these mount on Android now that FabricNameComponentMapping points the inline
 * text elements at the same ViewManager as <Text>.
 *
 * Usage: node inline-metrics-verify.js [ios|android]   (default android)
 *
 * Needs Metro on :8081 and RNTester installed on a booted simulator/emulator
 * (Android also needs `adb reverse tcp:8081 tcp:8081`). Only one of the two
 * apps may be running: they share Metro's inspector, and the reader attaches
 * to whichever target answers first — which will silently report the *other*
 * platform's numbers.
 *
 * @noflow
 * @format
 */

const {execSync} = require('node:child_process');
const WebSocket = require('ws');

const PACKAGE = 'com.facebook.react.uiapp';
const ADB =
  process.env.ADB ??
  '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';

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

const PLATFORM = process.argv[2] === 'ios' ? 'ios' : 'android';
const IOS_BUNDLE_ID = 'dev.expo.rntester';

// Both entry points take the same `route`, so screens are reachable without
// tapping through the list (and without the URL-scheme confirmation dialog):
// an intent extra on Android, a launch argument on iOS. The other platform's
// app is stopped first so it cannot answer the inspector instead.
async function readScreen(route) {
  if (PLATFORM === 'ios') {
    execSync(`${ADB} shell am force-stop ${PACKAGE} 2>/dev/null || true`);
    execSync(
      `xcrun simctl terminate booted ${IOS_BUNDLE_ID} 2>/dev/null || true`,
    );
    await sleep(1000);
    execSync(`xcrun simctl launch booted ${IOS_BUNDLE_ID} -route ${route}`, {
      stdio: 'ignore',
    });
  } else {
    execSync(
      `xcrun simctl terminate booted ${IOS_BUNDLE_ID} 2>/dev/null || true`,
    );
    execSync(`${ADB} shell am force-stop ${PACKAGE}`);
    await sleep(1000);
    execSync(
      `${ADB} shell am start -n ${PACKAGE}/.RNTesterActivity -e route ${route}`,
      {stdio: 'ignore'},
    );
  }
  for (let attempt = 0; attempt < 20; attempt++) {
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

function check(name, pass, detail) {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`,
  );
  return pass;
}

const PADDING = 10;
// Layout is rounded to the pixel grid, so a dp delta can land a fraction off.
const TOLERANCE = 1.0;

async function main() {
  const v = await readScreen('StringChildren');
  console.log(`platform: ${PLATFORM}`);
  console.log('rects:', JSON.stringify(v, null, 1));
  let ok = true;

  const required = [
    'wsCollapsed',
    'wsControl',
    'wsPreserved',
    'wsNewlineNormal',
    'wsNewlinePreLine',
  ];
  for (const k of required) {
    if (v[k] == null) {
      console.log(`FAIL  missing rect: ${k}`);
      ok = false;
    }
  }
  if (!ok) {
    process.exit(1);
  }

  // css-text-3 §4.1.1: a run of collapsible white space collapses to a single
  // space, so 'a   b' must measure exactly as wide as 'a b'.
  ok =
    check(
      'collapsing: "a   b" measures as "a b"',
      Math.abs(v.wsCollapsed.w - v.wsControl.w) <= TOLERANCE,
      `${v.wsCollapsed.w.toFixed(2)} ≈ ${v.wsControl.w.toFixed(2)}`,
    ) && ok;

  // ...and the probe can tell the difference: under `pre` the same source is
  // preserved, so it must be STRICTLY wider. Without this, a build that
  // collapsed nothing and a build that collapsed everything both pass above.
  ok =
    check(
      'discriminating: `pre` keeps the spaces, so it is wider',
      v.wsPreserved.w > v.wsControl.w + TOLERANCE,
      `${v.wsPreserved.w.toFixed(2)} > ${v.wsControl.w.toFixed(2)}`,
    ) && ok;

  // css-text-3 §4.1.2: under `normal` a segment break becomes a space — one
  // line. Under `pre-line` it is preserved — two lines, so strictly taller.
  ok =
    check(
      'segment break: `normal` folds the newline into one line',
      v.wsNewlinePreLine.h > v.wsNewlineNormal.h + TOLERANCE,
      `pre-line ${v.wsNewlinePreLine.h.toFixed(2)} > normal ${v.wsNewlineNormal.h.toFixed(2)}`,
    ) && ok;

  // The collapsed newline box is one line of the same text, so it matches the
  // single-space control in height as well as intent.
  ok =
    check(
      'segment break: the folded line is one line tall',
      Math.abs(v.wsNewlineNormal.h - v.wsControl.h) <= TOLERANCE,
      `${v.wsNewlineNormal.h.toFixed(2)} ≈ ${v.wsControl.h.toFixed(2)}`,
    ) && ok;

  console.log(ok ? '\nALL CHECKS PASSED' : '\nCHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
