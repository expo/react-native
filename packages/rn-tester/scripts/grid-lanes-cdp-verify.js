/**
 * CDP verification for the Grid Lanes example screen, on a real platform.
 *
 * The Fantom suite already pins these layouts against Safari's numbers. This
 * re-proves them through the actual platform layout pass, at whatever width
 * the device gives, so every assertion is a RELATION rather than a pixel
 * count.
 *
 * The two shapes it checks are the ones that separate a real implementation
 * from a plausible one:
 *
 *   - With `flowTolerance: 0`, an item must land in the SHORTEST lane. Items
 *     of 60/30/40 make lane 2 shortest when the fourth is placed, and its top
 *     must equal that lane's running position — not the first lane's, and not
 *     the tallest one's.
 *   - With `flowTolerance: 'infinite'`, height is ignored entirely and the
 *     same four items fill strictly in order, so the fourth wraps to lane 0.
 *
 * Usage:
 *   node grid-lanes-cdp-verify.js ios
 *   node grid-lanes-cdp-verify.js android
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
  console.error('usage: node grid-lanes-cdp-verify.js <ios|android>');
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
      if (v != null && v.laneA != null) {
        return v;
      }
    } catch (e) {
      // Bundle still loading — retry.
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

async function main() {
  const v = await readScreen('GridLanes');
  console.log('rects:', JSON.stringify(v, null, 1));

  const GAP = 10;

  // The three lanes are equal and evenly spaced.
  check('lane B starts one lane + gap after A', v.laneB.x - v.laneA.x, v.laneA.w + GAP);
  check('lane C starts one lane + gap after B', v.laneC.x - v.laneB.x, v.laneB.w + GAP);

  // The first three items head their own lanes, so they share a top edge.
  // Compared against each other rather than against zero: these are screen
  // coordinates, and the screen scrolls.
  check('items A and B share a top edge', v.laneB.y, v.laneA.y);
  check('items A and C share a top edge', v.laneC.y, v.laneA.y);

  // The fourth goes to the SHORTEST lane: B is 30 tall against C's 40 and A's
  // 60, so it lands under B, at B's height plus the gap.
  check('item D lands in the shortest lane (B)', v.laneD.x, v.laneB.x);
  check('item D sits directly under B', v.laneD.y, v.laneB.y + v.laneB.h + GAP);

  // Under `infinite`, height stops mattering: the same four items fill in
  // order, so the fourth wraps back to lane 0 rather than seeking the shortest.
  check('with infinite tolerance, item D returns to lane 0', v.laneStrictD.x, v.laneStrictA.x);
  check(
    'and sits under the first item',
    v.laneStrictD.y,
    v.laneStrictA.y + v.laneStrictA.h + GAP,
  );

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
