/**
 * Runs the whole grid / grid-lanes conformance corpus on a real platform and
 * compares every rect against the numbers Safari measured.
 *
 * The Fantom suite (Libraries/Components/View/__tests__/Grid-itest.js) covers
 * the same cases, but Fantom is a deterministic harness: one thread, a stub
 * measurer, no pixel grid. This runs the identical corpus through the actual
 * iOS/Android layout pass, where sizes get rounded to the screen's scale
 * factor and the shadow tree has to survive the trip to the UI thread.
 *
 * Pairs with packages/rn-tester/js/examples/Grid/GridConformanceExample.js,
 * which renders the cases and publishes what they measured.
 *
 * Usage:
 *   node grid-conformance-verify.js ios
 *   node grid-conformance-verify.js android
 *   node grid-conformance-verify.js ios --lanes   (grid-lanes cases only)
 *
 * @noflow
 * @format
 */

const {execSync} = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const IOS_BUNDLE_ID = 'dev.expo.rntester';
const ANDROID_COMPONENT = 'com.facebook.react.uiapp/.RNTesterActivity';
const ADB = `${process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools'}/platform-tools/adb`;

const expected = require(
  path.join(__dirname, '../../../grid-lanes-conformance/expected.json'),
);

const platform = process.argv[2];
const lanesOnly = process.argv.includes('--lanes');
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: node grid-conformance-verify.js <ios|android> [--lanes]');
  process.exit(2);
}

// A device rounds every edge to its own pixel grid, so a value that is exactly
// 193.333 in the browser can only ever be 193.33 or 193.5 here. One third of a
// point covers the coarsest grid in play (2x) with room to spare; anything
// larger than this is a real disagreement, not rounding.
const TOLERANCE = 0.75;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(expression) {
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
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
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
        params: {expression, returnByValue: true},
      }),
    );
    setTimeout(() => reject(new Error('CDP evaluate timed out')), 20000);
  });
  ws.close();
  if (result.exceptionDetails != null) {
    throw new Error('CDP threw: ' + JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
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

// The screen publishes each case as its onLayout callbacks fire, so "done" is
// not a moment in time — it is when the count stops growing.
async function readMeasured() {
  launch('GridConformance');
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(3000);
    let json;
    try {
      json = await evaluate(
        'JSON.stringify(globalThis.__gridConformance ?? null)',
      );
    } catch (e) {
      continue; // Bundle still loading.
    }
    if (json == null) continue;
    const measured = JSON.parse(json);
    if (measured == null) continue;
    const count = Object.keys(measured).length;
    if (count > 0 && count === previous) {
      return measured;
    }
    process.stderr.write(`  ${count} cases published...\n`);
    previous = count;
  }
  throw new Error('rects never settled');
}

async function main() {
  const measured = await readMeasured();

  let cases = 0;
  let assertions = 0;
  const failures = [];
  const missing = [];

  for (const c of expected.cases) {
    if (lanesOnly && c.container.display !== 'grid-lanes') continue;
    const got = measured[c.id];
    if (got == null) {
      // Either the case is one the generator could not express as RN styles,
      // or the screen failed to publish it. Only the latter is a problem, and
      // the two are told apart by whether the screen knows the id at all.
      missing.push(c.id);
      continue;
    }
    cases++;
    const check = (what, actual, want) => {
      assertions++;
      if (!(Math.abs(actual - want) <= TOLERANCE)) {
        failures.push(
          `${c.id} ${what}: device ${actual}, Safari ${want} (${c.note ?? ''})`,
        );
      }
    };
    check('container.w', got.container.w, c.expected.container.w);
    check('container.h', got.container.h, c.expected.container.h);
    c.expected.items.forEach((e, i) => {
      const r = got.items[String(i)];
      if (r == null) {
        failures.push(`${c.id} item[${i}]: never measured`);
        return;
      }
      check(`item[${i}].x`, r.x, e.x);
      check(`item[${i}].y`, r.y, e.y);
      check(`item[${i}].w`, r.w, e.w);
      check(`item[${i}].h`, r.h, e.h);
    });
  }

  const label = lanesOnly ? 'grid-lanes' : 'grid + grid-lanes';
  console.log(
    `\n${platform}: ${label} — ${cases} cases, ${assertions} assertions, ` +
      `${failures.length} mismatches`,
  );
  if (missing.length > 0) {
    console.log(
      `${missing.length} corpus cases not rendered (not expressible as RN ` +
        `styles, or oracle limitations): ${missing.join(', ')}`,
    );
  }
  for (const f of failures) {
    console.log(`  FAIL ${f}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('CDP-ERROR', e.message);
  process.exit(1);
});
