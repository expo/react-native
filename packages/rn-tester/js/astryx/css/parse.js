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
 * Compiles a selector (selectors-4) for the matcher in `match.js`, which the
 * DOM shim's selector APIs use. Tolerant as the spec demands: a selector the
 * matcher cannot honor compiles but never matches. Nothing throws on author
 * input.
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
