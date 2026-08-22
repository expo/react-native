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
 * A CSS stylesheet parser (css-syntax-3, the subset the fork's element
 * runtime can honor), producing structured rules for the matcher in
 * `match.js`.
 *
 * Written against real-world input — a Tailwind build is the canonical
 * producer — so the details that matter are the unglamorous ones: escaped
 * identifiers (`.hover\:bg-primary\/90:hover`, `.w-\[100px\]`), strings,
 * comments, nested parens/brackets inside `:is()`/`var()`/`url()`,
 * `@media`/`@supports`/`@layer` blocks, and `@keyframes`.
 *
 * The parser is deliberately tolerant the way the spec demands: an
 * unparseable declaration is dropped, an unsupported *selector* is kept but
 * compiled to never match (so its rule still costs nothing at runtime), and
 * unknown at-rules are skipped whole. Nothing throws on author input.
 */

export type AttributeMatcher = {
  name: string,
  // null: presence ([disabled]); otherwise '=', '^=', '$=', '*=', '~=', '|='.
  op: string | null,
  value: string | null,
};

/**
 * One compound selector: everything that must hold on a SINGLE element.
 */
export type Compound = {
  // Element type, lowercased; null when absent or '*'.
  tag: string | null,
  classes: Array<string>,
  attributes: Array<AttributeMatcher>,
  // Interaction/UA pseudo-classes the runtime models: 'hover', 'active',
  // 'focus', 'focus-visible', 'disabled', 'root'.
  pseudoClasses: Array<string>,
};

export type ComplexSelector = {
  // The selector exactly as authored, for consumers that recognize whole
  // patterns the matcher cannot express (see the space-y rewrite in
  // css/index.js).
  raw: string,
  // Compounds in document order; the SUBJECT (rightmost) is last. Each entry
  // names the combinator that connects it to the one after it; the subject's
  // combinator is null.
  parts: Array<{compound: Compound, combinator: ' ' | '>' | null}>,
  specificity: number, // (a << 20) | (b << 10) | c — comparable as one int
  // Selector used syntax the matcher cannot honor (sibling combinators,
  // unknown pseudos, pseudo-elements). Kept for bookkeeping; never matches.
  unsupported: boolean,
};

export type StyleRule = {
  type: 'style',
  selectors: Array<ComplexSelector>,
  // Declarations exactly as authored: kebab-case property → value string.
  // Camel-casing and value resolution belong to the consumer, which feeds
  // them through the same pipeline stylex declarations use.
  declarations: {[string]: string},
  // Raw condition of every enclosing @media block (outermost first).
  media: Array<string>,
  // Name path of the enclosing @layer block(s), joined with '.'; null when
  // unlayered. Unlayered rules cascade AFTER all layered ones (cascade-5).
  layer: string | null,
  // Source order across the whole stylesheet list, assigned by the caller's
  // running counter: later wins among equal specificity and layer.
  order: number,
};

export type KeyframesRule = {
  type: 'keyframes',
  name: string,
  // Offset (0..1) → declarations, sorted by offset.
  stops: Array<{offset: number, declarations: {[string]: string}}>,
};

export type Stylesheet = {
  rules: Array<StyleRule>,
  keyframes: Array<KeyframesRule>,
  // @layer statement order (`@layer base, components, utilities;` and block
  // forms, in first-seen order). The cascade ranks layers by this list.
  layerOrder: Array<string>,
};

// -----------------------------------------------------------------------------
// Low-level scanning
// -----------------------------------------------------------------------------

/**
 * Strips comments, preserving everything else byte-for-byte (strings may
 * contain `/*`).
 */
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

/**
 * Returns the index one past the closing quote (or end of input), honoring
 * backslash escapes.
 */
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

/**
 * Finds `needle` at the top nesting level (outside strings, parens, brackets
 * and braces), starting from `from`. Returns -1 when absent.
 */
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
    // The needle wins over its own bracket-nature: searching for `{` must
    // find the block opener, not descend into it.
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

/**
 * Splits on a separator at the top nesting level.
 */
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

/**
 * The body between a `{` at `open` and its matching `}`. Returns [body,
 * indexAfterClose].
 */
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

/**
 * CSS identifier unescaping: `\:` → `:`, `\2f ` → `/` (hex form), etc.
 * Tailwind class names in selectors are full of these.
 */
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
      // Hex escape: up to 6 digits, optionally followed by one whitespace.
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

// -----------------------------------------------------------------------------
// Selector compilation
// -----------------------------------------------------------------------------

const SUPPORTED_PSEUDO_CLASSES = new Set([
  'hover',
  'active',
  'focus',
  'focus-visible',
  'disabled',
  'root',
]);

// Matched structurally rather than as state, and true by construction for
// the runtime's purposes: dropping them from the compound keeps the rule
// matchable instead of discarding styles that do apply.
const ALWAYS_TRUE_PSEUDO_CLASSES = new Set(['enabled', 'link', 'any-link']);

/**
 * An identifier or `*`, starting at `i`. Returns [raw, next].
 */
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
  // `:is(.dark *)` on the subject: Tailwind v4's class-strategy dark variant.
  // Compiles to a `.dark` ancestor part rather than a subject constraint.
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
      // Modeled as an attribute match on `id`; counts as an id for
      // specificity (selectors-4 §17).
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
        // Pseudo-elements generate boxes this runtime does not; the whole
        // selector can never match.
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
      // Functional pseudo-classes.
      if (pseudo === 'is' || pseudo === 'where') {
        if (args.trim() === '.dark *') {
          // Tailwind's class-strategy dark variant: an ancestor carries
          // `.dark`. Hoisted to an ancestor compound by the caller.
          trailingDarkAncestor = true;
          if (pseudo === 'is') {
            b++; // :is() takes its most specific argument: a class
          }
          continue;
        }
        // General :is()/:where() would need alternation in the matcher;
        // until a consumer needs it, the selector is out of scope.
        unsupported = true;
        continue;
      }
      if (pseudo === 'not') {
        // A single-compound :not() of the supported simple selectors could
        // be honored; no producer needs it yet, so it stays out of scope.
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
    // Anything unrecognized poisons the compound rather than mis-matching.
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

/**
 * Compiles one complex selector (no commas).
 */
export function compileSelector(raw: string): ComplexSelector {
  // Tokenize into compounds and combinators at the TOP level only — the
  // space in `:is(.dark *)` is not a combinator, so the walk tracks
  // paren/bracket depth and escapes rather than regex-splitting.
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
        // `a > b`: the first space set a descendant pending; the `>` then
        // upgrades it, and the space AFTER `>` must not downgrade it back.
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
        // does not carry; the selector is kept but never matches.
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
      // `:is(.dark *)` becomes an explicit `.dark` ancestor part BEFORE this
      // compound, exactly what it means.
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
    // CSS specificity IS a packed tuple — (id, class, type) compared
    // lexicographically — and packing it into one integer is what makes
    // comparison a single `>`. The bit widths cap each count at 1023, far
    // above anything a real selector reaches.
    // eslint-disable-next-line no-bitwise
    specificity: (A << 20) | (B << 10) | C,
    unsupported: unsupported || parts.length === 0,
  };
}

// -----------------------------------------------------------------------------
// Declarations
// -----------------------------------------------------------------------------

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
    // `!important` is honored as ordinary weight for now: Tailwind emits it
    // only under explicit config. Stripped so values stay clean.
    value = value.replace(/\s*!important\s*$/i, '');
    out[property] = value;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Stylesheet parsing
// -----------------------------------------------------------------------------

type ParseContext = {
  media: Array<string>,
  layer: string | null,
  sheet: Stylesheet,
  counter: {order: number},
};

/**
 * Parses a stylesheet. `startOrder` threads a running source-order counter
 * across multiple sheets so a later sheet's rules win ties against an
 * earlier one's, exactly like two <link> tags.
 */
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
    // Skip whitespace between constructs.
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
    // A style rule: selector list up to `{`, then a declaration block.
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

  // Statement form (`@import …;`, `@layer a, b;`, `@charset …;`).
  if (semi !== -1 && (open === -1 || semi < open)) {
    const statement = css.slice(at, semi).trim();
    if (statement.startsWith('@layer')) {
      for (const name of statement.slice('@layer'.length).split(',')) {
        registerLayer(ctx.sheet, qualifyLayer(ctx.layer, name.trim()));
      }
    }
    // @import is out of scope (the build feeds whole sheets); @charset and
    // friends are no-ops.
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
    // Every feature the runtime supports parses here; a @supports probe is
    // almost always guarding something exotic. Taking the block keeps
    // Tailwind's progressive-enhancement output visible rather than blank.
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
  // Unknown at-rule (@font-face, @property, @page, …): skipped whole.
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
