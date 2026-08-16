/**
 * Turns a case from `cases.js` into HTML for the Safari oracle, and into the
 * plain-data tree the RNTester screen renders.
 *
 * The style vocabulary is React Native's — camelCase keys, bare numbers meaning
 * points — because that is what the native side has to consume. This file is
 * the only place that knows how to say the same thing in CSS.
 *
 * @noflow
 * @format
 */

'use strict';

const {W, FS} = require('./cases.js');

// Properties whose bare number is NOT a length.
const UNITLESS = new Set(['flexGrow', 'flexShrink', 'opacity', 'zIndex', 'fontWeight']);

function kebab(key) {
  return key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

function cssValue(key, value) {
  if (typeof value === 'number' && !UNITLESS.has(key)) {
    return `${value}px`;
  }
  return String(value);
}

/**
 * React Native writes border sides as `borderLeftWidth` and takes one
 * `borderColor` / `borderStyle` for all of them; CSS wants the side in the
 * longhand. Without this an authored `borderLeftWidth: 4` would render in
 * Safari as a border with no style, which computes to zero width — the case
 * would quietly measure nothing.
 */
function styleToCss(style) {
  if (style == null) {
    return '';
  }
  const out = [];
  const color = style.borderColor;
  const lineStyle = style.borderStyle ?? (hasAnyBorderWidth(style) ? 'solid' : null);
  for (const key of Object.keys(style)) {
    if (key === 'borderColor' || key === 'borderStyle') {
      continue;
    }
    if (/^border(Left|Right|Top|Bottom)Width$/.test(key)) {
      // `Left` -> `left`; kebab() would make it `-left` and produce
      // `border--left-width`, which every browser silently drops.
      const side = key.replace('border', '').replace('Width', '').toLowerCase();
      out.push(`border-${side}-width:${cssValue(key, style[key])}`);
      out.push(`border-${side}-style:${lineStyle ?? 'solid'}`);
      if (color != null) {
        out.push(`border-${side}-color:${color}`);
      }
      continue;
    }
    if (key === 'borderWidth') {
      out.push(`border-width:${cssValue(key, style[key])}`);
      out.push(`border-style:${lineStyle ?? 'solid'}`);
      if (color != null) {
        out.push(`border-color:${color}`);
      }
      continue;
    }
    out.push(`${kebab(key)}:${cssValue(key, style[key])}`);
  }
  return out.join(';');
}

function hasAnyBorderWidth(style) {
  return Object.keys(style).some(k => /^border(Left|Right|Top|Bottom)?Width$/.test(k));
}

function escapeText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function nodeToHtml(node) {
  if (typeof node === 'string') {
    return escapeText(node);
  }
  const attrs = [];
  if (node.id != null) {
    attrs.push(`data-probe="${escapeAttribute(node.id)}"`);
  }
  const css = styleToCss(node.style);
  if (css !== '') {
    attrs.push(`style="${escapeAttribute(css)}"`);
  }
  const children = (node.children ?? []).map(nodeToHtml).join('');
  const open = [node.tag, ...attrs].join(' ');
  return `<${open}>${children}</${node.tag}>`;
}

function caseToHtml(c, index) {
  const containerCss = styleToCss({width: W, ...c.container});
  const children = (c.children ?? []).map(nodeToHtml).join('');
  return (
    `<section class="case" data-index="${index}" data-name="${escapeAttribute(c.name)}">` +
    `<div class="container" style="${escapeAttribute(containerCss)}">${children}</div>` +
    `</section>`
  );
}

/**
 * The reset exists so the two sides start from the same place. React Native
 * has no UA margins, its box model is border-box, and its `<View>` is a
 * column flex container; the page has to say all of that out loud or every
 * case would differ for reasons that have nothing to do with the case.
 *
 * `<b>`/`<i>` keep their UA weight and slant, because the native side has the
 * same user-agent styles for those tags.
 */
const PAGE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; border: 0 solid transparent; }
  html, body { font-family: system-ui, -apple-system, sans-serif; font-size: ${FS}px; line-height: normal; }
  body { padding: 8px; }
  .case { margin-bottom: 12px; }
  .case > .container { outline: 1px dashed #cbd5e1; }
  /* A div is block; a span is inline. Everything else a case wants, it says. */
  div { display: block; }
  span, b, i, u, strong, em { display: inline; }
`;

/**
 * The measurement script the oracle and the web mirror both run. Rects come
 * back relative to the case container's border box, which is the only frame
 * all three engines can agree on — page coordinates would encode the
 * surrounding chrome, which is different everywhere.
 */
const MEASURE_JS = `
window.__measure = function (start, end) {
  var sections = document.querySelectorAll('section.case');
  var results = {};
  for (var i = start; i < Math.min(end, sections.length); i++) {
    var section = sections[i];
    var container = section.querySelector('.container');
    var base = container.getBoundingClientRect();
    var probes = {};
    var nodes = container.querySelectorAll('[data-probe]');
    for (var j = 0; j < nodes.length; j++) {
      var r = nodes[j].getBoundingClientRect();
      probes[nodes[j].getAttribute('data-probe')] = {
        x: r.left - base.left,
        y: r.top - base.top,
        w: r.width,
        h: r.height,
      };
    }
    results[section.getAttribute('data-name')] = {
      container: {x: 0, y: 0, w: base.width, h: base.height},
      probes: probes,
    };
  }
  return {total: sections.length, results: results};
};
`;

function buildPage(cases) {
  const sections = cases.map((c, i) => caseToHtml(c, i)).join('\n');
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<title>text conformance</title><style>${PAGE_CSS}</style></head><body>` +
    sections +
    `<script>${MEASURE_JS}</script></body></html>`
  );
}

module.exports = {styleToCss, caseToHtml, buildPage, PAGE_CSS, MEASURE_JS};
