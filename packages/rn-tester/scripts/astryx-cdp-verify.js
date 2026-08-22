/**
 * CDP verification for the Astryx example screen: launches RNTester into the
 * Astryx screen (`-route Astryx`), reads the Card rects published to
 * `globalThis.__displayVerify`, and asserts the geometry matches Astryx's
 * web behavior — total content inset (border + calc-reduced padding) equals
 * the padding token, and sized cards honor width.
 *
 * Usage: node astryx-cdp-verify.js   (Metro on :8081, simulator booted,
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
    throw new Error('no debug target');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    headers: {Origin: 'http://localhost:8081'},
  });
  await new Promise(r => ws.on('open', r));
  const result = await new Promise((resolve, reject) => {
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.id === 2) {
        resolve(msg.result);
      }
    });
    ws.send(JSON.stringify({id: 1, method: 'Runtime.enable', params: {}}));
    ws.send(
      JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: {
          expression: 'JSON.stringify(globalThis.__displayVerify ?? null)',
          returnByValue: true,
        },
      }),
    );
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  ws.close();
  return JSON.parse(result.result.value);
}

function check(ok, name, actual, expected, tolerance = 0.67) {
  const pass = Math.abs(actual - expected) <= tolerance;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${actual} vs ${expected}`);
  return ok && pass;
}

/*
 * For a MINIMUM, which is a floor and not a value.
 *
 * Asserting equality against a min-height only works while the element's
 * intrinsic content is shorter than the floor, and that is an accident of the
 * platform rather than the contract. The `<input>` field is 36 on iOS and 44 on
 * Android, whose text field is intrinsically taller — both satisfy
 * `--size-element-lg`. Equality reported the Android number as a failure the
 * first time this ran there, which is the check being wrong, not the layout.
 *
 * `>=` still catches the regression that matters: a dropped minimum shows up as
 * a field shorter than the floor on either platform.
 */
function checkAtLeast(ok, name, actual, floor) {
  const pass = actual >= floor - 0.67;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${actual} >= ${floor}`);
  return ok && pass;
}

async function main() {
  const ANDROID = process.env.ASTRYX_VERIFY_PLATFORM === 'android';
  if (ANDROID) {
    // The iOS RNTester here is a Release build and registers no CDP target, so
    // the same assertions run against the emulator, which does.
    const adb =
      '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
    execSync(`${adb} shell am force-stop com.facebook.react.uiapp`);
    await sleep(1000);
    execSync(
      `${adb} shell am start -n com.facebook.react.uiapp/.RNTesterActivity`,
      {stdio: 'ignore'},
    );
    await sleep(14000);
    execSync(
      `${adb} shell am start -a android.intent.action.VIEW -d "rntester://example/AstryxExample"`,
      {stdio: 'ignore'},
    );
  } else {
    execSync(`xcrun simctl terminate booted ${BUNDLE_ID} 2>/dev/null || true`);
    await sleep(1000);
    execSync(`xcrun simctl launch booted ${BUNDLE_ID} -route Astryx`);
  }
  let v = null;
  for (let attempt = 0; attempt < 15 && v == null; attempt++) {
    await sleep(3000);
    try {
      v = await readVerifyObject();
    } catch (e) {
      // Bundle still loading — retry.
    }
  }
  if (v == null) {
    throw new Error('rects never published');
  }
  let ok = true;
  // Astryx subtracts the border from the padding via calc() so that
  // border + padding equals the padding token exactly.
  ok = check(
    ok,
    'default card inset x (1 + 15)',
    v.cardDefaultP.x - v.cardDefault.x,
    16,
  );
  ok = check(
    ok,
    'default card inset y (1 + 15)',
    v.cardDefaultP.y - v.cardDefault.y,
    16,
  );
  ok = check(ok, 'blue card width', v.cardBlue.w, 300);
  ok = check(ok, 'pad2 card inset x (1 + 7)', v.cardPad2P.x - v.cardPad2.x, 8);
  // The <button> intrinsic: padding comes from Astryx tokens through the RN
  // StyleX runtime (--spacing-4 inline, --spacing-2 block) plus its 2px
  // border, so the label box sits 18pt in and 10pt down.
  ok = check(
    ok,
    'button label inset x (16 + 2 border)',
    v.buttonLabel.x - v.button.x,
    18,
  );
  /*
   * Vertically the authored metrics are a FLOOR, not the value: the element
   * button keeps Material's 48dp touch-target minimum even under an author
   * surface (DOM-CSS-DEVIATION — the platform's accessibility floor outranks
   * the stylesheet's arithmetic), and the label centres in the slack that
   * minimum adds. So three properties hold instead of one exact number: the
   * button is at least 48 tall, the label sits at least padding+border from
   * the top, and the slack is symmetric. The old exact-10 expectation
   * predated the OS-API button work and failed by exactly the centring
   * (measured 14.48 = 10 + (48 - content) / 2).
   */
  const labelTopInset = v.buttonLabel.y - v.button.y;
  const labelBottomInset =
    v.button.y + v.button.h - (v.buttonLabel.y + v.buttonLabel.h);
  ok = checkAtLeast(ok, 'button meets the 48dp touch minimum', v.button.h, 48);
  ok = checkAtLeast(ok, 'button label inset y floor (8 + 2 border)', labelTopInset, 10);
  ok = check(
    ok,
    'button label is vertically centred (top slack == bottom slack)',
    labelTopInset - labelBottomInset,
    0,
  );

  // M3 — custom-property inheritance across elements. The ancestor declares
  // --demo-gutter: 20px and pads itself with it; the descendant reads that
  // INHERITED value to escape the padding with negative margins, so its band
  // starts 20pt left of the ancestor's content and runs 40pt wider. A nested
  // element shadows the property to 0px, so the deepest reader gets 0
  // padding — neither the inherited 20px nor its own 99px fallback.
  ok = check(
    ok,
    'descendant escapes inherited gutter (starts at ancestor border box)',
    v.inheritEscape.x - v.inheritOuter.x,
    0,
  );
  ok = check(
    ok,
    'escaped band is full-bleed (40pt wider than content box)',
    v.inheritEscape.w - v.inheritOuter.w,
    0,
  );
  ok = check(
    ok,
    'shadowed subtree reads 0px, not the inherited 20 or fallback 99',
    v.inheritShadowed.x - v.inheritOuter.x,
    20,
  );

  // <input> mapped onto TextInput: the field's box comes from Astryx tokens
  // (--size-element-lg minimum height), proving the StyleX runtime styles a
  // behavior-mapped element the same as a container.
  ok = checkAtLeast(
    ok,
    'input field height (--size-element-lg minimum of 36)',
    v.inputField.h,
    36,
  );

  // T14 platform half: an inline <b> must report a real box from the iOS
  // text engine's per-fragment rects — it sits inside its run, starts after
  // the preceding text, and is narrower than the whole run. Empty rects
  // (the pre-T14 behaviour) fail every one of these.
  ok = check(
    ok,
    'inline element has a non-zero width',
    v.inlineBold.w > 0 ? 1 : 0,
    1,
    0,
  );
  ok = check(
    ok,
    'inline element has a non-zero height',
    v.inlineBold.h > 0 ? 1 : 0,
    1,
    0,
  );
  ok = check(
    ok,
    'inline element starts after the preceding text',
    v.inlineBold.x > v.inlineRun.x ? 1 : 0,
    1,
    0,
  );
  ok = check(
    ok,
    'inline element is narrower than its run',
    v.inlineBold.w < v.inlineRun.w ? 1 : 0,
    1,
    0,
  );

  console.log(ok ? '\nALL ASTRYX CHECKS PASSED' : '\nCHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
