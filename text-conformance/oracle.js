/**
 * Renders every case in `cases.js` as HTML, loads it in real Safari through
 * safaridriver, and records the resulting geometry into `expected.json`.
 *
 * Safari is the ground truth for what the CSS says, and it is the only one of
 * the three engines whose answer nobody has to take on trust. What gets
 * recorded is the raw rects; `invariants.js` decides which parts of them mean
 * anything across engines.
 *
 * Usage:
 *   node oracle.js                 # write expected.json
 *   node oracle.js --html out.html # just emit the page, to open by hand
 *
 * @noflow
 * @format
 */

'use strict';

const {execSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {cases, W} = require('./cases.js');
const {buildPage} = require('./serialize.js');
const {signature, checkAsserts, checkDiffs, contentWidthOf} = require('./invariants.js');

const DRIVER_PORT = 4459;
const PAGE_PORT = 8795;
const OUT = path.join(__dirname, 'expected.json');

function driver(method, urlPath, body) {
  const args = [
    '-s',
    '-m',
    '90',
    '-X',
    method,
    `http://localhost:${DRIVER_PORT}${urlPath}`,
    '-H',
    'Content-Type: application/json',
  ];
  if (body != null) {
    args.push('-d', JSON.stringify(body));
  }
  const out = execSync(
    `curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
    {maxBuffer: 1 << 28},
  ).toString();
  return out.trim() === '' ? null : JSON.parse(out);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const html = buildPage(cases);

  const htmlArgIndex = process.argv.indexOf('--html');
  if (htmlArgIndex !== -1) {
    const dest = process.argv[htmlArgIndex + 1];
    fs.writeFileSync(dest, html);
    console.log(`wrote ${dest} (${cases.length} cases)`);
    return;
  }

  // Served from a separate process: the WebDriver calls below are synchronous,
  // so a server on this event loop could never answer Safari's request, and
  // Safari's sandbox refuses file:// out of a private temp directory — landing
  // on its error page without saying so.
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-conformance-'));
  fs.writeFileSync(path.join(pageDir, 'cases.html'), html);
  fs.chmodSync(pageDir, 0o755);
  fs.chmodSync(path.join(pageDir, 'cases.html'), 0o644);
  const httpd = spawn(
    'python3',
    ['-m', 'http.server', String(PAGE_PORT), '--directory', pageDir],
    {detached: true, stdio: 'ignore'},
  );
  httpd.unref();
  await sleep(800);
  console.log(`serving ${cases.length} cases from ${pageDir} on :${PAGE_PORT}`);

  try {
    execSync(`curl -s -m 2 http://localhost:${DRIVER_PORT}/status > /dev/null`);
  } catch {
    console.log(`starting safaridriver on :${DRIVER_PORT}`);
    const spawned = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    spawned.unref();
    await sleep(1500);
  }

  let session = driver('POST', '/session', {
    capabilities: {alwaysMatch: {browserName: 'safari'}},
  });
  if (session.value?.error != null) {
    // Safari pairs with one WebDriver session at a time; a session left behind
    // by an earlier run blocks this one.
    console.log('clearing a stale Safari session');
    try {
      execSync('pkill -f safaridriver');
    } catch {}
    await sleep(1500);
    const respawned = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    respawned.unref();
    await sleep(2000);
    session = driver('POST', '/session', {
      capabilities: {alwaysMatch: {browserName: 'safari'}},
    });
    if (session.value?.error != null) {
      throw new Error(`could not create a session: ${session.value.message}`);
    }
  }
  const sid = session.value.sessionId;

  try {
    driver('POST', `/session/${sid}/url`, {
      url: `http://localhost:${PAGE_PORT}/cases.html`,
    });
    await sleep(1200);

    // Read back in chunks: safaridriver fails a single execute whose result
    // string is large, and reports it as a bare "internal error".
    const CHUNK = 12;
    const results = {};
    let total = null;
    for (let start = 0; start < cases.length; start += CHUNK) {
      const res = driver('POST', `/session/${sid}/execute/sync`, {
        script: 'return JSON.stringify(window.__measure(arguments[0], arguments[1]))',
        args: [start, Math.min(start + CHUNK, cases.length)],
      });
      if (typeof res?.value !== 'string') {
        throw new Error(
          `Safari returned no measurements for cases ${start}..${start + CHUNK}: ` +
            `${JSON.stringify(res)?.slice(0, 400)}`,
        );
      }
      const part = JSON.parse(res.value);
      total = part.total;
      Object.assign(results, part.results);
      process.stdout.write(`\r  measured ${Object.keys(results).length}/${cases.length}`);
    }
    process.stdout.write('\n');

    if (total !== cases.length) {
      throw new Error(
        `the page rendered ${total} cases but the corpus has ${cases.length}`,
      );
    }

    // Safari has to satisfy the corpus before anything is compared against it.
    // A case whose own assertions Safari fails is a bug in the CASE — the
    // wrong reading of the spec, or a typo in the markup — and letting it
    // through would pin every other engine to that mistake.
    const selfFailures = [];
    for (const c of cases) {
      const m = results[c.name];
      if (m == null) {
        selfFailures.push(`${c.name}: not measured`);
        continue;
      }
      for (const f of checkAsserts(c, m, contentWidthOf(c, W))) {
        selfFailures.push(`${c.name}: ${f}`);
      }
      if (c.baseline != null) {
        for (const f of checkDiffs(c, m, results[c.baseline])) {
          selfFailures.push(`${c.name}: ${f}`);
        }
      }
    }
    if (selfFailures.length > 0) {
      console.error(
        `\nSafari does not satisfy ${selfFailures.length} assertion(s) — the ` +
          'corpus is wrong, not the browser:',
      );
      for (const f of selfFailures) {
        console.error(`  ${f}`);
      }
      process.exitCode = 1;
    }

    const payload = {
      generatedBy: 'text-conformance/oracle.js',
      oracle: 'Safari via safaridriver',
      containerWidth: W,
      caseCount: cases.length,
      cases: cases.map(c => ({
        name: c.name,
        spec: c.spec,
        why: c.why,
        baseline: c.baseline ?? null,
        signature: signature(results[c.name]),
        measured: results[c.name],
      })),
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
    console.log(`wrote ${OUT} (${cases.length} cases)`);
    if (selfFailures.length === 0) {
      console.log('Safari satisfies every assertion in the corpus');
    }
  } finally {
    try {
      driver('DELETE', `/session/${sid}`);
    } catch {}
    try {
      process.kill(-httpd.pid);
    } catch {}
  }
}

main().catch(e => {
  console.error('ORACLE-ERROR', e.message);
  process.exit(1);
});
