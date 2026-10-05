/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {DisplayCapabilities} from './NativeDisplayCapabilities';

/**
 * What a media query is asked about. `matchMedia` describes the window; a
 * stylesheet engine can describe the surface it styles, so both answer by
 * one grammar.
 */
export type MediaEnvironment = {
  // The box the query is about, in CSS pixels: the viewport for a media
  // query, the container for a container query
  readonly width: number,
  readonly height: number,
  // The viewport, which viewport units in a query resolve against
  readonly viewportWidth: number,
  readonly viewportHeight: number,
  // Device pixels per CSS pixel
  readonly resolution: number,
  readonly colorScheme: 'light' | 'dark',
  readonly reducedMotion: boolean,
  // The primary input. `any-pointer` and `any-hover` read it too; see
  // DOM-CSS-LIMITATION(media-pointer-is-the-touchscreen) in matchMedia.js
  readonly pointer: 'none' | 'coarse' | 'fine',
  readonly hover: boolean,
  // Asked only by a `color-gamut` or `dynamic-range` query
  readonly display: () => DisplayCapabilities,
};

// Media Queries 4 §3: a condition can be unknown, and stays unknown under
// `not`; a query that ends unknown is false
type Truth = boolean | 'unknown';

type Condition =
  | {readonly kind: 'test', readonly test: MediaEnvironment => boolean}
  | {readonly kind: 'unknown'}
  | {readonly kind: 'not', readonly operand: Condition}
  | {readonly kind: 'and' | 'or', readonly operands: ReadonlyArray<Condition>};

type Query = {
  // `not` before a media type negates the whole query
  readonly negated: boolean,
  // `all` and `screen` describe this renderer; another type is valid and
  // false
  readonly typeMatches: boolean,
  readonly condition: ?Condition,
};

// A query that can't be parsed is null, and matches nothing (§3.2)
export type ParsedMediaQueryList = ReadonlyArray<?Query>;

/**
 * Whether a media query list (Media Queries 4 §2) holds in an environment.
 * Lists are parsed once and cached by their text.
 */
export function mediaQueryListMatches(
  text: string,
  environment: MediaEnvironment,
): boolean {
  return parsedMediaQueryListMatches(parseMediaQueryList(text), environment);
}

export function parsedMediaQueryListMatches(
  list: ParsedMediaQueryList,
  environment: MediaEnvironment,
): boolean {
  // An empty list is true (§2.1)
  if (list.length === 0) {
    return true;
  }
  return list.some(query => query != null && evaluateQuery(query, environment));
}

const parsedLists: Map<string, ParsedMediaQueryList> = new Map();
// A stylesheet has a bounded set of queries; past this, start again rather
// than grow without end
const PARSED_LIST_LIMIT = 512;

export function parseMediaQueryList(text: string): ParsedMediaQueryList {
  const cached = parsedLists.get(text);
  if (cached != null) {
    return cached;
  }
  // Comments are dropped as CSS tokenizes them. Escapes aren't decoded, so an
  // escaped name is unknown. DOM-CSS-LIMITATION(media-queries-take-no-escapes)
  const source = text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  const parsed =
    source.trim() === '' ? [] : splitTopLevelCommas(source).map(parseQuery);
  if (parsedLists.size >= PARSED_LIST_LIMIT) {
    parsedLists.clear();
  }
  parsedLists.set(text, parsed);
  return parsed;
}

function evaluateQuery(query: Query, environment: MediaEnvironment): boolean {
  let result: Truth = query.typeMatches;
  if (result === true && query.condition != null) {
    result = evaluate(query.condition, environment);
  }
  if (query.negated) {
    return result === 'unknown' ? false : !result;
  }
  return result === true;
}

function evaluate(condition: Condition, environment: MediaEnvironment): Truth {
  switch (condition.kind) {
    case 'test':
      return condition.test(environment);
    case 'unknown':
      return 'unknown';
    case 'not': {
      const value = evaluate(condition.operand, environment);
      return value === 'unknown' ? value : !value;
    }
    case 'and': {
      let result: Truth = true;
      for (const operand of condition.operands) {
        const value = evaluate(operand, environment);
        if (value === false) {
          return false;
        }
        if (value === 'unknown') {
          result = 'unknown';
        }
      }
      return result;
    }
    case 'or': {
      let result: Truth = false;
      for (const operand of condition.operands) {
        const value = evaluate(operand, environment);
        if (value === true) {
          return true;
        }
        if (value === 'unknown') {
          result = 'unknown';
        }
      }
      return result;
    }
  }
  return 'unknown';
}

// -- The grammar (Media Queries 4 §2 and §3) --

type Token =
  | {readonly kind: 'word', readonly text: string}
  // `( … )`, with what is between the parentheses
  | {readonly kind: 'parens', readonly text: string}
  // `name( … )`, which the grammar only knows as <general-enclosed>
  | {readonly kind: 'function'};

const UNKNOWN: Condition = {kind: 'unknown'};
const KEYWORDS: Set<string> = new Set(['only', 'not', 'and', 'or', 'layer']);
// A CSS identifier, lowercased (CSS Syntax §4.3.9), without escapes
const IDENTIFIER =
  /^(?:--|-?(?:[_a-z]|[\u0080-\uffff]))(?:[-_a-z0-9]|[\u0080-\uffff])*$/;

// <media-query> = <media-condition>
//   | [ not | only ]? <media-type> [ and <media-condition-without-or> ]?
function parseQuery(text: string): ?Query {
  const tokens = tokenize(text);
  if (tokens == null || tokens.length === 0) {
    return null;
  }
  const first = tokens[0];
  if (first.kind !== 'word' || first.text === 'not') {
    const startsWithType =
      first.kind === 'word' && tokens.length > 1 && tokens[1].kind === 'word';
    if (!startsWithType) {
      const condition = parseCondition(tokens, true);
      return condition == null
        ? null
        : {negated: false, typeMatches: true, condition};
    }
  }
  let index = 0;
  let negated = false;
  if (
    first.kind === 'word' &&
    (first.text === 'not' || first.text === 'only') &&
    tokens.length > 1
  ) {
    negated = first.text === 'not';
    index = 1;
  }
  const type = tokens[index];
  if (
    type.kind !== 'word' ||
    KEYWORDS.has(type.text) ||
    !IDENTIFIER.test(type.text)
  ) {
    return null;
  }
  const rest = tokens.slice(index + 1);
  let condition = null;
  if (rest.length > 0) {
    const joiner = rest[0];
    if (joiner.kind !== 'word' || joiner.text !== 'and') {
      return null;
    }
    condition = parseCondition(rest.slice(1), false);
    if (condition == null) {
      return null;
    }
  }
  return {
    negated,
    typeMatches: type.text === 'all' || type.text === 'screen',
    condition,
  };
}

// <media-condition> = <media-not> | <media-in-parens> [ <media-and>* |
// <media-or>* ]; `and` and `or` don't mix without parentheses
function parseCondition(
  tokens: ReadonlyArray<Token>,
  allowOr: boolean,
): ?Condition {
  if (tokens.length === 0) {
    return null;
  }
  const first = tokens[0];
  if (first.kind === 'word' && first.text === 'not') {
    if (tokens.length !== 2) {
      return null;
    }
    const operand = parseInParens(tokens[1]);
    return operand == null ? null : {kind: 'not', operand};
  }
  const operands: Array<Condition> = [];
  let joiner: ?('and' | 'or') = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i % 2 === 1) {
      if (
        token.kind !== 'word' ||
        (token.text !== 'and' && token.text !== 'or') ||
        (joiner != null && joiner !== token.text) ||
        (token.text === 'or' && !allowOr) ||
        i === tokens.length - 1
      ) {
        return null;
      }
      joiner = token.text === 'or' ? 'or' : 'and';
      continue;
    }
    const operand = parseInParens(token);
    if (operand == null) {
      return null;
    }
    operands.push(operand);
  }
  if (operands.length === 1) {
    return operands[0];
  }
  return {kind: joiner ?? 'and', operands};
}

// <media-in-parens> = ( <media-condition> ) | <media-feature>
//   | <general-enclosed>, which is unknown
function parseInParens(token: Token): ?Condition {
  if (token.kind === 'function') {
    return UNKNOWN;
  }
  if (token.kind !== 'parens') {
    return null;
  }
  const inner = tokenize(token.text);
  if (inner == null || inner.length === 0) {
    return UNKNOWN;
  }
  const head = inner[0];
  if (head.kind !== 'word' || head.text === 'not') {
    return parseCondition(inner, true) ?? UNKNOWN;
  }
  return parseFeature(token.text) ?? UNKNOWN;
}

function tokenize(text: string): ?Array<Token> {
  const tokens: Array<Token> = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === ')') {
      return null;
    }
    let end = i;
    while (end < text.length && !/[\s()]/.test(text[end])) {
      end++;
    }
    if (end < text.length && text[end] === '(') {
      const close = matchingBracket(text, end);
      if (close < 0) {
        return null;
      }
      tokens.push(
        end === i
          ? {kind: 'parens', text: text.slice(end + 1, close)}
          : {kind: 'function'},
      );
      i = close + 1;
      continue;
    }
    tokens.push({kind: 'word', text: text.slice(i, end).toLowerCase()});
    i = end;
  }
  return tokens;
}

const CLOSING_BRACKET: {readonly [string]: string} = {
  '(': ')',
  '[': ']',
  '{': '}',
};

// The index of the bracket that closes the one at `open`, skipping strings;
// -1 when a bracket inside doesn't match, which <any-value> doesn't allow
// (CSS Syntax §8.2), or it never closes
function matchingBracket(text: string, open: number): number {
  const expected: Array<string> = [];
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const end = stringEnd(text, i);
      if (end < 0) {
        return -1;
      }
      i = end - 1;
    } else if (char === '(' || char === '[' || char === '{') {
      expected.push(CLOSING_BRACKET[char]);
    } else if (char === ')' || char === ']' || char === '}') {
      if (expected.pop() !== char) {
        return -1;
      }
      if (expected.length === 0) {
        return i;
      }
    }
  }
  return -1;
}

// The index after the quote that closes the string opening at `open`, or -1
function stringEnd(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === quote) {
      return i + 1;
    }
  }
  return -1;
}

function splitTopLevelCommas(text: string): Array<string> {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const end = stringEnd(text, i);
      if (end < 0) {
        break;
      }
      i = end - 1;
    } else if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// -- Media features (Media Queries 4 §2.4, §4 and §5; Media Queries 5 §6, §11)

// A value as the environment's own unit: CSS pixels, a ratio, dppx
type Value = MediaEnvironment => number;

type RangeFeature = {
  readonly read: MediaEnvironment => number,
  readonly parse: string => ?Value,
};

type DiscreteFeature = {
  readonly values: ReadonlyArray<string>,
  readonly matches: (MediaEnvironment, string) => boolean,
  // A feature named on its own (§2.4.2) is true unless its value would be
  // `none`, `no-preference` or zero
  readonly inBooleanContext: MediaEnvironment => boolean,
};

const RANGE_FEATURES: Map<string, RangeFeature> = table({
  width: {read: environment => environment.width, parse: parseLength},
  height: {read: environment => environment.height, parse: parseLength},
  'aspect-ratio': {
    read: environment => environment.width / environment.height,
    parse: parseRatio,
  },
  resolution: {
    read: environment => environment.resolution,
    parse: parseResolution,
  },
});

const GAMUT_RANK: Map<string, number> = table({srgb: 0, p3: 1, rec2020: 2});

const HOVER: DiscreteFeature = {
  values: ['none', 'hover'],
  matches: (environment, value) =>
    value === (environment.hover ? 'hover' : 'none'),
  inBooleanContext: environment => environment.hover,
};

const POINTER: DiscreteFeature = {
  values: ['none', 'coarse', 'fine'],
  matches: (environment, value) => value === environment.pointer,
  inBooleanContext: environment => environment.pointer !== 'none',
};

const DYNAMIC_RANGE: DiscreteFeature = {
  values: ['standard', 'high'],
  // `standard` holds on every display, `high` on one that shows HDR
  matches: (environment, value) =>
    value === 'standard' || environment.display().dynamicRange === 'high',
  inBooleanContext: () => true,
};

const DISCRETE_FEATURES: Map<string, DiscreteFeature> = table({
  orientation: {
    values: ['portrait', 'landscape'],
    matches: (environment, value) =>
      value ===
      (environment.height >= environment.width ? 'portrait' : 'landscape'),
    inBooleanContext: () => true,
  },
  hover: HOVER,
  'any-hover': HOVER,
  pointer: POINTER,
  'any-pointer': POINTER,
  'prefers-color-scheme': {
    values: ['light', 'dark'],
    matches: (environment, value) => value === environment.colorScheme,
    inBooleanContext: () => true,
  },
  'prefers-reduced-motion': {
    values: ['no-preference', 'reduce'],
    matches: (environment, value) =>
      value === (environment.reducedMotion ? 'reduce' : 'no-preference'),
    inBooleanContext: environment => environment.reducedMotion,
  },
  // P3 is true of a P3 display "or more"
  'color-gamut': {
    values: ['srgb', 'p3', 'rec2020'],
    matches: (environment, value) =>
      (GAMUT_RANK.get(value) ?? Infinity) <=
      (GAMUT_RANK.get(environment.display().colorGamut) ?? 0),
    inBooleanContext: () => true,
  },
  'dynamic-range': DYNAMIC_RANGE,
  'video-dynamic-range': DYNAMIC_RANGE,
});

function test(predicate: MediaEnvironment => boolean): Condition {
  return {kind: 'test', test: predicate};
}

// A lookup that knows only the names given, so a name like `constructor` is
// unknown rather than the object prototype's
function table<T>(entries: {readonly [string]: T}): Map<string, T> {
  const map = new Map<string, T>();
  for (const key of Object.keys(entries)) {
    map.set(key, entries[key]);
  }
  return map;
}

// <mf-plain>, <mf-boolean> or <mf-range>; null when it is none of them, which
// leaves it <general-enclosed>
function parseFeature(text: string): ?Condition {
  const source = text.trim().toLowerCase();
  if (/[<>=]/.test(source)) {
    return parseRange(source);
  }
  const colon = source.indexOf(':');
  if (colon < 0) {
    const range = RANGE_FEATURES.get(source);
    if (range != null) {
      return test(environment => range.read(environment) !== 0);
    }
    const discrete = DISCRETE_FEATURES.get(source);
    return discrete == null ? null : test(discrete.inBooleanContext);
  }
  const name = source.slice(0, colon).trim();
  const value = source.slice(colon + 1).trim();
  const prefix = /^(min|max)-/.exec(name)?.[1];
  const range = RANGE_FEATURES.get(prefix == null ? name : name.slice(4));
  if (range != null) {
    const expected = range.parse(value);
    if (expected == null) {
      return null;
    }
    const operator = prefix === 'min' ? '>=' : prefix === 'max' ? '<=' : '=';
    return test(environment =>
      compare(range.read(environment), operator, expected(environment)),
    );
  }
  const discrete = prefix == null ? DISCRETE_FEATURES.get(name) : null;
  if (discrete == null || !discrete.values.includes(value)) {
    return null;
  }
  return test(environment => discrete.matches(environment, value));
}

// `(width >= 600px)`, `(600px < width)`, `(400px <= width < 800px)`
function parseRange(source: string): ?Condition {
  const parts = source.split(/(<=|>=|<|>|=)/).map(part => part.trim());
  if (parts.length === 3) {
    const [left, operator, right] = parts;
    const named = RANGE_FEATURES.get(left);
    if (named != null) {
      const expected = named.parse(right);
      return expected == null
        ? null
        : test(environment =>
            compare(named.read(environment), operator, expected(environment)),
          );
    }
    const flipped = RANGE_FEATURES.get(right);
    const expected = flipped == null ? null : flipped.parse(left);
    return flipped == null || expected == null
      ? null
      : test(environment =>
          compare(
            flipped.read(environment),
            reverse(operator),
            expected(environment),
          ),
        );
  }
  if (parts.length === 5) {
    const [low, lowOperator, name, highOperator, high] = parts;
    const feature = RANGE_FEATURES.get(name);
    const bothLess = lowOperator[0] === '<' && highOperator[0] === '<';
    const bothGreater = lowOperator[0] === '>' && highOperator[0] === '>';
    if (feature == null || (!bothLess && !bothGreater)) {
      return null;
    }
    const lower = feature.parse(low);
    const upper = feature.parse(high);
    if (lower == null || upper == null) {
      return null;
    }
    return test(environment => {
      const actual = feature.read(environment);
      return (
        compare(actual, reverse(lowOperator), lower(environment)) &&
        compare(actual, highOperator, upper(environment))
      );
    });
  }
  return null;
}

function compare(actual: number, operator: string, expected: number): boolean {
  switch (operator) {
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    default:
      return actual === expected;
  }
}

// `600px < width` is `width > 600px`
function reverse(operator: string): string {
  switch (operator) {
    case '<':
      return '>';
    case '<=':
      return '>=';
    case '>':
      return '<';
    case '>=':
      return '<=';
    default:
      return operator;
  }
}

// A CSS number: a decimal point needs a digit after it (CSS Syntax §4.3.12)
const NUMBER = '[+-]?(?:\\d*\\.\\d+|\\d+)(?:e[+-]?\\d+)?';
const DIMENSION = new RegExp(`^(${NUMBER})([a-z]*)$`);
const RATIO = new RegExp(`^(${NUMBER})(?:\\s*/\\s*(${NUMBER}))?$`);

// Absolute lengths in CSS pixels. `em` and `rem` are the initial font size,
// 16px, in a media query (Media Queries 4 §1.3)
const LENGTH_UNITS: Map<string, number> = table({
  px: 1,
  em: 16,
  rem: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
});

function parseLength(text: string): ?Value {
  const match = DIMENSION.exec(text);
  if (match == null) {
    return null;
  }
  const amount = parseFloat(match[1]);
  const unit = match[2];
  if (unit === '') {
    // Only zero may go without a unit
    return amount === 0 ? () => 0 : null;
  }
  const scale = LENGTH_UNITS.get(unit);
  if (scale != null) {
    const pixels = amount * scale;
    return () => pixels;
  }
  // The viewport's units, against the environment's viewport
  switch (unit) {
    case 'vw':
      return environment => (amount * environment.viewportWidth) / 100;
    case 'vh':
      return environment => (amount * environment.viewportHeight) / 100;
    case 'vmin':
      return environment =>
        (amount *
          Math.min(environment.viewportWidth, environment.viewportHeight)) /
        100;
    case 'vmax':
      return environment =>
        (amount *
          Math.max(environment.viewportWidth, environment.viewportHeight)) /
        100;
    default:
      return null;
  }
}

function parseRatio(text: string): ?Value {
  const match = RATIO.exec(text);
  if (match == null) {
    return null;
  }
  const numerator = parseFloat(match[1]);
  const denominator = match[2] == null ? 1 : parseFloat(match[2]);
  if (numerator < 0 || denominator < 0) {
    return null;
  }
  const ratio = numerator / denominator;
  return () => ratio;
}

const RESOLUTION_UNITS: Map<string, number> = table({
  dppx: 1,
  x: 1,
  dpi: 1 / 96,
  dpcm: 2.54 / 96,
});

function parseResolution(text: string): ?Value {
  const match = DIMENSION.exec(text);
  const scale = match == null ? null : RESOLUTION_UNITS.get(match[2]);
  if (match == null || scale == null) {
    return null;
  }
  const dppx = parseFloat(match[1]) * scale;
  return () => dppx;
}
