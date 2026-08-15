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
  if (c.justifyItems) d.push(`justify-items: ${c.justifyItems}`);
  if (c.alignItems) d.push(`align-items: ${c.alignItems}`);
  if (c.justifyContent) d.push(`justify-content: ${c.justifyContent}`);
  if (c.alignContent) d.push(`align-content: ${c.alignContent}`);
  if (c.padding) d.push(`padding: ${c.padding}px`);
  if (c.border) d.push(`border: ${c.border}px solid #0000`);
  if (c.fontSize) d.push(`font-size: ${c.fontSize}px`);
  if (c.direction) d.push(`direction: ${c.direction}`);
  return d.join('; ');
}

function itemCss(it) {
  const d = [];
  if (it.w != null) d.push(`width: ${it.w}px`);
  if (it.h != null) d.push(`height: ${it.h}px`);
  if (it.m != null) d.push(`margin: ${it.m}px`);
  if (it.p != null) d.push(`padding: ${it.p}px`);
  if (it.b != null) d.push(`border: ${it.b}px solid #0000`);
  if (it.order != null) d.push(`order: ${it.order}`);
  if (it.justifySelf) d.push(`justify-self: ${it.justifySelf}`);
  if (it.alignSelf) d.push(`align-self: ${it.alignSelf}`);
  if (it.col != null) d.push(`grid-column: ${placementToCss(it.col)}`);
  if (it.row != null) d.push(`grid-row: ${placementToCss(it.row)}`);
  return d.join('; ');
}

function placementToCss(p) {
  if (typeof p === 'number') return String(p);
  if (typeof p === 'object' && p.span != null) return `span ${p.span}`;
  if (Array.isArray(p)) return `${p[0]} / ${p[1]}`;
  return String(p);
}


module.exports = {trackToCss, toleranceToCss, containerCss, itemCss, placementToCss};
