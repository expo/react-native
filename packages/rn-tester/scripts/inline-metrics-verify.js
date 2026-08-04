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
    execSync(`xcrun simctl terminate booted ${IOS_BUNDLE_ID} 2>/dev/null || true`);
    await sleep(1000);
    execSync(`xcrun simctl launch booted ${IOS_BUNDLE_ID} -route ${route}`, {
      stdio: 'ignore',
    });
  } else {
    execSync(`xcrun simctl terminate booted ${IOS_BUNDLE_ID} 2>/dev/null || true`);
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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`);
  return pass;
}

const PADDING = 10;
// Layout is rounded to the pixel grid, so a dp delta can land a fraction off.
const TOLERANCE = 1.0;

async function main() {
  const v = await readScreen('IntrinsicElements');
  console.log(`platform: ${PLATFORM}`);
  console.log('rects:', JSON.stringify(v, null, 1));
  let ok = true;

  const required = [
    'intrinsicPlainRun',
    'intrinsicAxisRun',
    'intrinsicAllRun',
    'intrinsicEdgesRun',
    'intrinsicPlainSpan',
    'intrinsicAxisSpan',
    'intrinsicBold',
    'intrinsicFlexSpan',
  ];
  for (const key of required) {
    if (v[key] == null) {
      console.log(`FAIL  ${key} was never published`);
      process.exit(1);
    }
  }

  // T14: an empty rect is exactly the pre-fragment-rects behaviour, so this is
  // the assertion that fails if the platform stops supplying per-fragment
  // geometry.
  const bold = v.intrinsicBold;
  ok =
    check(
      'intrinsic <b> reports a non-empty box',
      bold.w > 0 && bold.h > 0,
      `${bold.w}x${bold.h}`,
    ) && ok;
  ok =
    check(
      'intrinsic <b> is offset past the preceding text',
      bold.x > v.intrinsicPlainRun.x,
      `${bold.x} > ${v.intrinsicPlainRun.x}`,
    ) && ok;

  // G3: each padded run differs from the plain one only by the <span>'s
  // horizontal padding, and all blocks shrink to content, so the width delta
  // is exactly the reserved inline-axis advance. All three shorthand forms are
  // checked because they are separate lookups — `paddingHorizontal` was once
  // silently inert while the per-edge form worked.
  const base = v.intrinsicPlainRun.w;
  for (const [key, form] of [
    ['intrinsicAxisRun', 'paddingHorizontal'],
    ['intrinsicAllRun', 'padding'],
    ['intrinsicEdgesRun', 'paddingLeft/Right'],
  ]) {
    const delta = v[key].w - base;
    ok =
      check(
        `${form} widens the run by 2x padding`,
        Math.abs(delta - 2 * PADDING) <= TOLERANCE,
        `${delta.toFixed(2)} ≈ ${2 * PADDING}`,
      ) && ok;
  }

  // The element's own box is its *border* box, so it includes both edges. The
  // leading edge is the one at risk: it rides on the preceding character, so
  // it falls outside the element's glyph range and has to be added back.
  // A <span> whose display establishes a formatting context is backed by a
  // real box, so it lays its own children out — 30 + 20 in a row. A
  // text-backed span is not a Yoga node and could not do this at all.
  const flexSpan = v.intrinsicFlexSpan;
  ok =
    check(
      'a <span> with display:inline-flex lays out its children',
      flexSpan != null && Math.abs(flexSpan.w - 50) <= TOLERANCE,
      flexSpan != null ? `${flexSpan.w.toFixed(2)} ≈ 50` : 'not published',
    ) && ok;

  const spanDelta = v.intrinsicAxisSpan.w - v.intrinsicPlainSpan.w;
  ok =
    check(
      "the <span>'s own box includes both its edges",
      Math.abs(spanDelta - 2 * PADDING) <= TOLERANCE,
      `${spanDelta.toFixed(2)} ≈ ${2 * PADDING}`,
    ) && ok;

  console.log(ok ? '\nALL PASS' : '\nFAILURES');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
