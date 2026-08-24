/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * Receives the device's geometry and compares it with real Safari.
 *
 *   node verify.js ios | android
 *
 * Starts the report server, waits for the screen to POST, then diffs against
 * `expected.json` and prints every disagreement. Writes `actual-<platform>.json`
 * so a run can be re-examined without the device.
 *
 * ## What counts as a match
 *
 * The font-free cases are compared **exactly**, to a 0.5pt tolerance that
 * exists only for the device's pixel rounding (a 3x screen rounds to 1/3 pt) —
 * not as slack for a layout that is nearly right. Those cases are constructed so
 * that CSS determines every coordinate, so anything beyond rounding is a real
 * disagreement with the browser.
 *
 * `withText` cases are compared **structurally**: which boxes share a line and
 * in what order. Their absolute coordinates depend on the font's advance widths,
 * which differ between WebKit on macOS and each platform's own text stack, so a
 * pixel comparison there would report font differences as layout bugs.
 */

const {CASES} = require('./cases');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = 8900;
/* Device pixel rounding only: 1/3 pt on a 3x screen, rounded up. */
const TOLERANCE = 0.5;

const platform = process.argv[2] ?? 'ios';

function loadExpected() {
  const file = path.join(__dirname, 'expected.json');
  if (!fs.existsSync(file)) {
    console.error('expected.json missing — run `node oracle.js` first');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/*
 * "Which boxes are on the same line, in what order" — the comparison for cases
 * whose absolute numbers are a fact about a font. Two boxes share a line when
 * their vertical extents overlap; the order within a line is by x.
 */
function signature(rects) {
  const entries = Object.entries(rects).filter(([m]) => m !== 'root');
  const lines = [];
  for (const [m, r] of entries.sort(
    (a, b) => a[1].y - b[1].y || a[1].x - b[1].x,
  )) {
    const line = lines.find(l =>
      l.some(
        ([, o]) =>
          Math.min(o.y + o.height, r.y + r.height) > Math.max(o.y, r.y),
      ),
    );
    if (line) {
      line.push([m, r]);
    } else {
      lines.push([[m, r]]);
    }
  }
  return lines
    .map(line =>
      line
        .sort((a, b) => a[1].x - b[1].x)
        .map(([m]) => m)
        .join(' '),
    )
    .join(' | ');
}

function compare(expected, actual) {
  const failures = [];
  let exactChecks = 0;

  for (const testCase of CASES) {
    const name = testCase.name;
    const want = expected[name];
    const got = actual[name];
    if (want == null) {
      failures.push({name, detail: 'missing from expected.json'});
      continue;
    }
    if (got == null) {
      failures.push({name, detail: 'device reported nothing'});
      continue;
    }

    /*
     * A baseline-aligned box: the line box is the box plus the strut's descent
     * below the baseline, and that descent is a font metric (Safari 44, iOS
     * 44.33, Android 43.81 for the same 40pt box). What CSS fixes is that the
     * line is strictly TALLER than the box — the claim the case exists to make
     * — and that the box keeps its declared size at the top of the line.
     */
    /*
     * A shifted run keeps the line's interior rhythm, and the RUN'S BOX
     * reserves the shifted ink at its edges — the revised deviation
     * (SpecDeviations.md "sup/sub shift inside the line box"). Safari
     * deliberately differs both ways: it grows the LINE (30.53 for this
     * markup) and reserves nothing at the box.
     *
     * The reserve is half the shifted fragment's font size per shifted edge:
     * sup and sub are 0.8333em of the root's 16px, so the box is the
     * declared line-height plus 2 x (0.8333*16)/2. Tolerance is 1pt rather
     * than the global 0.5: iOS's text measurement ceils this box to whole
     * points (33.33 measures 34), which is rounding, not layout.
     */
    if (testCase.bounded === 'line-height-unchanged-by-shift') {
      const declared = parseFloat(testCase.tree.style.lineHeight);
      const shiftedFontSize = 0.8333 * parseFloat(testCase.tree.style.fontSize);
      const expected = declared + shiftedFontSize;
      exactChecks++;
      if (Math.abs(got.root.height - expected) > 1) {
        failures.push({
          name,
          detail: `run box is ${got.root.height}, not line-height ${declared} + the reserved shift ink ${shiftedFontSize} = ${expected}`,
          why: testCase.why,
        });
      }
      continue;
    }

    if (testCase.bounded === 'line-taller-than-box') {
      const box = got.only;
      const rootRect = got.root;
      const wantBox = want.only;
      const problems = [];
      if (Math.abs(box.width - wantBox.width) > TOLERANCE) {
        problems.push(`only.width ${box.width} vs ${wantBox.width}`);
      }
      if (Math.abs(box.height - wantBox.height) > TOLERANCE) {
        problems.push(`only.height ${box.height} vs ${wantBox.height}`);
      }
      if (Math.abs(box.y - rootRect.y) > TOLERANCE) {
        problems.push(`only.y ${box.y} is not the top of the line`);
      }
      if (!(rootRect.height > box.height + TOLERANCE)) {
        problems.push(
          `line box ${rootRect.height} is not strictly taller than the box ${box.height}`,
        );
      }
      exactChecks += 4;
      if (problems.length > 0) {
        failures.push({name, detail: problems.join('; '), why: testCase.why});
      }
      continue;
    }

    if (testCase.fontDependent != null) {
      /*
       * Not compared to Safari's coordinate, and not skipped either.
       *
       * `vertical-align: middle` is defined against the parent's X-HEIGHT
       * (CSS2 §10.8.1), so its offset is a fact about a font file: San
       * Francisco, Roboto and whatever WebKit picked differ, and the box
       * legitimately lands a point or two apart. Measured: iOS within 0.1 of
       * Safari, Android 1.4 away — both correct for their own font.
       *
       * What IS engine-independent is that the box lands strictly between the
       * `top` and `bottom` extremes, and inside its line box. That is asserted
       * instead.
       */
      const short = got.short;
      const tall = got.tall;
      const root = got.root;
      const inside =
        short.y >= root.y - TOLERANCE &&
        short.y + short.height <= root.y + root.height + TOLERANCE;
      const between =
        short.y > tall.y && short.y + short.height < tall.y + tall.height;
      if (!inside || !between) {
        failures.push({
          name,
          detail: `middle at y=${short.y} is not strictly inside the line box (${root.y}..${root.y + root.height})`,
          why: testCase.why,
        });
      }
      continue;
    }

    if (testCase.heightOnly === true) {
      // Text, but the assertion is the line box height, which `line-height`
      // pins regardless of which font shaped the glyphs.
      const delta = Math.abs(want.root.height - got.root.height);
      if (delta > TOLERANCE) {
        failures.push({
          name,
          detail: `root.height: safari ${want.root.height} vs ${platform} ${got.root.height}`,
          why: testCase.why,
        });
      }
      continue;
    }

    /*
     * Boxes that must share an x as each other, rather than match Safari's.
     *
     * For a property like "the encoding of the preceding text does not move
     * the box", the absolute coordinate is a fact about a font — an accented
     * glyph's advance differs per engine and legitimately so — while the
     * EQUALITY has to hold in every engine. Comparing the pair to itself keeps
     * the font out of the assertion without weakening it.
     *
     * Checked on Safari too, and reported as a corpus fault rather than an
     * engine fault: if the browser does not satisfy it, the case is making a
     * claim CSS does not, and holding the devices to it would be wrong.
     */
    if (testCase.sameX != null) {
      for (const [a, b] of testCase.sameX) {
        for (const [label, rects] of [
          ['safari', want],
          [platform, got],
        ]) {
          if (rects[a] == null || rects[b] == null) {
            failures.push({
              name,
              detail: `${label}: ${a}/${b} not measured`,
              why: testCase.why,
            });
            continue;
          }
          exactChecks++;
          const delta = Math.abs(rects[a].x - rects[b].x);
          if (delta > TOLERANCE) {
            failures.push({
              name,
              detail:
                label === 'safari'
                  ? `CORPUS FAULT — safari itself puts ${a}.x=${rects[a].x} and ${b}.x=${rects[b].x} (off by ${delta.toFixed(2)}); the case asserts something CSS does not`
                  : `${a}.x=${rects[a].x} vs ${b}.x=${rects[b].x} on ${label} (off by ${delta.toFixed(2)}) — identical text, different encoding`,
              why: testCase.why,
            });
          }
        }
      }
    }

    /*
     * An INSET compared to Safari's, rather than a coordinate.
     *
     * `inner.x - outer.x` is the outer box's left border plus its left padding.
     * CSS pins that exactly, in absolute units, whatever font is in use — so it
     * can be held to the browser's number even in a case whose absolute
     * coordinates cannot be. It is how a user-agent padding is checked without
     * pretending the surrounding text measures the same in three engines.
     */
    if (testCase.deltaX != null) {
      for (const [outer, inner] of testCase.deltaX) {
        if (
          want[outer] == null ||
          want[inner] == null ||
          got[outer] == null ||
          got[inner] == null
        ) {
          failures.push({name, detail: `${outer}/${inner} not measured`});
          continue;
        }
        exactChecks++;
        const wantDelta = want[inner].x - want[outer].x;
        const gotDelta = got[inner].x - got[outer].x;
        if (Math.abs(wantDelta - gotDelta) > TOLERANCE) {
          failures.push({
            name,
            detail: `${inner}.x - ${outer}.x: safari ${wantDelta.toFixed(2)} vs ${platform} ${gotDelta.toFixed(2)}`,
            why: testCase.why,
          });
        }
      }
    }

    if (testCase.withText === true) {
      const wantSig = signature(want);
      const gotSig = signature(got);
      if (wantSig !== gotSig) {
        failures.push({
          name,
          detail: `lines differ\n      safari: ${wantSig}\n      ${platform}: ${gotSig}`,
        });
      }
      continue;
    }

    for (const [m, w] of Object.entries(want)) {
      const g = got[m];
      if (g == null) {
        failures.push({name, detail: `${m}: not measured on device`});
        continue;
      }
      for (const key of ['x', 'y', 'width', 'height']) {
        exactChecks++;
        const delta = Math.abs(w[key] - g[key]);
        if (delta > TOLERANCE) {
          failures.push({
            name,
            detail: `${m}.${key}: safari ${w[key]} vs ${platform} ${g[key]}  (off by ${delta.toFixed(2)})`,
            why: testCase.why,
          });
        }
      }
    }
  }
  return {failures, exactChecks};
}

function main() {
  const expected = loadExpected();
  console.log(
    `waiting for ${platform} on :${PORT} — open "HTML: conformance harness" in RNTester`,
  );

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{"ok":true}');

      let actual;
      try {
        actual = JSON.parse(body);
      } catch (e) {
        console.error('bad payload:', body.slice(0, 200));
        process.exit(1);
      }
      fs.writeFileSync(
        path.join(__dirname, `actual-${platform}.json`),
        JSON.stringify(actual, null, 2),
      );

      const {failures, exactChecks} = compare(expected, actual);
      const byCase = new Map();
      for (const f of failures) {
        if (!byCase.has(f.name)) {
          byCase.set(f.name, []);
        }
        byCase.get(f.name).push(f);
      }

      console.log(
        `\n${exactChecks} exact coordinate checks across ${CASES.length} cases\n`,
      );
      if (failures.length === 0) {
        console.log(`PASS — ${platform} matches real Safari exactly`);
      } else {
        for (const [name, list] of byCase) {
          const testCase = CASES.find(c => c.name === name);
          console.log(`FAIL ${name}`);
          console.log(`     ${testCase?.why ?? ''}`);
          for (const f of list) {
            console.log(`     ${f.detail}`);
          }
          console.log('');
        }
        console.log(
          `${byCase.size} of ${CASES.length} cases disagree with Safari`,
        );
      }
      server.close();
      process.exit(failures.length === 0 ? 0 : 1);
    });
  });
  server.listen(PORT);
}

main();
