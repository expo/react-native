/**
 * CSS serialization for the conformance cases.
 *
 * Shared by oracle.js (which renders these in Safari) and gen-fantom-test.js
 * (which renders them in React Native), so the two cannot drift in what a
 * case means.
 *
 * @noflow
 * @format
 */

'use strict';

function trackToCss(t) {
  switch (t.t) {
    case 'px':
      return `${t.v}px`;
    case 'pct':
      return `${t.v}%`;
    case 'fr':
      return `${t.v}fr`;
    case 'auto':
      return 'auto';
    case 'min-content':
      return 'min-content';
    case 'max-content':
      return 'max-content';
    case 'fit-content':
      return `fit-content(${trackToCss(t.v)})`;
    case 'minmax':
      return `minmax(${trackToCss(t.min)}, ${trackToCss(t.max)})`;
    case 'repeat':
      return `repeat(${t.n}, ${t.tracks.map(trackToCss).join(' ')})`;
    default:
      throw new Error(`unknown track type ${t.t}`);
  }
}

function toleranceToCss(v) {
  if (v === 'normal' || v === 'infinite') {
    return v;
  }
  return typeof v === 'number' ? `${v}px` : String(v);
}

function containerCss(c) {
  const d = [];
  d.push(`display: ${c.display}`);
  if (c.width != null) d.push(`width: ${c.width}px`);
  if (c.height != null) d.push(`height: ${c.height}px`);
  if (c.cols) d.push(`grid-template-columns: ${c.cols.map(trackToCss).join(' ')}`);
  if (c.rows) d.push(`grid-template-rows: ${c.rows.map(trackToCss).join(' ')}`);
  if (c.gap != null) d.push(`gap: ${c.gap}px`);
  if (c.rowGap != null) d.push(`row-gap: ${c.rowGap}px`);
  if (c.colGap != null) d.push(`column-gap: ${c.colGap}px`);
  if (c.flowTolerance != null)
    d.push(`flow-tolerance: ${toleranceToCss(c.flowTolerance)}`);
  if (c.autoFlow) d.push(`grid-auto-flow: ${c.autoFlow}`);
  if (c.areas)
    d.push(`grid-template-areas: ${c.areas.map(r => `"${r}"`).join(' ')}`);
  if (c.justifyItems) d.push(`justify-items: ${c.justifyItems}`);
  if (c.alignItems) d.push(`align-items: ${c.alignItems}`);
  if (c.justifyContent) d.push(`justify-content: ${c.justifyContent}`);
  if (c.alignContent) d.push(`align-content: ${c.alignContent}`);
  if (c.padding) d.push(`padding: ${c.padding}px`);
  if (c.border) d.push(`border: ${c.border}px solid #0000`);
  if (c.fontSize) d.push(`font-size: ${c.fontSize}px`);
  if (c.direction) d.push(`direction: ${c.direction}`);
  if (c.gapPercent) d.push(`gap: ${c.gapPercent}`);
  if (c.minWidth != null) d.push(`min-width: ${c.minWidth}px`);
  if (c.maxWidth != null) d.push(`max-width: ${c.maxWidth}px`);
  if (c.minHeight != null) d.push(`min-height: ${c.minHeight}px`);
  if (c.maxHeight != null) d.push(`max-height: ${c.maxHeight}px`);
  if (c.autoRows) d.push(`grid-auto-rows: ${c.autoRows.map(trackToCss).join(' ')}`);
  if (c.autoColumns)
    d.push(`grid-auto-columns: ${c.autoColumns.map(trackToCss).join(' ')}`);
  return d.join('; ');
}

function itemCss(it) {
  const d = [];
  if (it.w != null) d.push(`width: ${it.w}px`);
  if (it.widthPercent != null) d.push(`width: ${it.widthPercent}%`);
  if (it.aspectRatio != null) d.push(`aspect-ratio: ${it.aspectRatio}`);
  if (it.h != null) d.push(`height: ${it.h}px`);
  if (it.m != null) d.push(`margin: ${it.m}px`);
  if (it.p != null) d.push(`padding: ${it.p}px`);
  if (it.b != null) d.push(`border: ${it.b}px solid #0000`);
  if (it.order != null) d.push(`order: ${it.order}`);
  if (it.justifySelf) d.push(`justify-self: ${it.justifySelf}`);
  if (it.alignSelf) d.push(`align-self: ${it.alignSelf}`);
  if (it.area != null) d.push(`grid-area: ${it.area}`);
  if (it.colEnd != null) {
    // Longhands, deliberately: the `grid-column` shorthand resets the END to
    // auto, so emitting it after a `grid-column-end` silently drops the span
    // and the case stops testing what it says it tests.
    d.push(`grid-column-start: ${placementToCss(it.col)}`);
    d.push(`grid-column-end: ${it.colEnd}`);
  } else if (it.col != null) {
    d.push(`grid-column: ${placementToCss(it.col)}`);
  }
  if (it.row != null) {
    // A numeric row is written as the longhand for the same reason as the
    // column above: it must not reset an end that another declaration set.
    d.push(
      typeof it.row === 'number'
        ? `grid-row-start: ${it.row}`
        : `grid-row: ${placementToCss(it.row)}`,
    );
  }
  return d.join('; ');
}

function placementToCss(p) {
  if (typeof p === 'number') return String(p);
  if (typeof p === 'object' && p.span != null) return `span ${p.span}`;
  if (Array.isArray(p)) return `${p[0]} / ${p[1]}`;
  return String(p);
}


module.exports = {trackToCss, toleranceToCss, containerCss, itemCss, placementToCss};
