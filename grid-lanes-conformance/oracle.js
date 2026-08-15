/**
 * Renders every case in cases.js as CSS, loads them in real Safari through
 * safaridriver, and records the resulting geometry into expected.json.
 *
 * Safari 26.4+ implements css-grid-3 natively, so it is the ground truth for
 * `display: grid-lanes` and `flow-tolerance` — the same oracle arrangement
 * used for the css-display work.
 *
 * All cases render on ONE page and are read back in a single evaluation, so
 * the whole corpus costs one navigation rather than one per case.
 *
 * Usage:
 *   node oracle.js                 # write expected.json
 *   node oracle.js --html out.html # just emit the page (to eyeball in a browser)
 *
 * @noflow
 * @format
 */

'use strict';

const {execSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {cases} = require('./cases.js');
const {
  trackToCss,
  toleranceToCss,
  containerCss,
  itemCss,
  placementToCss,
  itemChildHtml,
} = require('./serialize.js');

const DRIVER_PORT = 4457;
const PAGE_PORT = 8793;
const OUT = path.join(__dirname, 'expected.json');

// ---------------------------------------------------------------------------
// Case → CSS
// ---------------------------------------------------------------------------

// `grid-template-areas` puts double quotes INSIDE the style declaration, which
// would close the HTML attribute and corrupt every case after it on the page.
// The corruption is silent — the page still renders, just as something else
// entirely — so it shows up as a wrong expected value rather than an error.
function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// A `display: none` child has no box at all, so getBoundingClientRect gives
// zeros in absolute coordinates and subtracting the container's origin turns
// them into a large negative offset. Record the empty box every engine must
// agree on; the consumers skip the position assertions for these items, since
// there is no position to agree about.
function zeroHiddenItems(c, result) {
  if (result == null) return result;
  return {
    ...result,
    items: result.items.map((item, i) =>
      c.items[i]?.displayNone ? {...item, x: 0, y: 0, w: 0, h: 0} : item,
    ),
  };
}

// A case may declare that Safari is wrong about the stacking axis and supply
// spec-derived positions for it. Everything else Safari measured is kept —
// the grid axis, the sizes, the container — so only the disputed number is
// hand-supplied, and it is supplied ONE place rather than in each consumer.
//
// The count is asserted because a corpus edit that adds or removes an item
// would otherwise silently leave the override applying to the wrong ones.
function applyDivergence(c, result) {
  const divergence = c.oracleDivergence;
  if (divergence == null || result == null) {
    return result;
  }
  const axis = divergence.axis ?? 'y';
  const values = divergence[axis];
  if (values.length !== result.items.length) {
    throw new Error(
      `${c.id}: the stacking override lists ${values.length} positions ` +
        `but the case has ${result.items.length} items`,
    );
  }
  return {
    ...result,
    items: result.items.map((item, i) => ({...item, [axis]: values[i]})),
  };
}

function buildHtml() {
  const blocks = cases
    .map(c => {
      const items = c.items
        .map(
          (it, i) =>
            `<i style="${escapeAttribute(itemCss(it))}" data-i="${i}">${itemChildHtml(
              it,
            )}</i>`,
        )
        .join('');
      // Each case sits in its own fixed-width wrapper so that nothing about
      // the page layout leaks into the case.
      return `<div class="wrap"><div class="case" data-id="${c.id}" style="${escapeAttribute(
        containerCss(c.container),
      )}">${items}</div></div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>grid-lanes conformance</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font: 16px/1 monospace; }
  .wrap { width: 900px; margin: 0 0 24px 0; }
  .case > i { display: block; background: #cde; }
</style></head>
<body>
${blocks}
<script>
window.__measure = function (start, end) {
  var out = {};
  var supports = {
    gridLanes: CSS.supports('display', 'grid-lanes'),
    flowTolerance: CSS.supports('flow-tolerance', 'normal'),
    flowToleranceInfinite: CSS.supports('flow-tolerance', 'infinite')
  };
  var nodes = document.querySelectorAll('.case');
  if (start == null) { start = 0; }
  if (end == null || end > nodes.length) { end = nodes.length; }
  for (var n = start; n < end; n++) {
    var el = nodes[n];
    var cr = el.getBoundingClientRect();
    var rec = {
      container: {w: round(cr.width), h: round(cr.height)},
      items: []
    };
    var kids = el.children;
    for (var k = 0; k < kids.length; k++) {
      var r = kids[k].getBoundingClientRect();
      rec.items.push({
        i: Number(kids[k].getAttribute('data-i')),
        x: round(r.left - cr.left),
        y: round(r.top - cr.top),
        w: round(r.width),
        h: round(r.height)
      });
    }
    // Report items in source order, not paint order.
    rec.items.sort(function (a, b) { return a.i - b.i; });
    out[el.getAttribute('data-id')] = rec;
  }
  function round(v) { return Math.round(v * 100) / 100; }
  return {supports: supports, results: out, total: nodes.length};
};
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// safaridriver
// ---------------------------------------------------------------------------

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
  const out = execSync(`curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
    maxBuffer: 1 << 28,
  }).toString();
  // A successful DELETE answers with an empty body.
  return out.trim() === '' ? null : JSON.parse(out);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const html = buildHtml();
  const htmlArgIndex = process.argv.indexOf('--html');
  if (htmlArgIndex !== -1) {
    const dest = process.argv[htmlArgIndex + 1];
    fs.writeFileSync(dest, html);
    console.log(`wrote ${dest} (${cases.length} cases)`);
    return;
  }

  // The page is served over HTTP from a SEPARATE process. Two constraints
  // force this: the WebDriver calls below are synchronous, so a server on this
  // event loop could never answer Safari's request for the page (deadlock);
  // and Safari's sandbox refuses to load file:// URLs out of a private temp
  // directory, silently landing on its error page instead.
  const pageDir = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'grid-lanes-'),
  );
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

  let spawned = null;
  try {
    execSync(`curl -s -m 2 http://localhost:${DRIVER_PORT}/status > /dev/null`);
  } catch {
    console.log(`starting safaridriver on :${DRIVER_PORT}`);
    spawned = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    spawned.unref();
    await sleep(1500);
  }

  // Safari pairs with exactly one WebDriver session at a time, so a session
  // left behind by an earlier run blocks this one. Clear it out rather than
  // making the caller hunt for it. GRID_ORACLE_SESSION reuses one instead.
  const reuse = process.env.GRID_ORACLE_SESSION;
  let session = reuse
    ? {value: {sessionId: reuse}}
    : driver('POST', '/session', {
        capabilities: {alwaysMatch: {browserName: 'safari'}},
      });
  if (session.value?.error != null) {
    if (!/already paired/.test(session.value.message ?? '')) {
      throw new Error(`could not create a session: ${session.value.message}`);
    }
    console.log('Safari is paired with a stale session; clearing it');
    try {
      execSync('pkill -f safaridriver');
    } catch {
      // Nothing to kill.
    }
    await sleep(1500);
    spawned = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    spawned.unref();
    await sleep(2000);
    session = driver('POST', '/session', {
      capabilities: {alwaysMatch: {browserName: 'safari'}},
    });
    if (session.value?.error != null) {
      throw new Error(`could not create a session: ${session.value.message}`);
    }
  }
  const sid = session.value.sessionId;
  console.log(`session ${sid}`);

  try {
    driver('POST', `/session/${sid}/url`, {
      url: `http://localhost:${PAGE_PORT}/cases.html`,
    });
    await sleep(1200);
    // Read the corpus back in chunks: safaridriver fails a single execute
    // whose result string is large, and it reports that as a bare "internal
    // error" with nothing to point at the cause.
    const CHUNK = 15;
    let measured = null;
    const results = {};
    for (let start = 0; start < cases.length; start += CHUNK) {
      const res = driver('POST', `/session/${sid}/execute/sync`, {
        script: 'return JSON.stringify(window.__measure(arguments[0], arguments[1]))',
        args: [start, Math.min(start + CHUNK, cases.length)],
      });
      if (typeof res?.value !== 'string') {
        throw new Error(
          `Safari did not return measurements for cases ${start}..${
            start + CHUNK
          }: ${JSON.stringify(res)?.slice(0, 400)}`,
        );
      }
      const part = JSON.parse(res.value);
      measured = measured ?? part;
      Object.assign(results, part.results);
      process.stdout.write(`\r  measured ${Object.keys(results).length}/${cases.length}`);
    }
    process.stdout.write('\n');
    measured.results = results;
    if (measured.total !== cases.length) {
      throw new Error(
        `page rendered ${measured.total} cases but the corpus has ${cases.length}`,
      );
    }

    if (!measured.supports.gridLanes) {
      throw new Error(
        'this Safari does not support display:grid-lanes — the oracle would ' +
          'silently record flex/block fallback geometry as if it were grid-lanes',
      );
    }

    const byTier = {};
    for (const c of cases) {
      byTier[c.tier] = (byTier[c.tier] ?? 0) + 1;
    }

    const payload = {
      generatedBy: 'grid-lanes-conformance/oracle.js',
      oracle: 'Safari via safaridriver',
      supports: measured.supports,
      caseCount: cases.length,
      byTier,
      cases: cases.map(c => ({
        id: c.id,
        group: c.group,
        tier: c.tier,
        note: c.note,
        container: c.container,
        items: c.items,
        oracleDivergence: c.oracleDivergence ?? null,
        expected: zeroHiddenItems(c, applyDivergence(c, measured.results[c.id])),
      })),
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
    console.log(`wrote ${OUT}`);
    console.log(`  supports: ${JSON.stringify(measured.supports)}`);
    console.log(`  cases: ${cases.length} ${JSON.stringify(byTier)}`);
  } finally {
    // A session we were handed belongs to the caller; only close our own.
    if (!reuse) {
      try {
        driver('DELETE', `/session/${sid}`);
      } catch (e) {
        console.warn(`could not close session ${sid}: ${e.message}`);
      }
    }
    try {
      process.kill(-httpd.pid);
    } catch {
      // Already gone.
    }
  }
}

main().catch(e => {
  console.error('ORACLE-ERROR', e.message);
  process.exit(1);
});
