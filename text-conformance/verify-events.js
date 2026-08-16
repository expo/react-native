/**
 * Taps things and checks what the tap hit.
 *
 * `getBoundingClientRect()` says where an element is; this says whether the
 * engine agrees when a finger arrives there. Painting and hit-testing are
 * separate code paths on both platforms, so they can and do disagree — the
 * corpus checks both.
 *
 * Every probe records itself on click without stopping propagation, so one tap
 * answers two questions: the first id recorded is the target the engine
 * resolved, and the ids after it are the ancestors it bubbled through (DOM
 * §2.9 — target first, then outward).
 *
 * Screen coordinates are calibrated by clicking rather than computed: the app
 * reports the point it received with every click, so a few clicks and a
 * straight-line fit give the transform for whatever device is attached, with
 * nothing hard-coded and no screenshot to scan.
 *
 * Usage:
 *   node verify-events.js ios
 *   node verify-events.js android
 *
 * Needs Metro on :8081 and RNTester open on the "Text event targets" screen.
 *
 * @noflow
 * @format
 */

'use strict';

const {execSync} = require('node:child_process');
const WebSocket = require('ws');

const ADB =
  process.env.ADB ??
  '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const IOS_UDID = process.env.IOS_UDID ?? 'A8563057-9C3D-4D21-B5EE-4C1094A50652';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * What each tap must produce: the probe to tap, the element the tap must
 * resolve to, and the ancestor it must then bubble to.
 */
const CHECKS = [
  {
    probe: 'bareText',
    why: 'Bare text is not an element, so the tap targets the View that paints it.',
    target: 'row-bare',
    bubblesTo: [],
  },
  {
    probe: 'beforeSpan',
    why: 'Text in an element with no handler still resolves to the containing View.',
    target: 'row-span',
    bubblesTo: [],
  },
  {
    probe: 'spanProbe',
    why: 'An inline element with a handler is the target, and the event bubbles past it.',
    target: 'span',
    bubblesTo: ['row-span'],
  },
  {
    probe: 'innerProbe',
    why: 'The innermost element wins, and both ancestors see the event.',
    target: 'inner',
    bubblesTo: ['outer', 'row-nested'],
  },
  {
    probe: 'atomicBox',
    why: 'An atomic inline is a box of its own and takes the tap.',
    target: 'atomic',
    bubblesTo: ['row-atomic'],
  },
  {
    probe: 'afterAtomic',
    why: 'Text AFTER an atomic inline resolves to the View, not to the box beside it — the case where paint and hit-test geometry drifting apart would show.',
    target: 'row-atomic',
    bubblesTo: [],
  },
  {
    probe: 'blockChild',
    why: 'A block child between two runs is an ordinary view and takes its own taps.',
    target: 'block',
    bubblesTo: ['row-block'],
  },
];

// ---------------------------------------------------------------------------
// Talking to the app
// ---------------------------------------------------------------------------

async function withInspector(fn) {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const target = targets.find(t => t.webSocketDebuggerUrl != null);
  if (!target) {
    throw new Error('no debug target on Metro');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    headers: {Origin: 'http://localhost:8081'},
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  let nextId = 1;
  const evaluate = expression =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error('inspector timed out')), 15000);
      const onMessage = data => {
        const msg = JSON.parse(data);
        if (msg.id !== id) {
          return;
        }
        clearTimeout(timer);
        ws.off('message', onMessage);
        const value = msg.result?.result?.value;
        resolve(value == null ? null : JSON.parse(value));
      };
      ws.on('message', onMessage);
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {expression, returnByValue: true},
        }),
      );
    });
  try {
    return await fn(evaluate);
  } finally {
    ws.close();
  }
}

// ---------------------------------------------------------------------------
// Pointer calibration
// ---------------------------------------------------------------------------

/**
 * Where a click at a given SCREEN position lands in the app's own coordinates.
 *
 * Derived by clicking, not by arithmetic on window geometry. The arithmetic
 * version was wrong by about 20pt across and 50pt down — enough to land a tap
 * on the row above the one aimed at, which reads exactly like a hit-testing
 * bug. The app reports the point it received with every click, so three
 * clicks and a straight-line fit per axis give the transform for whatever
 * device is attached, with nothing hard-coded.
 */
async function calibratePointer(platform, click, evaluate, probePoints) {
  const samples = [];
  for (const point of probePoints) {
    await evaluate('JSON.stringify((globalThis.__textTargets = []) && null)');
    click(point);
    await sleep(600);
    const fired = (await evaluate('JSON.stringify(globalThis.__textTargets ?? [])')) ?? [];
    // Calibrate on the event's SCREEN coordinates, not its client ones: the
    // rects this verifier aims with are screen-relative, and on Android the
    // client space is offset from that by wherever the React root view sits.
    const reported = fired.find(f => f.screenX != null) ?? fired.find(f => f.x != null);
    if (reported != null) {
      samples.push({
        screen: point,
        app: {
          x: reported.screenX ?? reported.x,
          y: reported.screenY ?? reported.y,
        },
      });
    }
  }
  if (samples.length < 2) {
    throw new Error(
      `pointer calibration got ${samples.length} of ${probePoints.length} clicks back — ` +
        'is RNTester on the "Text event targets" screen and frontmost?',
    );
  }
  const fit = axis => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dScreen = last.screen[axis] - first.screen[axis];
    const dApp = last.app[axis] - first.app[axis];
    if (Math.abs(dApp) < 1) {
      throw new Error(`calibration clicks did not separate along ${axis}`);
    }
    const screenPerApp = dScreen / dApp;
    return {
      screenPerApp,
      origin: first.screen[axis] - first.app[axis] * screenPerApp,
    };
  };
  const x = fit('x');
  const y = fit('y');
  const toScreen = appPoint => ({
    x: Math.round(x.origin + appPoint.x * x.screenPerApp),
    y: Math.round(y.origin + appPoint.y * y.screenPerApp),
  });
  // Prove it before trusting it: the last sample must map back to where it was
  // clicked. A fit from two noisy points can be arbitrarily wrong, and a wrong
  // one produces a page of "hit the wrong element" failures.
  const check = toScreen(samples[samples.length - 1].app);
  const drift = Math.hypot(
    check.x - samples[samples.length - 1].screen.x,
    check.y - samples[samples.length - 1].screen.y,
  );
  if (drift > 2) {
    throw new Error(`pointer calibration does not round-trip (off by ${drift.toFixed(1)})`);
  }
  return {toScreen, x, y};
}

function clickerFor(platform) {
  if (platform === 'android') {
    return point => {
      execSync(`${ADB} shell input tap ${Math.round(point.x)} ${Math.round(point.y)}`);
    };
  }
  return point => {
    execSync(`cliclick c:${Math.round(point.x)},${Math.round(point.y)}`);
  };
}

/**
 * Screen positions to calibrate from: spread out, and inside the app's own
 * area on either platform. Points, not device pixels, on iOS (cliclick drives
 * the Simulator window); device pixels on Android (adb does not).
 */
function calibrationPoints(platform) {
  if (platform === 'android') {
    return [
      {x: 200, y: 500},
      {x: 700, y: 900},
      {x: 400, y: 1300},
    ];
  }
  const info = execSync(
    `osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'`,
  )
    .toString()
    .trim()
    .split(', ')
    .map(Number);
  const [winX, winY, winW, winH] = info;
  return [
    {x: winX + winW * 0.3, y: winY + winH * 0.25},
    {x: winX + winW * 0.6, y: winY + winH * 0.4},
    {x: winX + winW * 0.45, y: winY + winH * 0.55},
  ];
}

// ---------------------------------------------------------------------------

async function main(platform) {
  if (platform === 'ios') {
    execSync(`osascript -e 'tell application "Simulator" to activate'`);
    await sleep(900);
  }

  const click = clickerFor(platform);
  const results = [];
  await withInspector(async evaluate => {
    let rects = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      rects = await evaluate('JSON.stringify(globalThis.__textTargetRects ?? null)');
      if (rects != null && rects.bareText != null) {
        break;
      }
      await sleep(1000);
    }
    if (rects == null) {
      throw new Error('the screen published no rects');
    }

    const pointer = await calibratePointer(
      platform,
      click,
      evaluate,
      calibrationPoints(platform),
    );
    console.log(
      `calibrated: ${pointer.x.screenPerApp.toFixed(3)} across, ` +
        `${pointer.y.screenPerApp.toFixed(3)} down, ` +
        `origin ${pointer.x.origin.toFixed(1)},${pointer.y.origin.toFixed(1)}`,
    );

    for (const check of CHECKS) {
      const rect = rects[check.probe];
      if (rect == null) {
        results.push({...check, fired: [], problems: [`no rect published for "${check.probe}"`]});
        continue;
      }
      await evaluate('JSON.stringify((globalThis.__textTargets = []) && null)');
      click(pointer.toScreen({x: rect.x + rect.w / 2, y: rect.y + rect.h / 2}));
      await sleep(700);
      const raw = (await evaluate('JSON.stringify(globalThis.__textTargets ?? [])')) ?? [];
      // The root records every click so the pointer can be calibrated; it is
      // not one of the targets under test.
      const fired = raw.map(f => f.id).filter(id => id !== 'screen');

      const problems = [];
      if (fired.length === 0) {
        problems.push('nothing fired');
      } else {
        if (fired[0] !== check.target) {
          problems.push(`target was "${fired[0]}", expected "${check.target}"`);
        }
        for (const ancestor of check.bubblesTo) {
          if (!fired.includes(ancestor)) {
            problems.push(`did not bubble to "${ancestor}" (fired: ${fired.join(' -> ')})`);
          }
        }
      }
      results.push({...check, fired, problems});
    }
  });

  let failed = 0;
  for (const r of results) {
    if (r.problems.length === 0) {
      console.log(`  ok   ${r.probe} -> ${r.fired.join(' -> ')}`);
    } else {
      failed++;
      console.log(`  FAIL ${r.probe}`);
      console.log(`       ${r.why}`);
      for (const p of r.problems) {
        console.log(`       - ${p}`);
      }
    }
  }
  console.log(`\n${platform}: ${results.length - failed}/${results.length} taps landed correctly`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main(process.argv[2] ?? 'ios').catch(e => {
  console.error('VERIFY-EVENTS-ERROR', e.message);
  process.exit(1);
});
