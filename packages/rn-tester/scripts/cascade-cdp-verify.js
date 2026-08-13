/**
 * CDP verification for the Cascade example screen: text inheritance and the
 * `all` boundary keywords, asserted from measured view rects on a REAL
 * platform (iOS simulator or Android emulator) — the same relations the
 * CascadeBoundary Fantom suite pins, re-proven against the actual platform
 * text stacks.
 *
 * Every compared pair renders the identical string, so a height equality can
 * only come from the font size — line wrapping cannot fake a result.
 *
 * Usage:
 *   node cascade-cdp-verify.js ios       (Metro on :8081, simulator booted,
 *                                         RNTester installed)
 *   node cascade-cdp-verify.js android   (emulator running, app installed,
 *                                         adb reverse tcp:8081 tcp:8081)
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
  console.error('usage: node cascade-cdp-verify.js <ios|android>');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readVerifyObject() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  // Both a simulator and an emulator may be attached to the same Metro; pick
  // the target belonging to the platform under test by app id in the title.
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
      if (v != null && v.cascTextControl != null) {
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
  const v = await readScreen('Cascade');
  console.log('rects:', JSON.stringify(v, null, 1));
  let ok = true;

  // Sanity: the observable is alive — 30pt text is taller than default text
  // on this platform's real text stack.
  ok =
    check(
      'signal: 30pt text taller than default',
      v.cascText30Control.h > v.cascTextControl.h + 4 ? 1 : 0,
      1,
      0,
    ) && ok;
  ok =
    check(
      'signal: 30pt bare run taller than default',
      v.cascBare30Control.h > v.cascBareControl.h + 4 ? 1 : 0,
      1,
      0,
    ) && ok;

  // Root <Text>'s UA boundary (css-cascade-4 §3.2 expressed as the
  // UACascadeBoundary trait).
  ok =
    check(
      'default <Text> holds boundary',
      v.cascDefaultText.h,
      v.cascTextControl.h,
    ) && ok;
  // `unset` and `inherit` are author declarations that defeat the UA
  // boundary (§7.3: erase the cascaded value; inherited props inherit).
  ok =
    check(
      "<Text all:'unset'> inherits",
      v.cascUnsetText.h,
      v.cascText30Control.h,
    ) && ok;
  ok =
    check(
      "<Text all:'inherit'> inherits",
      v.cascInheritText.h,
      v.cascText30Control.h,
    ) && ok;
  // `revert` rolls back TO the UA origin: boundary on root Text…
  ok =
    check(
      "<Text all:'revert'> keeps boundary",
      v.cascRevertText.h,
      v.cascTextControl.h,
    ) && ok;
  // …and to nothing on a View — unset — so the bare run inherits.
  ok =
    check(
      "<View all:'revert'> bare run inherits",
      v.cascRevertView.h,
      v.cascBare30Control.h,
    ) && ok;
  // `initial` isolates anywhere.
  ok =
    check(
      "<View all:'initial'> bare run isolated",
      v.cascInitialView.h,
      v.cascBareControl.h,
    ) && ok;

  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
