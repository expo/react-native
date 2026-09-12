/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * CDP verification for the layout cases whose expected values were measured
 * in Chrome: float placement rule 5 and clearance (Display: block), an
 * unknown grid area name (Grid), and `env()` inside `calc()` (env screen).
 * Launches RNTester into each screen with the `route` launch argument, lets
 * the cases publish their rects to `globalThis.__displayVerify`, reads them
 * through Metro's inspector, and asserts the browser's numbers.
 *
 * Usage: node spec-fixes-cdp-verify.js [ios|android]
 *   Metro on :8081 and RNTester installed. With several simulators booted,
 *   set SIM_UDID to the one RNTester is on.
 *
 * @noflow
 * @format
 */

const {execSync} = require('node:child_process');
const WebSocket = require('ws');

const BUNDLE_ID = 'dev.expo.rntester';
const PLATFORM = process.argv[2] === 'android' ? 'android' : 'ios';
const SIM = process.env.SIM_UDID ?? 'booted';
const ANDROID_COMPONENT = 'com.facebook.react.uiapp/.RNTesterActivity';
const ADB = `${process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools'}/platform-tools/adb`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readVerifyObject() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const appId = PLATFORM === 'android' ? 'com.facebook.react.uiapp' : BUNDLE_ID;
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

// Launches the app into one screen and polls until the named rects publish
async function readScreen(route, names) {
  if (PLATFORM === 'android') {
    execSync(`${ADB} shell am force-stop com.facebook.react.uiapp`);
    await sleep(1000);
    execSync(
      `${ADB} shell am start -n ${ANDROID_COMPONENT} --es route ${route}`,
    );
  } else {
    execSync(`xcrun simctl terminate ${SIM} ${BUNDLE_ID} 2>/dev/null || true`);
    await sleep(1000);
    execSync(`xcrun simctl launch ${SIM} ${BUNDLE_ID} -route ${route}`);
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(3000);
    try {
      const v = await readVerifyObject();
      if (v != null && names.every(name => v[name] != null)) {
        return v;
      }
    } catch (e) {
      // The bundle is still loading or the inspector target is not up yet
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
  const block = await readScreen('DisplayBlock', [
    'floatContainer',
    'floatRight',
    'clearContainer',
    'clearParent',
    'clearChild',
  ]);
  const grid = await readScreen('Grid', ['unknownGrid', 'unknownItem']);
  const env = await readScreen('EnvSafeArea', [
    'envTop',
    'envTopPlus8',
    'envTopTimes2',
  ]);
  console.log('rects:', JSON.stringify({block, grid, env}, null, 1));
  let ok = true;

  // Chrome: the right float sits beside the first left float only as high as
  // the wrapped second one, 10pt down, and the container holds all three
  ok =
    check(
      'float rule 5: right float x',
      block.floatRight.x - block.floatContainer.x,
      70,
    ) && ok;
  ok =
    check(
      'float rule 5: right float y',
      block.floatRight.y - block.floatContainer.y,
      10,
    ) && ok;
  ok = check('float container height', block.floatContainer.h, 40) && ok;

  // Chrome: the parent keeps its own 10pt margin and the cleared child lands
  // at the float's bottom
  ok =
    check(
      'clearance: parent y',
      block.clearParent.y - block.clearContainer.y,
      10,
    ) && ok;
  ok =
    check(
      'clearance: child y',
      block.clearChild.y - block.clearContainer.y,
      30,
    ) && ok;
  ok = check('clearance: container height', block.clearContainer.h, 45) && ok;

  // Chrome, 300pt-wide grid: the item lands in a new track outside the grid
  ok =
    check(
      'unknown area: item x',
      grid.unknownItem.x - grid.unknownGrid.x,
      220,
    ) && ok;
  ok =
    check(
      'unknown area: item y',
      grid.unknownItem.y - grid.unknownGrid.y,
      60,
    ) && ok;
  ok = check('unknown area: grid height', grid.unknownGrid.h, 80) && ok;

  // `calc(env(...) + 8px)` is the inset plus 8; another expression falls back
  // to the bar's 2pt minimum. The plain bar cannot show an inset under that
  // minimum (Android's is 0 when the app is not edge to edge), so then only
  // bound the sum by it.
  const MINIMUM_BAR = 2;
  if (env.envTop.h > MINIMUM_BAR + 0.5) {
    ok =
      check(
        'calc(env() + 8px) is the inset plus 8',
        env.envTopPlus8.h - env.envTop.h,
        8,
      ) && ok;
  } else {
    ok =
      check(
        'calc(env() + 8px) is an inset under 2pt plus 8',
        env.envTopPlus8.h,
        8 + MINIMUM_BAR / 2,
        MINIMUM_BAR / 2,
      ) && ok;
  }
  ok =
    check('calc(env() * 2) computes to nothing', env.envTopTimes2.h, 2) && ok;

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
