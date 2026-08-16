/**
 * Reads the rects the RNTester screen published, and compares them with what
 * Safari did.
 *
 * Three verdicts per case, in the order they matter:
 *
 *   1. **assertions** — does this engine satisfy what the spec pins outright?
 *      Safari has already satisfied all of them (the oracle refuses to write
 *      `expected.json` otherwise), so a failure here is this engine's.
 *   2. **differences** — does the delta against the case's baseline match?
 *   3. **structure** — does the pairwise-relation signature match Safari's?
 *
 * Absolute coordinates are never compared across engines. See the note at the
 * top of `invariants.js` for why that would be noise rather than a test.
 *
 * Usage:
 *   node verify.js ios
 *   node verify.js android
 *
 * Needs Metro on :8081 and RNTester open on the "Text conformance" screen
 * (Android also needs `adb reverse tcp:8081 tcp:8081`). Only one of the two
 * apps may be running: they share Metro's inspector and the reader attaches to
 * whichever answers first, which would silently report the other platform.
 *
 * @noflow
 * @format
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const {cases, W} = require('./cases.js');
const {
  signature,
  checkAsserts,
  checkDiffs,
  contentWidthOf,
} = require('./invariants.js');

const EXPECTED = path.join(__dirname, 'expected.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readPublished() {
  const targets = await (await fetch('http://localhost:8081/json')).json();
  const target = targets.find(t => t.webSocketDebuggerUrl != null);
  if (!target) {
    throw new Error(
      `no debug target on Metro: ${JSON.stringify(targets.map(t => t.title))}`,
    );
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    headers: {Origin: 'http://localhost:8081'},
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  try {
    const value = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('inspector timed out')), 20000);
      ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id === 1) {
          clearTimeout(timer);
          if (msg.result?.result?.value == null) {
            reject(new Error(`no value back: ${JSON.stringify(msg).slice(0, 300)}`));
            return;
          }
          resolve(JSON.parse(msg.result.result.value));
        }
      });
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: 'JSON.stringify(globalThis.__textConformance ?? null)',
            returnByValue: true,
          },
        }),
      );
    });
    return value;
  } finally {
    ws.close();
  }
}

async function readWhenSettled() {
  // The screen publishes twice — once when layout settles and once later, in
  // case anything measured text asynchronously. Poll until the case count
  // stops growing so a partial first pass is never mistaken for the answer.
  let previous = -1;
  let measured = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    measured = await readPublished();
    const count = measured == null ? 0 : Object.keys(measured).length;
    process.stdout.write(`\r  read ${count}/${cases.length} cases`);
    if (count === cases.length && count === previous) {
      break;
    }
    previous = count;
    await sleep(1000);
  }
  process.stdout.write('\n');
  if (measured == null) {
    throw new Error(
      'the screen published nothing — is RNTester on the "Text conformance" screen?',
    );
  }
  return measured;
}

function main(platform) {
  if (!fs.existsSync(EXPECTED)) {
    throw new Error(`${EXPECTED} is missing — run \`node oracle.js\` first`);
  }
  const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
  const oracleByName = new Map(expected.cases.map(c => [c.name, c]));

  return readWhenSettled().then(measuredByName => {
    const report = [];
    let failed = 0;

    for (const c of cases) {
      const mine = measuredByName[c.name];
      const theirs = oracleByName.get(c.name);
      const problems = [];

      if (mine == null) {
        problems.push('not measured on device');
      } else {
        for (const f of checkAsserts(c, mine, contentWidthOf(c, W))) {
          problems.push(`assert: ${f}`);
        }
        if (c.baseline != null) {
          for (const f of checkDiffs(c, mine, measuredByName[c.baseline])) {
            problems.push(`diff: ${f}`);
          }
        }
        const ours = signature(mine);
        if (theirs != null && ours !== theirs.signature) {
          problems.push(
            `structure differs from Safari\n      safari: ${theirs.signature}\n      ${platform}: ${ours}`,
          );
        }
        const missing = probeIds(c).filter(id => mine.probes[id] == null);
        if (missing.length > 0) {
          problems.push(`no rect for probe(s): ${missing.join(', ')}`);
        }
      }

      if (problems.length > 0) {
        failed++;
      }
      report.push({name: c.name, spec: c.spec, why: c.why, problems});
    }

    for (const entry of report) {
      if (entry.problems.length === 0) {
        console.log(`  ok   ${entry.name}`);
      } else {
        console.log(`  FAIL ${entry.name}  [${entry.spec}]`);
        console.log(`       ${entry.why}`);
        for (const p of entry.problems) {
          console.log(`       - ${p}`);
        }
      }
    }
    console.log(
      `\n${platform}: ${cases.length - failed}/${cases.length} cases match Safari`,
    );

    const out = path.join(__dirname, `results-${platform}.json`);
    fs.writeFileSync(out, JSON.stringify({platform, report}, null, 1));
    console.log(`wrote ${out}`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
}

function probeIds(c) {
  const ids = [];
  const walk = node => {
    if (typeof node === 'string') {
      return;
    }
    if (node.id != null) {
      ids.push(node.id);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  for (const child of c.children ?? []) {
    walk(child);
  }
  return ids;
}

const platform = process.argv[2] ?? 'ios';
main(platform).catch(e => {
  console.error('VERIFY-ERROR', e.message);
  process.exit(1);
});
