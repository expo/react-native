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
 * Assembles the cross-engine comparison report.
 *
 * Three columns where all three exist — real Safari, iOS, Android — and two
 * where the case has no browser counterpart. The report is generated rather
 * than written because the screenshots are regenerated: a hand-assembled page
 * would start lying the first time a demo changed, and the lie would be
 * invisible because the prose would still read correctly.
 *
 * Findings live in `findings.json` beside this file, keyed by the same
 * `Screen~example` string the screenshots use. They are written by hand — a
 * screenshot cannot tell you whether a difference is a bug, a deliberate
 * deviation, or the platform being itself — but they are *attached* to the
 * evidence mechanically, so a finding whose case disappears becomes visible
 * instead of becoming a paragraph about something that is no longer there.
 */

const {build: buildCorpus} = require('./extract-demo-html.js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHOTS = '/tmp/shots';
const OUT = path.join(__dirname, 'comparison-report');

const PLATFORMS = [
  {key: 'web', label: 'Safari', sub: 'real WebKit, 402px viewport'},
  {key: 'ios', label: 'iOS', sub: 'iPhone 17 Pro simulator'},
  {key: 'android', label: 'Android', sub: 'emulator, API 36'},
];

/** Screens grouped the way the report reads, not the way the repo stores them. */
const SECTIONS = [
  {
    title: 'HTML elements',
    blurb:
      'The elements themselves, against a browser given the same markup. ' +
      'These are the cases where "does it match the web" is a fair question.',
    screens: [
      'HTMLTextLevelExample',
      'HTMLGroupingExample',
      'HTMLEmbeddedExample',
      'HTMLFormsExample',
    ],
  },
  {
    title: 'Layout and CSS',
    blurb:
      'Block and inline formatting, the cascade, stylesheets, transitions and ' +
      'animations. Measured numerically against Safari by the conformance ' +
      'harness; shown here for the visual half.',
    screens: [
      'HTMLConformanceExample',
      'DisplayBlockExample',
      'DisplayInlineExample',
      'CascadeExample',
      'CSSStylesheetsExample',
      'CSSTransitionsExample',
      'CSSAnimationsExample',
    ],
  },
  {
    title: 'Text and the DOM',
    blurb:
      'Text children, intrinsics and lists — the layer the elements are built ' +
      'on.',
    screens: [
      'StringChildrenExample',
      'HTMLIntrinsicsDocExample',
      'IntrinsicElementsExample',
      'ListsExample',
    ],
  },
  {
    title: 'Design systems',
    blurb:
      'Astryx, Radix and shadcn running on the fork. No browser column: these ' +
      'are compared across platforms, since the question is whether one ' +
      'component tree gives the same result on both.',
    screens: ['AstryxExample', 'RadixExample', 'ShadcnExample'],
  },
  {
    title: 'Native surface',
    blurb:
      'Where the answer is deliberately *not* the web: platform buttons ' +
      'and icons.',
    screens: ['NativeButtonExample', 'IconsExample'],
  },
];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline markdown: `code`, **bold**, *italic*. */
function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function listShots(platform) {
  const dir = path.join(SHOTS, platform);
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace(/\.png$/, '')),
  );
}

/**
 * Frames that are byte-identical to another frame in the same screen.
 *
 * Two different examples of one screen never render the same picture, so a
 * duplicate means the app had not finished navigating when the shot was taken
 * and the frame belongs to a different case. This is checked HERE, in the thing
 * that publishes the evidence, because every earlier place it was checked was a
 * place I could forget: four separate capture bugs in this session each produced
 * a directory of correctly-named, correctly-sized PNGs of the wrong thing.
 *
 * Flagged in the page rather than dropped. A missing column invites the reader
 * to assume the platform failed to render; a labelled one says what is actually
 * known.
 */
/*
 * Route pairs whose frames are IDENTICAL by design, not by navigation failure.
 * Verified by reading the demos: both DisplayContents examples render an
 * empty bordered box — a `display: contents` leaf is ignored in layout and a
 * `display: contents` TextInput behaves as `display: none`, so "nothing
 * inside a red border" is the correct picture for each. A group that is a
 * subset of one entry here is not flagged.
 */
const IDENTICAL_BY_DESIGN = [];

function duplicateFrames(platform, keys) {
  const byDigest = new Map();
  for (const key of keys) {
    const file = path.join(SHOTS, platform, `${key}.png`);
    if (!fs.existsSync(file)) continue;
    const screen = key.split('~')[0];
    const digest =
      screen +
      ':' +
      crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    if (!byDigest.has(digest)) byDigest.set(digest, []);
    byDigest.get(digest).push(key);
  }
  const flagged = new Set();
  for (const group of byDigest.values()) {
    if (group.length < 2) continue;
    if (
      IDENTICAL_BY_DESIGN.some(allowed => group.every(k => allowed.has(k)))
    ) {
      continue;
    }
    for (const k of group) flagged.add(k);
  }
  return flagged;
}

function main() {
  const available = {};
  const suspect = {};
  for (const p of PLATFORMS) {
    available[p.key] = listShots(p.key);
    suspect[p.key] = duplicateFrames(p.key, available[p.key]);
  }

  const findingsPath = path.join(__dirname, 'findings.json');
  const raw = fs.existsSync(findingsPath)
    ? JSON.parse(fs.readFileSync(findingsPath, 'utf8'))
    : {};
  // Keys beginning with `_` are notes to the reader of the JSON, not findings.
  const findings = {};
  for (const k of Object.keys(raw))
    if (!k.startsWith('_')) findings[k] = raw[k];

  fs.mkdirSync(OUT, {recursive: true});
  fs.mkdirSync(path.join(OUT, 'img'), {recursive: true});

  // Every key any platform has, grouped by screen.
  const byScreen = new Map();
  for (const p of PLATFORMS) {
    for (const key of available[p.key]) {
      const screen = key.split('~')[0];
      if (!byScreen.has(screen)) byScreen.set(screen, new Set());
      byScreen.get(screen).add(key);
    }
  }

  /*
   * Copy the referenced images at FULL resolution.
   *
   * They were downscaled to 600px to keep the report small, and that was the
   * wrong trade for what this page is for. A device screenshot is 1206×2622;
   * halving it throws away exactly the evidence someone opens the report to
   * check — a hairline rule, a dotted underline, whether a decoration is one
   * pixel or two. The thumbnail in the grid is CSS-scaled, so the page still
   * looks the same; clicking through now gets the real pixels instead of a
   * blurred copy of them.
   *
   * The cost is size, and it is worth it: the images are the artefact here.
   */
  let copied = 0;
  let bytes = 0;
  for (const p of PLATFORMS) {
    for (const key of available[p.key]) {
      const src = path.join(SHOTS, p.key, `${key}.png`);
      const dst = path.join(OUT, 'img', `${p.key}~~${key}.png`);
      fs.copyFileSync(src, dst);
      bytes += fs.statSync(dst).size;
      copied++;
    }
  }

  const counted = {web: 0, ios: 0, android: 0, cases: 0};
  const body = [];

  for (const section of SECTIONS) {
    const screens = section.screens.filter(s => byScreen.has(s));
    if (!screens.length) continue;
    body.push(
      `<h2 id="${esc(section.title.replace(/\s+/g, '-'))}">${esc(section.title)}</h2>`,
      `<p class="blurb">${md(section.blurb)}</p>`,
    );

    for (const screen of screens) {
      const keys = [...byScreen.get(screen)].sort();
      body.push(`<h3>${esc(screen.replace(/Example$/, ''))}</h3>`);

      for (const key of keys) {
        counted.cases++;
        const example = key.includes('~')
          ? key.split('~')[1]
          : '(whole screen)';
        const cols = PLATFORMS.filter(p => available[p.key].has(key));
        for (const c of cols) counted[c.key]++;

        const note = findings[key];
        body.push(`<div class="case">`);
        body.push(
          `<div class="case-head"><span class="ex">${esc(example)}</span>` +
            `<span class="cols">${cols.map(c => c.label).join(' · ')}</span></div>`,
        );
        if (note) {
          body.push(
            `<div class="finding ${esc(note.kind || 'note')}">` +
              `<span class="tag">${esc(kindLabel(note.kind || 'note'))}</span>` +
              `<div class="finding-body">${md(note.text)}</div></div>`,
          );
        }
        body.push(`<div class="shots">`);
        for (const c of cols) {
          body.push(
            `<figure${suspect[c.key].has(key) ? ' class="suspect"' : ''}>` +
              `<figcaption>${esc(c.label)}<small>${
                suspect[c.key].has(key)
                  ? 'CAPTURE UNRELIABLE — identical to another example on this screen'
                  : esc(c.sub)
              }</small></figcaption>` +
              `<a href="img/${esc(c.key)}~~${esc(key)}.png" target="_blank">` +
              `<img loading="lazy" src="img/${esc(c.key)}~~${esc(key)}.png" alt="${esc(key)} on ${esc(c.label)}"></a></figure>`,
          );
        }
        body.push(`</div></div>`);
      }
    }
  }

  const corpus = buildCorpus();
  const html = shell(body.join('\n'), counted, findings, corpus);
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(`comparison-report/index.html`);
  console.log(
    `  ${counted.cases} cases · Safari ${counted.web} · iOS ${counted.ios} · Android ${counted.android}`,
  );
  console.log(
    `  ${copied} images at full resolution (${(bytes / 1e6).toFixed(0)}MB), ` +
      `${Object.keys(findings).length} findings`,
  );
  for (const p of PLATFORMS) {
    if (suspect[p.key].size) {
      console.log(
        `  ${p.label}: ${suspect[p.key].size} frames flagged unreliable`,
      );
    }
  }
}

/**
 * How the three columns were produced, and what they can and cannot settle.
 *
 * This sits at the top of the report rather than at the bottom because every
 * number below it is only worth what the method is worth. Most of the effort in
 * building this went into removing differences that were artefacts of the
 * comparison rather than of the engines — the browser page being set in
 * different type, JSX whitespace rules, a stylesheet of mine restyling the
 * content being demonstrated — and each of those, before it was found, looked
 * exactly like a finding.
 */
function METHOD(counted, corpus) {
  const extracted = corpus.total - corpus.skipped;
  return `
<h2 id="Method">Method</h2>
<dl class="method">
  <dt>Safari — real WebKit, not an emulation</dt>
  <dd>The demos' own markup, lifted out of the JSX and served to Safari through
  safaridriver at a <strong>402px viewport</strong> (the iPhone 17 Pro width the
  device shots use) in <code>-apple-system</code>, which is the same San
  Francisco the device draws with. The page adds no stylesheet of its own beyond
  the demo's inline styles: the browser's user-agent sheet is the thing under
  comparison, so a reset would erase exactly what is being checked.</dd>

  <dt>Why the markup is extracted rather than re-typed</dt>
  <dd>A hand-written reference page drifts from the demo silently, and every
  drift shows up as a rendering difference that is really a transcription error.
  ${extracted} of ${corpus.total} cases are pure enough markup to lift; the
  other ${corpus.skipped} carry real logic and are <strong>skipped and
  counted</strong>, never guessed at. A case rendered from a half-understood
  body still produces a screenshot, and a screenshot looks like evidence.</dd>

  <dt>Same text column, or nothing is comparable</dt>
  <dd>RNTester puts every example in its own padded card, so the text column on
  screen is ~331pt rather than the 370 a 402pt screen would suggest. Measured off
  the device and matched in the browser. Until it was, iOS broke every line a
  word earlier than Safari — which reads as CoreText and WebKit disagreeing
  about font metrics, and is not that at all.</dd>

  <dt>What the pictures do NOT settle</dt>
  <dd>Exact geometry. Android's viewport is 411dp with its own container
  padding, and the platforms shape text with different optical sizes of the same
  family, so line-break positions are not expected to agree across all three.
  Coordinates are pinned separately by <code>oracle.js</code>, on a corpus built
  to be font-free. What these pictures are for is whether the <em>elements</em>
  are right: a box around <code>&lt;kbd&gt;</code>, a highlight ending with the
  word, a caption under its figure.</dd>

  <dt>Correction: the coordinate harness is not currently all-green</dt>
  <dd>An earlier version of this page said that harness passed <strong>244
  checks across 23 cases on both platforms</strong>. Re-running it says
  <strong>19 of 23 on iOS</strong>: four cases that put a sized box inside a
  <code>&lt;span&gt;</code> place it as though the inline box occupied space
  before it. Safari's side regenerates byte-identically, so the disagreement is
  on the device. The 244 figure came from a status line in a README rather than
  from a run — quoted, not reproduced — which is the same mistake as trusting a
  screenshot without checking what is in it, one level further up. The visual
  comparisons below are unaffected; what changes is that geometry is
  <em>not</em> fully pinned elsewhere, so nothing here should be read as resting
  on that.</dd>

  <dt>Captures are verified, not assumed</dt>
  <dd>Every Android frame is checked for the LogBox sheet and for having any ink
  on it at all, and re-taken from a cold start if either fails. Two earlier runs
  produced 92 valid PNGs of the right size that were, respectively, 69 pictures
  of a stack trace and 90 pictures of nothing.</dd>
</dl>`;
}

/*
 * What a kind's pill READS. `deviation` is spelled out as intentional —
 * every one of them is a documented decision (SpecDeviations.md), and an
 * unlabeled "deviation" reads like a defect.
 */
function kindLabel(kind) {
  return kind === 'deviation'
    ? 'intentional deviation'
    : String(kind).replace(/-/g, ' ');
}

function shell(body, counted, findings, corpus) {
  const kinds = {};
  for (const k of Object.keys(findings)) {
    const kind = findings[k].kind || 'note';
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  const legend = Object.keys(kinds)
    .sort()
    .map(
      k =>
        `<span class="finding ${esc(k)}"><span class="tag">${esc(kindLabel(k))}</span> ${kinds[k]}</span>`,
    )
    .join(' ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>HTML elements on iOS and Android — compared with a browser</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body {
    font: 16px/1.55 -apple-system, system-ui, sans-serif;
    max-width: 1180px; margin: 0 auto; padding: 32px 20px 96px;
  }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 {
    font-size: 21px; margin: 56px 0 4px;
    padding-top: 18px; border-top: 2px solid color-mix(in srgb, currentColor 18%, transparent);
  }
  h3 {
    font-size: 15px; margin: 34px 0 10px; text-transform: uppercase;
    letter-spacing: 0.08em; opacity: 0.65;
  }
  p.blurb { margin: 0 0 8px; opacity: 0.75; max-width: 68ch; }
  .lede { font-size: 17px; max-width: 70ch; }
  .case {
    margin: 18px 0 28px;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 10px; padding: 12px 14px 14px;
  }
  .case-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .ex { font-weight: 600; font-size: 15px; }
  .cols { font-size: 12px; opacity: 0.55; }
  .shots { display: flex; gap: 14px; align-items: flex-start; margin-top: 10px; flex-wrap: wrap; }
  figure { margin: 0; flex: 1 1 0; min-width: 210px; max-width: 340px; }
  figcaption {
    font-size: 12px; opacity: 0.7; margin-bottom: 4px;
    display: flex; flex-direction: column;
  }
  figcaption small { opacity: 0.6; font-size: 11px; }
  figure.suspect figcaption small { color: #ff9500; opacity: 1; font-weight: 600; }
  figure.suspect img { outline: 2px solid #ff9500; outline-offset: -2px; opacity: 0.55; }
  img {
    width: 100%; height: auto; display: block;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: 6px; background: #fff;
  }
  .finding {
    display: flex; gap: 10px; align-items: flex-start;
    margin: 10px 0 2px; padding: 9px 11px; border-radius: 8px; font-size: 14px;
    background: color-mix(in srgb, currentColor 7%, transparent);
    border-left: 3px solid color-mix(in srgb, currentColor 35%, transparent);
  }
  .finding .tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
    font-weight: 700; padding: 2px 7px; border-radius: 999px; white-space: nowrap;
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .finding.bug        { border-left-color: #ff3b30; background: color-mix(in srgb, #ff3b30 11%, transparent); }
  /* PURPLE for an INTENTIONAL deviation — a decision, documented in
     SpecDeviations.md, not a warning; the label says so too. Yellow/orange
     is reserved for disparities, which ARE warnings (the platforms
     disagreeing with each other unintentionally). */
  .finding.deviation  { border-left-color: #af52de; background: color-mix(in srgb, #af52de 11%, transparent); }
  .finding.disparity  { border-left-color: #ff9500; background: color-mix(in srgb, #ff9500 11%, transparent); }
  .finding.match      { border-left-color: #34c759; background: color-mix(in srgb, #34c759 10%, transparent); }
  .finding.limitation { border-left-color: #30b0c7; background: color-mix(in srgb, #30b0c7 11%, transparent); }
  code {
    font: 0.88em ui-monospace, Menlo, monospace;
    background: color-mix(in srgb, currentColor 10%, transparent);
    padding: 1px 4px; border-radius: 4px;
  }
  .method { max-width: 74ch; }
  .method dt { font-weight: 650; margin-top: 12px; }
  .method dd { margin: 2px 0 0 0; opacity: 0.82; }
  .counts { font-size: 13px; opacity: 0.7; margin-top: 6px; }
  a { color: inherit; }
</style></head>
<body>
<h1>HTML elements on iOS and Android, compared with a browser</h1>
<p class="counts">${counted.cases} cases · Safari ${counted.web} · iOS ${counted.ios} · Android ${counted.android} · ${legend}</p>

${METHOD(counted, corpus)}

${body}
</body></html>`;
}

main();
