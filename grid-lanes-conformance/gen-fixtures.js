/**
 * Turns expected.json into a C++ header the replay harness compiles in.
 *
 * Codegen rather than a JSON parser at runtime: the replay binary links only
 * yogacore, so it stays buildable anywhere Yoga builds, with no dependency to
 * install and nothing to parse at startup.
 *
 * Usage: node gen-fixtures.js > fixtures.h
 *
 * @noflow
 * @format
 */

'use strict';

const path = require('node:path');
const expected = require(path.join(__dirname, 'expected.json'));

const out = [];
const w = s => out.push(s);

// Track sizing functions the Yoga API can express directly. Anything else
// makes the case unreplayable, and the harness must say so rather than
// silently skipping it.
function trackToCpp(t) {
  switch (t.t) {
    case 'px':
      return `{TrackKind::Points, ${f(t.v)}, {}, {}}`;
    case 'pct':
      return `{TrackKind::Percent, ${f(t.v)}, {}, {}}`;
    case 'fr':
      return `{TrackKind::Fr, ${f(t.v)}, {}, {}}`;
    case 'auto':
      return `{TrackKind::Auto, 0.0f, {}, {}}`;
    case 'max-content':
      return `{TrackKind::MaxContent, 0.0f, {}, {}}`;
    case 'fit-content':
      return `{TrackKind::FitContent, 0.0f, {}, {}}`;
    case 'minmax': {
      const min = simpleTrack(t.min);
      const max = simpleTrack(t.max);
      if (min == null || max == null) return null;
      return `{TrackKind::Minmax, 0.0f, ${min}, ${max}}`;
    }
    default:
      return null; // repeat(), min-content, max-content, fit-content()
  }
}

function simpleTrack(t) {
  switch (t.t) {
    case 'px':
      return `{TrackKind::Points, ${f(t.v)}}`;
    case 'pct':
      return `{TrackKind::Percent, ${f(t.v)}}`;
    case 'fr':
      return `{TrackKind::Fr, ${f(t.v)}}`;
    case 'auto':
      return `{TrackKind::Auto, 0.0f}`;
    case 'max-content':
      return `{TrackKind::MaxContent, 0.0f}`;
    default:
      return null;
  }
}

// C++ needs a decimal point before the `f` suffix: `120f` is an invalid
// integer literal, `120.0f` is a float.
const f = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.0f';
  return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}f`;
};
const optF = v => (v == null ? 'kUnset' : f(v));

const JUSTIFY = {
  start: 'YGJustifyStart',
  center: 'YGJustifyCenter',
  end: 'YGJustifyEnd',
  stretch: 'YGJustifyStretch',
  'space-between': 'YGJustifySpaceBetween',
  'space-around': 'YGJustifySpaceAround',
  'space-evenly': 'YGJustifySpaceEvenly',
};
const ALIGN = {
  start: 'YGAlignStart',
  center: 'YGAlignCenter',
  end: 'YGAlignEnd',
  stretch: 'YGAlignStretch',
  baseline: 'YGAlignBaseline',
  'space-between': 'YGAlignSpaceBetween',
  'space-around': 'YGAlignSpaceAround',
  'space-evenly': 'YGAlignSpaceEvenly',
};

// Why a case cannot be replayed through Yoga's API today. Recorded per case so
// the harness reports coverage honestly instead of quietly shrinking.
// Flattens a track list for the fixture: `repeat(<integer>, ...)` is a static
// expansion so it is done here, while `repeat(auto-fill|auto-fit, ...)` cannot
// be — its count depends on the container size — so the pattern is emitted
// once and described positionally for the engine to expand.
function flattenTracks(list) {
  const out = [];
  let autoRepeat = null;
  for (const t of list ?? []) {
    if (t.t !== 'repeat') {
      out.push(t);
      continue;
    }
    if (typeof t.n === 'number') {
      for (let i = 0; i < t.n; i++) out.push(...t.tracks);
      continue;
    }
    if (autoRepeat != null) return {tracks: null, autoRepeat: null}; // two auto-repeats: invalid
    autoRepeat = {
      type: t.n === 'auto-fit' ? 'YGGridAutoRepeatAutoFit' : 'YGGridAutoRepeatAutoFill',
      startIndex: out.length,
      trackCount: t.tracks.length,
    };
    out.push(...t.tracks);
  }
  return {tracks: out, autoRepeat};
}

function unsupportedReason(c) {
  const k = c.container;
  if (k.display !== 'grid') {
    return `display:${k.display}`;
  }
  if (k.direction != null && k.direction !== 'ltr') return 'direction:rtl';
  const fc = flattenTracks(k.cols);
  const fr_ = flattenTracks(k.rows);
  if (fc.tracks == null || fr_.tracks == null) return 'multiple auto-repeats';
  for (const t of [...fc.tracks, ...fr_.tracks]) {
    if (trackToCpp(t) == null) return `track ${t.t}`;
  }
  if (k.autoFlow != null &&
      !['row', 'row dense', 'column', 'column dense'].includes(k.autoFlow))
    return `grid-auto-flow:${k.autoFlow}`;
  if (k.justifyContent != null && JUSTIFY[k.justifyContent] == null)
    return `justify-content:${k.justifyContent}`;
  if (k.alignContent != null && ALIGN[k.alignContent] == null)
    return `align-content:${k.alignContent}`;
  if (k.alignItems != null && ALIGN[k.alignItems] == null)
    return `align-items:${k.alignItems}`;
  if (k.justifyItems != null && JUSTIFY[k.justifyItems] == null)
    return `justify-items:${k.justifyItems}`;
  for (const it of c.items) {
    if (it.order != null) return 'order';
    if (Array.isArray(it.col) || Array.isArray(it.row)) return 'two-line placement';
  }
  return null;
}

function placementToCpp(p) {
  if (p == null) return '{PlacementKind::Auto, 0}';
  if (typeof p === 'number') return `{PlacementKind::Line, ${p}}`;
  if (typeof p === 'object' && p.span != null)
    return `{PlacementKind::Span, ${p.span}}`;
  return '{PlacementKind::Auto, 0}';
}

w('// @generated by grid-lanes-conformance/gen-fixtures.js — do not edit.');
w('//');
w('// Expected geometry measured in real Safari; see oracle.js.');
w('#pragma once');
w('#include <cstddef>');
w('#include <yoga/YGNodeStyle.h>');
w('');
w('namespace gridconf {');
w('');
w('constexpr float kUnset = -1e9f;');
w('');
w('enum class TrackKind { Points, Percent, Fr, Auto, Minmax, MaxContent, FitContent };');
w('enum class PlacementKind { Auto, Line, Span };');
w('');
w('struct SimpleTrack { TrackKind kind; float value; };');
w('struct Track { TrackKind kind; float value; SimpleTrack min; SimpleTrack max; };');
w('struct Placement { PlacementKind kind; int value; };');
w('struct Rect { float x, y, w, h; };');
w('');
w('struct Item {');
w('  float width, height;   // kUnset when the case leaves it auto');
w('  float margin, padding, border;');
w('  float widthPercent;  // kUnset when absent');
w('  float aspectRatio;   // kUnset when absent');
w('  Placement col, row;');
w('  int justifySelf;       // -1 when unset');
w('  Rect expected;');
w('};');
w('');
w('struct Case {');
w('  const char* id;');
w('  const char* group;');
w('  const char* note;');
w('  const char* tier;');
w('  const char* unsupported;  // nullptr when replayable');
w('  float width, height;');
w('  float gap, rowGap, colGap;');
w('  float padding, border;');
w('  int autoFlow;  // the YGGridAutoFlow enum value');
w('  float minWidth, maxWidth, minHeight, maxHeight;  // kUnset when absent');
w('  float gapPercent;  // kUnset when absent');
w('  const Track* autoRows; size_t autoRowCount;');
w('  const Track* cols; size_t colCount;');
w('  const Track* rows; size_t rowCount;');
w('  int justifyItems, alignItems, justifyContent, alignContent;  // -1 unset');
w('  // repeat(auto-fill|auto-fit, ...): 0 = none, else the C API enum value');
w('  int colAutoRepeatType; size_t colAutoRepeatStart, colAutoRepeatCount;');
w('  int rowAutoRepeatType; size_t rowAutoRepeatStart, rowAutoRepeatCount;');
w('  const Item* items; size_t itemCount;');
w('  float expectedWidth, expectedHeight;');
w('};');
w('');

const caseVars = [];
expected.cases.forEach((c, idx) => {
  const k = c.container;
  const reason = unsupportedReason(c);
  const flatCols = flattenTracks(k.cols);
  const flatRows = flattenTracks(k.rows);
  const cols = (flatCols.tracks ?? []).map(trackToCpp);
  const rows = (flatRows.tracks ?? []).map(trackToCpp);
  const colsOk = cols.every(x => x != null);
  const rowsOk = rows.every(x => x != null);

  if (colsOk && cols.length) {
    w(`static const Track kCols${idx}[] = {${cols.join(', ')}};`);
  }
  if (rowsOk && rows.length) {
    w(`static const Track kRows${idx}[] = {${rows.join(', ')}};`);
  }
  const autoRows = (flattenTracks(k.autoRows).tracks ?? []).map(trackToCpp);
  const autoRowsOk = autoRows.every(x => x != null);
  if (autoRowsOk && autoRows.length) {
    w(`static const Track kAutoRows${idx}[] = {${autoRows.join(', ')}};`);
  }

  const items = c.items.map((it, i) => {
    const e = c.expected.items[i] ?? {x: 0, y: 0, w: 0, h: 0};
    const js = it.justifySelf != null ? JUSTIFY[it.justifySelf] : null;
    return (
      `  {${optF(it.w)}, ${optF(it.h)}, ${f(it.m ?? 0)}, ${f(it.p ?? 0)}, ` +
      `${f(it.b ?? 0)}, ${optF(it.widthPercent)}, ${optF(it.aspectRatio)}, ` +
      `${placementToCpp(it.col)}, ${placementToCpp(it.row)}, ` +
      `${js ?? -1}, {${f(e.x)}, ${f(e.y)}, ${f(e.w)}, ${f(e.h)}}}`
    );
  });
  if (items.length) {
    w(`static const Item kItems${idx}[] = {`);
    w(items.join(',\n'));
    w('};');
  }

  const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  caseVars.push(
    `  {"${c.id}", "${c.group}", "${esc(c.note)}", "${c.tier}", ` +
      `${reason ? `"${esc(reason)}"` : 'nullptr'}, ` +
      `${optF(k.width)}, ${optF(k.height)}, ` +
      `${optF(k.gap)}, ${optF(k.rowGap)}, ${optF(k.colGap)}, ` +
      `${f(k.padding ?? 0)}, ${f(k.border ?? 0)}, ` +
      `${{'row': 0, 'row dense': 1, 'column': 2, 'column dense': 3}[k.autoFlow ?? 'row'] ?? 0}, ` +
      `${optF(k.minWidth)}, ${optF(k.maxWidth)}, ${optF(k.minHeight)}, ${optF(k.maxHeight)}, ` +
      `${k.gapPercent ? f(parseFloat(k.gapPercent)) : 'kUnset'}, ` +
      `${autoRowsOk && autoRows.length ? `kAutoRows${idx}` : 'nullptr'}, ${autoRowsOk ? autoRows.length : 0}, ` +
      `${colsOk && cols.length ? `kCols${idx}` : 'nullptr'}, ${colsOk ? cols.length : 0}, ` +
      `${rowsOk && rows.length ? `kRows${idx}` : 'nullptr'}, ${rowsOk ? rows.length : 0}, ` +
      `${k.justifyItems ? (JUSTIFY[k.justifyItems] ?? -1) : -1}, ` +
      `${k.alignItems ? (ALIGN[k.alignItems] ?? -1) : -1}, ` +
      `${k.justifyContent ? (JUSTIFY[k.justifyContent] ?? -1) : -1}, ` +
      `${k.alignContent ? (ALIGN[k.alignContent] ?? -1) : -1}, ` +
      `${flatCols.autoRepeat ? flatCols.autoRepeat.type : 0}, ` +
      `${flatCols.autoRepeat ? flatCols.autoRepeat.startIndex : 0}, ` +
      `${flatCols.autoRepeat ? flatCols.autoRepeat.trackCount : 0}, ` +
      `${flatRows.autoRepeat ? flatRows.autoRepeat.type : 0}, ` +
      `${flatRows.autoRepeat ? flatRows.autoRepeat.startIndex : 0}, ` +
      `${flatRows.autoRepeat ? flatRows.autoRepeat.trackCount : 0}, ` +
      `${items.length ? `kItems${idx}` : 'nullptr'}, ${items.length}, ` +
      `${f(c.expected.container.w)}, ${f(c.expected.container.h)}}`,
  );
});

w('');
w('static const Case kCases[] = {');
w(caseVars.join(',\n'));
w('};');
w(`static const size_t kCaseCount = ${expected.cases.length};`);
w('');
w('} // namespace gridconf');

process.stdout.write(out.join('\n') + '\n');
