/**
 * CDP verification for the Grid example screen: CSS Grid track geometry,
 * asserted from measured view rects on a REAL platform (iOS simulator or
 * Android emulator).
 *
 * The Fantom suite (Libraries/Components/View/__tests__/Grid-itest.js) already
 * proves these layouts against Safari's numbers. This re-proves them through
 * the actual platform layout pass, on the device, where the container width is
 * whatever the screen gives it.
 *
 * Every assertion is therefore a RELATION rather than an absolute pixel count,
 * so it holds at any width:
 *
 *   - three `1fr` tracks are equal, and evenly spaced by the gap
 *   - an item spanning two tracks is as wide as those two plus the gap
 *   - `repeat(auto-fill, minmax(90px, 1fr))` yields tracks at least 90pt wide
 *
 * Usage:
 *   node grid-cdp-verify.js ios       (Metro on :8081, simulator booted)
 *   node grid-cdp-verify.js android   (emulator running, adb reverse set up)
 *
 * @noflow
 * @format
 */

const {execSync} = require('node:child_process');
const WebSocket = require('ws');

const IOS_BUNDLE_ID = 'dev.expo.rntester';
const ANDROID_COMPONENT = 'com.facebook.react.uiapp/.RNTesterActivity';
const ADB = `${process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools'}/platform-tools/adb`;

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: node grid-cdp-verify.js <ios|android>');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readVerifyObject() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const appId =
    platform === 'android' ? 'com.facebook.react.uiapp' : 'dev.expo.rntester';
  const target = targets.find(
    t => t.webSocketDebuggerUrl != null && (t.title ?? '').includes(appId),
  );
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

function launch(route) {
  if (platform === 'ios') {
    execSync(
      `xcrun simctl terminate booted ${IOS_BUNDLE_ID} 2>/dev/null || true`,
    );
    execSync(`xcrun simctl launch booted ${IOS_BUNDLE_ID} -route ${route}`);
  } else {
    execSync(`${ADB} shell am force-stop com.facebook.react.uiapp`);
    execSync(
      `${ADB} shell am start -n ${ANDROID_COMPONENT} --es route ${route}`,
    );
  }
}

async function readScreen(route) {
  launch(route);
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(3000);
    try {
      const v = await readVerifyObject();
      if (v != null && v.gridFrA != null) {
        return v;
      }
    } catch (e) {
      // Bundle still loading / inspector target not up yet — retry.
    }
  }
  throw new Error(`rects never published for route ${route}`);
}

let ok = true;
function check(name, actual, expected, tolerance = 0.75) {
  const pass = Math.abs(actual - expected) <= tolerance;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}: ${actual.toFixed(2)} ${
      pass ? '≈' : '≠'
    } ${expected.toFixed(2)}`,
  );
  ok = pass && ok;
}
function checkAtLeast(name, actual, minimum) {
  const pass = actual >= minimum - 0.75;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}: ${actual.toFixed(2)} ${
      pass ? '>=' : '<'
    } ${minimum}`,
  );
  ok = pass && ok;
}

async function main() {
  const v = await readScreen('Grid');
  console.log('rects:', JSON.stringify(v, null, 1));

  const GAP = 10;

  // Three 1fr tracks: equal widths, and each starts one track + one gap after
  // the last. Equality alone would pass if every track were zero, so the
  // spacing is checked too.
  check('1fr tracks A and B are equal', v.gridFrA.w, v.gridFrB.w);
  check('1fr tracks B and C are equal', v.gridFrB.w, v.gridFrC.w);
  check(
    'track B starts one track + gap after A',
    v.gridFrB.x - v.gridFrA.x,
    v.gridFrA.w + GAP,
  );
  check(
    'track C starts one track + gap after B',
    v.gridFrC.x - v.gridFrB.x,
    v.gridFrB.w + GAP,
  );
  // Signal check: the tracks are real, not collapsed.
  checkAtLeast('1fr tracks have non-trivial width', v.gridFrA.w, 20);

  // A `span 2` item covers two tracks and the gap between them.
  check(
    'span-2 item is two tracks + one gap wide',
    v.gridSpanItem.w,
    v.gridSpanFirst.w * 2 + GAP,
  );
  check(
    'span-2 item starts one track + gap in',
    v.gridSpanItem.x - v.gridSpanFirst.x,
    v.gridSpanFirst.w + GAP,
  );

  // auto-fill with a 90pt floor: whatever count the width produced, no track
  // may be narrower than the floor, and the row must fit the container.
  checkAtLeast('auto-fill track respects its 90pt minmax floor', v.gridAutoFillFirst.w, 90);
  const fits =
    v.gridAutoFillFirst.w <= v.gridAutoFillContainer.w + 0.75 ? 1 : 0;
  check('auto-fill track fits its container', fits, 1, 0);

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
