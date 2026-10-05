/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * Parses a stylesheet (css-syntax-3) into rules for the matcher in `match.js`.
 * Tolerant as the spec demands: an unparseable declaration is dropped, a
 * selector the matcher cannot honor is kept but never matches, and an unknown
 * at-rule is skipped whole. Nothing throws on author input.
 */

export type AttributeMatcher = {
  name: string,
  // null for presence ([disabled]); otherwise one of = ^= $= *= ~= |=
  op: string | null,
  value: string | null,
};

// Everything a single element must satisfy
export type Compound = {
  // Lowercased; null when absent or '*'
  tag: string | null,
  classes: Array<string>,
  attributes: Array<AttributeMatcher>,
  // Members of SUPPORTED_PSEUDO_CLASSES
  pseudoClasses: Array<string>,
};

export type ComplexSelector = {
  // As authored, for consumers that recognize whole patterns the matcher
  // cannot express
  raw: string,
  // Document order, the subject last. Each combinator connects its compound
  // to the next one; the subject's is null.
  parts: Array<{compound: Compound, combinator: ' ' | '>' | null}>,
  specificity: number, // (a << 20) | (b << 10) | c, comparable as one int
  // Uses syntax the matcher cannot honor (sibling combinators, unknown
  // pseudos, pseudo-elements); never matches
  unsupported: boolean,
};

export type StyleRule = {
  type: 'style',
  selectors: Array<ComplexSelector>,
  // As authored, kebab-case property → value string; the consumer camel-cases
  // and resolves values
  declarations: {[string]: string},
  // The condition of every enclosing @media block, outermost first
  media: Array<string>,
  // Enclosing @layer names joined with '.'; null when unlayered
  layer: string | null,
  // Source order across every sheet, from the caller's running counter
  order: number,
};

export type KeyframesRule = {
  type: 'keyframes',
  name: string,
  // Sorted by offset, 0..1
  stops: Array<{offset: number, declarations: {[string]: string}}>,
};

export type Stylesheet = {
  rules: Array<StyleRule>,
  keyframes: Array<KeyframesRule>,
  // Every @layer name in first-seen order, statement and block forms alike
  layerOrder: Array<string>,
};

function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      if (close === -1) {
        break; // unterminated comment swallows the rest, per spec
      }
      out += ' ';
      i = close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = scanString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Returns the index after the closing quote, or the end of input when
// unterminated
function scanString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Finds needle outside strings, parens, brackets and braces; -1 when absent
function indexOfTopLevel(text: string, needle: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = scanString(text, i) - 1;
      continue;
    }
    // Test the needle before tracking depth so a search for `{` finds the
    // opener instead of descending into it
    if (depth === 0 && ch === needle) {
      return i;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    }
  }
  return -1;
}

function splitTopLevel(text: string, separator: string): Array<string> {
  const parts = [];
  let start = 0;
  let idx = indexOfTopLevel(text, separator, start);
  while (idx !== -1) {
    parts.push(text.slice(start, idx));
    start = idx + 1;
    idx = indexOfTopLevel(text, separator, start);
  }
  parts.push(text.slice(start));
  return parts;
}

// Returns the body between the brace at open and its match, and the index
// after the closing brace
function scanBlock(css: string, open: number): [string, number] {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = scanString(css, i) - 1;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return [css.slice(open + 1, i), i + 1];
      }
    }
  }
  return [css.slice(open + 1), css.length];
}

// CSS escapes: `\:` → `:`, and the hex form `\2f ` → `/`
export function unescapeIdent(ident: string): string {
  let out = '';
  let i = 0;
  while (i < ident.length) {
    if (ident[i] !== '\\') {
      out += ident[i];
      i++;
      continue;
    }
    const next = ident[i + 1];
    if (next == null) {
      break;
    }
    if (/[0-9a-fA-F]/.test(next)) {
      // Up to six hex digits, optionally followed by one whitespace
      let j = i + 1;
      while (j < ident.length && j < i + 7 && /[0-9a-fA-F]/.test(ident[j])) {
        j++;
      }
      out += String.fromCodePoint(parseInt(ident.slice(i + 1, j), 16));
      if (ident[j] === ' ') {
        j++;
      }
      i = j;
    } else {
      out += next;
      i += 2;
    }
  }
  return out;
}

const SUPPORTED_PSEUDO_CLASSES = new Set([
  'hover',
  'active',
  'focus',
  'focus-visible',
  'disabled',
  'root',
]);

// True by construction in this runtime, so dropping them keeps the rule
// matchable instead of discarding styles that do apply
const ALWAYS_TRUE_PSEUDO_CLASSES = new Set(['enabled', 'link', 'any-link']);

function scanSelectorIdent(sel: string, i: number): [string, number] {
  let j = i;
  while (j < sel.length) {
    const ch = sel[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (/[A-Za-z0-9_-]/.test(ch)) {
      j++;
      continue;
    }
    break;
  }
  return [sel.slice(i, j), j];
}

type CompoundResult = {
  compound: Compound,
  a: number,
  b: number,
  c: number,
  unsupported: boolean,
  // `:is(.dark *)` on the subject, Tailwind's class-strategy dark variant;
  // the caller compiles it to a `.dark` ancestor part
  trailingDarkAncestor: boolean,
};

function parseCompound(raw: string): CompoundResult {
  const compound: Compound = {
    tag: null,
    classes: [],
    attributes: [],
    pseudoClasses: [],
  };
  let a = 0;
  let b = 0;
  let c = 0;
  let unsupported = false;
  let trailingDarkAncestor = false;

  let i = 0;
  const sel = raw;
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === '*') {
      i++;
      continue;
    }
    if (ch === '.') {
      const [ident, next] = scanSelectorIdent(sel, i + 1);
      compound.classes.push(unescapeIdent(ident));
      b++;
      i = next;
      continue;
    }
    if (ch === '#') {
      // An attribute match on `id` that counts as an id for specificity
      // (selectors-4 §17)
      const [ident, next] = scanSelectorIdent(sel, i + 1);
      compound.attributes.push({
        name: 'id',
        op: '=',
        value: unescapeIdent(ident),
      });
      a++;
      i = next;
      continue;
    }
    if (ch === '[') {
      const close = indexOfTopLevel(sel, ']', i + 1);
      const inner = sel.slice(i + 1, close === -1 ? sel.length : close);
      compound.attributes.push(parseAttributeMatcher(inner));
      b++;
      i = close === -1 ? sel.length : close + 1;
      continue;
    }
    if (ch === ':') {
      if (sel[i + 1] === ':') {
        // Pseudo-elements generate boxes this runtime does not, so the whole
        // selector can never match
        unsupported = true;
        const [, next] = scanSelectorIdent(sel, i + 2);
        i = next;
        if (sel[i] === '(') {
          const [, after] = scanParens(sel, i);
          i = after;
        }
        continue;
      }
      const [name, next] = scanSelectorIdent(sel, i + 1);
      i = next;
      let args = null;
      if (sel[i] === '(') {
        const [inner, after] = scanParens(sel, i);
        args = inner;
        i = after;
      }
      const pseudo = name.toLowerCase();
      if (args == null) {
        if (SUPPORTED_PSEUDO_CLASSES.has(pseudo)) {
          compound.pseudoClasses.push(pseudo);
          b++;
        } else if (ALWAYS_TRUE_PSEUDO_CLASSES.has(pseudo)) {
          b++;
        } else {
          unsupported = true;
        }
        continue;
      }
      if (pseudo === 'is' || pseudo === 'where') {
        if (args.trim() === '.dark *') {
          trailingDarkAncestor = true;
          if (pseudo === 'is') {
            b++; // :is() takes its most specific argument: a class
          }
          continue;
        }
        // General :is()/:where() would need alternation in the matcher
        unsupported = true;
        continue;
      }
      if (pseudo === 'not') {
        // :not() is out of scope, even over supported simple selectors
        unsupported = true;
        continue;
      }
      unsupported = true;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const [ident, next] = scanSelectorIdent(sel, i);
      compound.tag = unescapeIdent(ident).toLowerCase();
      c++;
      i = next;
      continue;
    }
    // Anything unrecognized poisons the compound rather than mis-matching
    unsupported = true;
    i++;
  }

  return {compound, a, b, c, unsupported, trailingDarkAncestor};
}

function scanParens(sel: string, open: number): [string, number] {
  let depth = 0;
  for (let i = open; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return [sel.slice(open + 1, i), i + 1];
      }
    }
  }
  return [sel.slice(open + 1), sel.length];
}

function parseAttributeMatcher(inner: string): AttributeMatcher {
  const m = inner.match(/^\s*([^\s=^$*~|\]]+)\s*(?:([\^$*~|]?=)\s*(.*?)\s*)?$/);
  if (m == null) {
    return {name: inner.trim(), op: null, value: null};
  }
  const name = unescapeIdent(m[1]);
  if (m[2] == null) {
    return {name, op: null, value: null};
  }
  let value = m[3] ?? '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return {name, op: m[2], value};
}

// One complex selector, no commas
export function compileSelector(raw: string): ComplexSelector {
  // Tokenize at the top level only: the space in `:is(.dark *)` is not a
  // combinator
  const text = raw.trim();
  const tokens: Array<{compoundText: string, combinatorBefore: string | null}> =
    [];
  {
    let depth = 0;
    let current = '';
    let pending: string | null = null;
    const flush = (nextPending: string | null) => {
      if (current !== '') {
        tokens.push({compoundText: current, combinatorBefore: pending});
        current = '';
        pending = nextPending;
      } else if (
        nextPending != null &&
        (pending == null || nextPending !== ' ')
      ) {
        // In `a > b` the first space sets a descendant pending and the `>`
        // upgrades it; the space after `>` must not downgrade it back
        pending = nextPending;
      }
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') {
        current += ch + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      }
      if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n')) {
        flush(' ');
        continue;
      }
      if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) {
        flush(ch);
        continue;
      }
      current += ch;
    }
    flush(null);
  }

  const parts: Array<{compound: Compound, combinator: ' ' | '>' | null}> = [];
  let A = 0;
  let B = 0;
  let C = 0;
  let unsupported = false;

  for (let i = 0; i < tokens.length; i++) {
    const part = tokens[i].compoundText;
    let combinatorBefore: ' ' | '>' | null = null;
    if (i > 0) {
      const marker = tokens[i].combinatorBefore;
      if (marker === '>') {
        combinatorBefore = '>';
      } else if (marker === '+' || marker === '~') {
        // Sibling combinators need sibling knowledge the element context
        // does not carry, so the selector is kept but never matches
        combinatorBefore = ' ';
        unsupported = true;
      } else {
        combinatorBefore = ' ';
      }
    }
    const result = parseCompound(part);
    A += result.a;
    B += result.b;
    C += result.c;
    unsupported = unsupported || result.unsupported;
    if (result.trailingDarkAncestor) {
      // `:is(.dark *)` becomes an explicit `.dark` ancestor part before this
      // compound
      const darkAncestor: Compound = {
        tag: null,
        classes: ['dark'],
        attributes: [],
        pseudoClasses: [],
      };
      parts.push({compound: darkAncestor, combinator: null});
      if (parts.length >= 2) {
        parts[parts.length - 2].combinator = combinatorBefore ?? null;
      }
      combinatorBefore = ' ';
    }
    parts.push({compound: result.compound, combinator: null});
    if (parts.length >= 2) {
      parts[parts.length - 2].combinator = combinatorBefore;
    }
  }

  return {
    raw,
    parts,
    // eslint-disable-next-line no-bitwise
    specificity: (A << 20) | (B << 10) | C,
    unsupported: unsupported || parts.length === 0,
  };
}

function parseDeclarations(body: string): {[string]: string} {
  const out: {[string]: string} = {};
  for (const chunk of splitTopLevel(body, ';')) {
    const colon = indexOfTopLevel(chunk, ':', 0);
    if (colon === -1) {
      continue;
    }
    const property = chunk.slice(0, colon).trim().toLowerCase();
    let value = chunk.slice(colon + 1).trim();
    if (property === '' || value === '') {
      continue;
    }
    // `!important` carries no extra weight; strip it so the value stays clean
    value = value.replace(/\s*!important\s*$/i, '');
    out[property] = value;
  }
  return out;
}

type ParseContext = {
  media: Array<string>,
  layer: string | null,
  sheet: Stylesheet,
  counter: {order: number},
};

// startOrder threads a source-order counter across sheets so a later sheet
// wins ties, like two <link> tags
export function parseStylesheet(
  css: string,
  startOrder: number = 0,
): Stylesheet {
  const sheet: Stylesheet = {rules: [], keyframes: [], layerOrder: []};
  parseBlockContents(stripComments(css), {
    media: [],
    layer: null,
    sheet,
    counter: {order: startOrder},
  });
  return sheet;
}

function parseBlockContents(css: string, ctx: ParseContext): void {
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) {
      i++;
    }
    if (i >= css.length) {
      break;
    }
    if (css[i] === '@') {
      i = parseAtRule(css, i, ctx);
      continue;
    }
    const open = indexOfTopLevel(css, '{', i);
    if (open === -1) {
      break;
    }
    const selectorList = css.slice(i, open);
    const [body, after] = scanBlock(css, open);
    const selectors = splitTopLevel(selectorList, ',')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(compileSelector);
    const declarations = parseDeclarations(body);
    if (selectors.length > 0 && Object.keys(declarations).length > 0) {
      ctx.sheet.rules.push({
        type: 'style',
        selectors,
        declarations,
        media: ctx.media.slice(),
        layer: ctx.layer,
        order: ctx.counter.order++,
      });
    }
    i = after;
  }
}

function parseAtRule(css: string, at: number, ctx: ParseContext): number {
  const open = indexOfTopLevel(css, '{', at);
  const semi = indexOfTopLevel(css, ';', at);

  // Statement form: `@import …;`, `@layer a, b;`, `@charset …;`
  if (semi !== -1 && (open === -1 || semi < open)) {
    const statement = css.slice(at, semi).trim();
    if (statement.startsWith('@layer')) {
      for (const name of statement.slice('@layer'.length).split(',')) {
        registerLayer(ctx.sheet, qualifyLayer(ctx.layer, name.trim()));
      }
    }
    // @import is out of scope since the build feeds whole sheets; other
    // statements are no-ops
    return semi + 1;
  }
  if (open === -1) {
    return css.length;
  }

  const prelude = css.slice(at, open).trim();
  const [body, after] = scanBlock(css, open);

  if (prelude.startsWith('@media')) {
    ctx.media.push(prelude.slice('@media'.length).trim());
    parseBlockContents(body, ctx);
    ctx.media.pop();
    return after;
  }
  if (prelude.startsWith('@supports')) {
    // Take every @supports block: the probe is almost always guarding
    // something exotic, and skipping it would blank Tailwind's
    // progressive-enhancement output
    parseBlockContents(body, ctx);
    return after;
  }
  if (prelude.startsWith('@layer')) {
    const name = prelude.slice('@layer'.length).trim() || '<anonymous>';
    const qualified = qualifyLayer(ctx.layer, name);
    registerLayer(ctx.sheet, qualified);
    const outer = ctx.layer;
    ctx.layer = qualified;
    parseBlockContents(body, ctx);
    ctx.layer = outer;
    return after;
  }
  if (prelude.startsWith('@keyframes')) {
    const name = prelude.slice('@keyframes'.length).trim();
    if (name !== '') {
      ctx.sheet.keyframes.push({
        type: 'keyframes',
        name,
        stops: parseKeyframesBody(body),
      });
    }
    return after;
  }
  // Unknown at-rules (@font-face, @property, @page, …) are skipped whole
  return after;
}

function qualifyLayer(outer: string | null, name: string): string {
  return outer == null ? name : `${outer}.${name}`;
}

function registerLayer(sheet: Stylesheet, name: string): void {
  if (!sheet.layerOrder.includes(name)) {
    sheet.layerOrder.push(name);
  }
}

function parseKeyframesBody(
  body: string,
): Array<{offset: number, declarations: {[string]: string}}> {
  const stops = [];
  let i = 0;
  while (i < body.length) {
    const open = indexOfTopLevel(body, '{', i);
    if (open === -1) {
      break;
    }
    const selectorList = body.slice(i, open);
    const [block, after] = scanBlock(body, open);
    const declarations = parseDeclarations(block);
    for (const rawSel of splitTopLevel(selectorList, ',')) {
      const sel = rawSel.trim().toLowerCase();
      let offset = null;
      if (sel === 'from') {
        offset = 0;
      } else if (sel === 'to') {
        offset = 1;
      } else if (sel.endsWith('%')) {
        const pct = parseFloat(sel);
        if (!Number.isNaN(pct)) {
          offset = pct / 100;
        }
      }
      if (offset != null) {
        stops.push({offset, declarations});
      }
    }
    i = after;
  }
  stops.sort((x, y) => x.offset - y.offset);
  return stops;
}
