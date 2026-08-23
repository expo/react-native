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
 * Renders the shared demo documents (the modules the RNTester screens import)
 * to HTML pages with no translator: lowercase intrinsic tags and CSS-spelled
 * style keys mean the same thing to the browser as to the fork's catalog.
 * Screens not yet converted go through extract-demo-html.js.
 *
 * No react-dom: the documents are static trees, so a React element walks
 * straight to markup. Function components are called, string tags emit, and
 * styles convert camelCase to kebab-case with React DOM's px rules.
 */

require('@babel/register')({
  extensions: ['.js'],
  // The docs live under packages/rn-tester; babel-register ignores
  // node_modules by default
  ignore: [/node_modules/],
  presets: [
    [
      require('@react-native/babel-preset'),
      {enableBabelRuntime: false, disableImportExportTransform: false},
    ],
  ],
});

const React = require('react');

/* Void elements per the HTML standard: no closing tag, no children */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/*
 * Props that are unitless numbers in CSS; everything else numeric gets `px`,
 * as React DOM serialises styles. `lineHeight` is not here: RN's numeric
 * lineHeight is pixels, so the browser gets px too.
 */
const UNITLESS = new Set([
  'opacity',
  'zIndex',
  'fontWeight',
  'flex',
  'flexGrow',
  'flexShrink',
  'order',
  'zoom',
]);

function cssName(key) {
  return key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

function cssValue(key, value) {
  if (typeof value === 'number' && value !== 0 && !UNITLESS.has(key)) {
    return `${value}px`;
  }
  return String(value);
}

function styleText(style) {
  if (style == null) {
    return '';
  }
  if (Array.isArray(style)) {
    // RN-style array merge, later entries win; flattened so the emitted CSS
    // has one declaration per property
    const merged = Object.assign({}, ...style.filter(Boolean));
    return styleText(merged);
  }
  return Object.entries(style)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${cssName(k)}: ${cssValue(k, v)}`)
    .join('; ');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* JSX prop → HTML attribute, for the handful the documents use */
const ATTRIBUTE_NAME = {
  className: 'class',
  htmlFor: 'for',
  srcSet: 'srcset',
  defaultChecked: 'checked',
  defaultValue: 'value',
  readOnly: 'readonly',
};

function attributes(props) {
  let out = '';
  for (const [key, value] of Object.entries(props)) {
    if (
      key === 'children' ||
      key === 'style' ||
      key === 'key' ||
      key === 'ref'
    ) {
      continue;
    }
    if (typeof value === 'function' || value == null) {
      continue;
    }
    const name = ATTRIBUTE_NAME[key] ?? key.toLowerCase();
    if (value === true) {
      out += ` ${name}`;
    } else if (value !== false) {
      out += ` ${name}="${esc(value)}"`;
    }
  }
  const css = styleText(props.style);
  if (css) {
    out += ` style="${esc(css)}"`;
  }
  return out;
}

function renderNode(node) {
  if (node == null || node === false || node === true) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return esc(node);
  }
  if (Array.isArray(node)) {
    return node.map(renderNode).join('');
  }
  const {type, props} = node;
  if (type === React.Fragment) {
    return renderNode(props.children);
  }
  if (typeof type === 'function') {
    // A document component is pure, so calling it is rendering it
    return renderNode(type(props));
  }
  if (typeof type !== 'string') {
    throw new Error(`render-docs: unsupported element type ${String(type)}`);
  }
  const attrs = attributes(props ?? {});
  if (VOID.has(type)) {
    return `<${type}${attrs}>`;
  }
  return `<${type}${attrs}>${renderNode(props?.children)}</${type}>`;
}

/**
 * The page frame shared with the device columns: 402px content, the grouped
 * background, the system font stack at the web's 16px root. The root font
 * size difference (17pt iOS, 16sp Android) is a documented deviation and stays
 * visible.
 */
function page(bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=402, initial-scale=1">
<style>
  html { font-family: -apple-system, system-ui, sans-serif; }
  body { margin: 0; background: #f2f2f7; width: 402px; box-sizing: border-box; padding: 12px; }
</style></head>
<body>${bodyHtml}</body></html>`;
}

function renderDocumentToPage(element) {
  return page(renderNode(element));
}

module.exports = {renderDocumentToPage, renderNode, styleText};
