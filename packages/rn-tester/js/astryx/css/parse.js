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

/**
 * A `@container` prelude: the container it asks about, by name when named
 * (the nearest ancestor container otherwise), and the size condition, which
 * is written like a media condition.
 */
export type ContainerQuery = {name: string | null, condition: string};

export type StyleRule = {
  type: 'style',
  selectors: Array<ComplexSelector>,
  // As authored, kebab-case property → value string; the consumer camel-cases
  // and resolves values
  declarations: {[string]: string},
  // The root selector of every enclosing @scope block, outermost first
  scopeRoots: Array<string>,
  // The condition of every enclosing @media block, outermost first
  media: Array<string>,
  // Every enclosing @container block, outermost first
  containers: Array<ContainerQuery>,
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
      if (ident[j] === ' ' || ident[j] === '\t' || ident[j] === '\n') {
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
  'popover-open',
  'root',
]);

// True by construction in this runtime, so dropping them keeps the rule
// matchable instead of discarding styles that do apply
const ALWAYS_TRUE_PSEUDO_CLASSES = new Set(['enabled', 'link', 'any-link']);

// The index after the escape at `start` (css-syntax-3 §4.3.7): a backslash and
// one character, or up to six hex digits and the one whitespace that may end
// them, which belongs to the escape and is not a descendant combinator
function escapeEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && i < start + 7 && /[0-9a-fA-F]/.test(text[i])) {
    i++;
  }
  if (i === start + 1) {
    return Math.min(start + 2, text.length);
  }
  if (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') {
    i++;
  }
  return i;
}

// An identifier's extent (css-syntax-3 §4.3.11): ASCII letters, digits, `_`,
// `-`, any non-ASCII code point, and escapes
function scanSelectorIdent(sel: string, i: number): [string, number] {
  let j = i;
  while (j < sel.length) {
    const ch = sel[j];
    if (ch === '\\') {
      j = escapeEnd(sel, j);
      continue;
    }
    if (/[A-Za-z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80) {
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
/**
 * A selector with `:is()` or `:where()` over a list of compounds, written out
 * as the selectors it stands for: `:where(img, video)` is `img` and `video`,
 * `:where([a]) > :where(*)` is `[a] > *`, and two lists multiply. Astryx's
 * reset sheet is written this way throughout. The matcher takes one compound
 * per position, so the list is expanded here rather than matched as an
 * alternation; `:is()` keeps the specificity of the compound it expands to,
 * where the web takes the most specific argument, and `:where()` adds its
 * argument's specificity where the web adds none — a difference only between
 * two sheet rules on one element, which the reset's zero-specificity rules
 * never contest. A list whose arguments are complex selectors (`:is(.dark *)`)
 * is left for `parseCompound`, which knows the one form the matcher handles.
 */
function expandSelectorLists(raw: string): Array<string> {
  const results: Array<string> = [];
  const expand = (sel: string, budget: number): void => {
    const start = Math.max(sel.lastIndexOf(':is('), sel.lastIndexOf(':where('));
    if (start === -1 || budget <= 0) {
      results.push(sel);
      return;
    }
    const open = sel.indexOf('(', start);
    let depth = 0;
    let close = -1;
    for (let i = open; i < sel.length; i++) {
      if (sel[i] === '(') {
        depth++;
      } else if (sel[i] === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) {
      results.push(sel);
      return;
    }
    const args = splitTopLevel(sel.slice(open + 1, close), ',')
      .map(a => a.trim())
      .filter(a => a !== '');
    const simple = args.every(a => !/[\s>+~]/.test(a));
    if (!simple) {
      results.push(sel);
      return;
    }
    for (const arg of args) {
      // `*` is the universal selector, which is nothing in a compound
      const piece = arg === '*' ? '' : arg;
      const before = sel.slice(0, start);
      const rest = sel.slice(close + 1);
      // Keep a bare `*` when the list was the whole compound, as in `> *`
      const expanded =
        piece === '' && !/[^\s>+~]$/.test(before) && !/^[^\s>+~]/.test(rest)
          ? before + '*' + rest
          : before + piece + rest;
      expand(expanded, budget - 1);
    }
  };
  expand(raw, 8);
  return results;
}

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
        const end = escapeEnd(text, i);
        current += text.slice(i, end);
        i = end - 1;
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
  containers: Array<ContainerQuery>,
  scopeRoots: Array<string>,
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
    containers: [],
    scopeRoots: [],
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
      .map(s => scopeSelector(s, ctx.scopeRoots))
      .flatMap(expandSelectorLists)
      .map(compileSelector);
    const declarations = parseDeclarations(body);
    if (selectors.length > 0 && Object.keys(declarations).length > 0) {
      ctx.sheet.rules.push({
        type: 'style',
        selectors,
        declarations,
        scopeRoots: ctx.scopeRoots.slice(),
        media: ctx.media.slice(),
        containers: ctx.containers.slice(),
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
  if (prelude.startsWith('@container')) {
    // DOM-CSS-DEVIATION(container-query-is-a-media-query): the size condition
    // is answered over the window, the elements reporting no container size;
    // on a phone the containers that carry these queries (a gallery, a login
    // panel) span the window, so the window's width is the one the query
    // would see. The container itself is required, as on the web: the rule
    // applies only under an ancestor that declares `container-type`, and the
    // one of that name when the query names one (css/match.js).
    const args = prelude.slice('@container'.length).trim();
    const paren = args.indexOf('(');
    const name = (paren === -1 ? args : args.slice(0, paren)).trim();
    ctx.containers.push({
      name: name === '' ? null : name,
      condition: paren === -1 ? '' : args.slice(paren).trim(),
    });
    parseBlockContents(body, ctx);
    ctx.containers.pop();
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
  if (prelude.startsWith('@scope')) {
    // `@scope (<root>) to (<limit>) { … }` (css-cascade-6): every rule inside
    // is scoped under the root selector, `:scope` standing for the root
    // itself, which is how Astryx's built themes declare their tokens on
    // `[data-astryx-theme="…"]`. DOM-CSS-LIMITATION(scope-limit-ignored):
    // the limit is not applied — a rule still reaches past a nested root —
    // and a `&` in a scoped selector is not resolved.
    const args = prelude.slice('@scope'.length).trim();
    const rootOpen = args.indexOf('(');
    const rootClose =
      rootOpen === -1 ? -1 : indexOfTopLevel(args, ')', rootOpen + 1);
    const root =
      rootOpen === -1 || rootClose === -1
        ? ''
        : args.slice(rootOpen + 1, rootClose).trim();
    ctx.scopeRoots.push(root);
    parseBlockContents(body, ctx);
    ctx.scopeRoots.pop();
    return after;
  }
  // Unknown at-rules (@font-face, @property, @page, …) are skipped whole
  return after;
}

/**
 * A selector inside `@scope` blocks, written against the innermost root:
 * `:scope` is the root itself, anything else is a descendant of it.
 */
function scopeSelector(selector: string, roots: Array<string>): string {
  if (roots.length === 0) {
    return selector;
  }
  const root = roots[roots.length - 1];
  if (root === '') {
    return selector;
  }
  if (selector === ':scope') {
    return root;
  }
  const own = selector.replace(/:scope\b/g, root);
  return own === selector ? `${root} ${selector}` : own;
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
