/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

/**
 * A React Native runtime for StyleX, so Astryx's own sources run unmodified.
 *
 * On web, `stylex.create()` compiles to atomic CSS at build time. Here nothing
 * compiles: `create()` keeps the raw objects and `props()` resolves them per
 * render into an RN `style`. Metro aliases `@stylexjs/stylex` to this module.
 *
 * Supported: design tokens and `var()` (including chained fallbacks), custom
 * properties both element-local and inherited across elements, `light-dark()`,
 * `calc()`, `color-mix()`, conditional values resolved against real interaction
 * state (`:hover`, `:focus`, `:active`, `@media` guards — see
 * `useInteractionState`), CSS Grid, and transitions/animations handed to the
 * renderer's native engine.
 *
 * Not supported: `createTheme()`, more than one animation on an element,
 * `transition-behavior: allow-discrete`, and the property families in
 * `DROPPED_PREFIXES` below. Anything unsupported is dropped with a dev warning.
 */

import {resolveColorMixArgs, substituteOklabColors} from './colorMix';
import {
  CONTAINER_BLOCK_SIZE,
  CONTAINER_INLINE_SIZE,
  VIEWPORT_BLOCK_SIZE,
  VIEWPORT_INLINE_SIZE,
  containerFromDeclarations,
  scopeSize,
} from './css/match';
import {
  counters,
  engineEnabled,
  instrumenting,
  registerKeyframes as registerEngineKeyframes,
  registerStyle as registerEngineStyle,
  registerTokens as registerEngineTokens,
  setEnvironmentResolver as setEngineEnvironmentResolver,
  standInFor,
} from './native-css/engine';
import {Appearance, Dimensions, processColor} from 'react-native';
import {windowMediaEnvironment} from 'react-native/Libraries/Utilities/matchMedia';
import {mediaQueryListMatches} from 'react-native/Libraries/Utilities/MediaQueries';

type RawStyle = {readonly [string]: unknown};

const tokenTable: Map<string, unknown> = new Map();

/**
 * Registers token defaults and returns web-shaped var references
 * (`{'--spacing-4': 'var(--spacing-4)'}`), which is exactly what token
 * consumers embed into their style values.
 */
export function defineVars<T extends {readonly [string]: unknown}>(
  defaults: T,
): T {
  const refs: {[string]: unknown} = {};
  for (const name of Object.keys(defaults)) {
    tokenTable.set(name, defaults[name]);
    refs[name] = `var(${name})`;
  }
  if (engineEnabled()) {
    registerEngineTokens(defaults);
  }
  // $FlowFixMe[incompatible-type] same keys, var-reference values
  return refs;
}

/**
 * Web StyleX compiles these to class names; here styles stay raw objects.
 * Function-valued entries (dynamic styles) stay callable and return their
 * raw style object.
 */
export function create<T extends {readonly [string]: unknown}>(
  namedStyles: T,
): T {
  // Raw objects pass straight through; props() does all the work.
  return namedStyles;
}

let keyframesCounter = 0;
// `stylex.keyframes()` returns an opaque animation name, exactly as on the
// web; the frames live here until a style references the name, at which point
// resolution serializes them for the renderer's native animation engine.
const keyframesRegistry: Map<string, RawStyle> = new Map();
/**
 * Registers keyframes under an AUTHORED name — the CSS engine's @keyframes
 * land here so `animation-name: spin` resolves through the same registry and
 * interception as stylex.keyframes().
 */
export function registerNamedKeyframes(name: string, frames: RawStyle): void {
  keyframesRegistry.set(name, frames);
}

export function keyframes(frames: RawStyle): string {
  const name = `__rn_keyframes_${keyframesCounter++}`;
  keyframesRegistry.set(name, frames);
  if (engineEnabled()) {
    registerEngineKeyframes(name, frames);
  }
  return name;
}

/**
 * Resolves a registered keyframes name into the renderer's wire format: an
 * array of stops sorted by offset, each stop's declarations resolved through
 * the SAME pipeline as ordinary styles (tokens, var() fallbacks, calc()) —
 * resolved as FINAL, since the stops are consumed by the native engine and
 * no ancestor can supply a custom property later.
 */
export function resolveKeyframes(
  name: string,
  state: InteractionState,
): ?ReadonlyArray<{[string]: unknown, offset: number}> {
  const frames = keyframesRegistry.get(name);
  if (frames == null) {
    return null;
  }
  const stops: Array<{[string]: unknown, offset: number}> = [];
  for (const key of Object.keys(frames)) {
    // 'from'/'to' are aliases for 0%/100% (css-animations-1 §4.2).
    const offset =
      key === 'from' ? 0 : key === 'to' ? 1 : parseFloat(key) / 100;
    if (Number.isNaN(offset)) {
      continue;
    }
    keepTransformStrings = true;
    let resolved;
    try {
      resolved = resolveDeclarations(
        {...(frames[key] as $FlowFixMe)},
        state,
        null,
        true,
      );
    } finally {
      keepTransformStrings = false;
    }
    // Color values in ordinary styles are converted by the view config's
    // processColor; these stops bypass that path, so normalize here — the
    // native parser receives platform color ints.
    for (const colorProp of ['backgroundColor', 'borderColor', 'color']) {
      if (resolved[colorProp] != null) {
        resolved[colorProp] = processColor(resolved[colorProp] as $FlowFixMe);
      }
    }
    stops.push({...resolved, offset});
  }
  stops.sort((a, b) => Number(a.offset) - Number(b.offset));
  return stops.length > 0 ? stops : null;
}

export function firstThatWorks(...values: Array<unknown>): unknown {
  // No feature detection on RN — take the first candidate.
  return values[0];
}

/**
 * `stylex.defineConsts()` declares values the StyleX compiler inlines at build
 * time. Styles here are read as written, so the constants are returned as they
 * are and read by name.
 */
export function defineConsts<T extends {readonly [string]: unknown}>(
  consts: T,
): T {
  return consts;
}

/**
 * `stylex.types.*` tags a variable's default with its CSS type
 * (`stylex.types.number(0)`) so the compiler can emit an `@property` rule.
 * The renderer has no registered properties; the value itself is the default.
 */
const typedValue = (value: unknown): unknown => value;
export const types: {readonly [string]: (unknown) => unknown} = {
  angle: typedValue,
  color: typedValue,
  image: typedValue,
  integer: typedValue,
  length: typedValue,
  lengthPercentage: typedValue,
  number: typedValue,
  percentage: typedValue,
  resolution: typedValue,
  time: typedValue,
  transformFunction: typedValue,
  transformList: typedValue,
  url: typedValue,
};

// Finds `fn(` at or after `from` and returns the span of the balanced call.
function findCall(
  value: string,
  fn: string,
  from: number,
): ?{start: number, open: number, close: number} {
  const start = value.indexOf(fn + '(', from);
  if (start < 0) {
    return null;
  }
  const open = start + fn.length;
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    const c = value[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return {start, open, close: i};
      }
    }
  }
  return null;
}

// Splits `args` at the first top-level comma ("a, b" respecting parens).
function splitFirstTopLevelComma(args: string): [string, ?string] {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ',' && depth === 0) {
      return [args.slice(0, i), args.slice(i + 1)];
    }
  }
  return [args, null];
}

type VarScope = Map<string, unknown>;

function lookupVar(
  name: string,
  scope: VarScope,
  depth: number,
  final: boolean,
): ?string {
  // A token's default is its `:root` value, which any ancestor may shadow —
  // a theme's stylesheet declares its tokens on `[data-astryx-theme]`. The
  // eager pass has no ancestors in hand, so a token reference is deferred to
  // the element like any other custom property, and the default is taken
  // only in the final pass, when no ancestor supplied the name.
  const raw = scope.has(name)
    ? scope.get(name)
    : final
      ? tokenTable.get(name)
      : undefined;
  // A custom property declared `initial` holds the guaranteed-invalid value
  // (css-variables-1 §2.1), so a `var()` of it takes its fallback, as for a
  // name nothing declared; Astryx's Layout resets its padding properties so
  if (raw == null || String(raw).trim() === 'initial') {
    return null;
  }
  return resolveString(String(raw), scope, depth + 1, final);
}

/**
 * Substitutes every `var(--x[, fallback])` occurrence, recursively.
 *
 * `final` distinguishes the two resolution passes (custom-property
 * inheritance, M3): during the eager pass inside `props()` an unknown name is
 * left *unresolved* — an ancestor element may still define it, and taking its
 * fallback here would be wrong — so the whole `var()` expression is preserved
 * for the element to finish. In the final pass (at the element, with the
 * inherited scope in hand) an unknown name collapses to its fallback, or to
 * empty, exactly as the browser does.
 */
function substituteVars(
  value: string,
  scope: VarScope,
  depth: number,
  final: boolean,
): string {
  let result = value;
  let cursor = 0;
  while (true) {
    const call = findCall(result, 'var', cursor);
    if (call == null) {
      break;
    }
    const args = result.slice(call.open + 1, call.close);
    const [nameRaw, fallback] = splitFirstTopLevelComma(args);
    const name = nameRaw.trim();
    let replacement = lookupVar(name, scope, depth, final);
    if (replacement == null) {
      if (!final) {
        // Defer: skip past this call and leave it verbatim.
        cursor = call.close + 1;
        continue;
      }
      replacement =
        fallback != null
          ? resolveString(fallback.trim(), scope, depth + 1, final)
          : '';
    }
    result =
      result.slice(0, call.start) + replacement + result.slice(call.close + 1);
    cursor = call.start + replacement.length;
  }
  return result;
}

function currentSchemeIsDark(): boolean {
  return Appearance.getColorScheme() === 'dark';
}

function substituteLightDark(value: string, dark: boolean): string {
  let result = value;
  while (true) {
    const call = findCall(result, 'light-dark', 0);
    if (call == null) {
      break;
    }
    const args = result.slice(call.open + 1, call.close);
    const [lightVal, darkVal] = splitFirstTopLevelComma(args);
    const picked = (dark && darkVal != null ? darkVal : lightVal).trim();
    result =
      result.slice(0, call.start) + picked + result.slice(call.close + 1);
  }
  return result;
}

/**
 * Substitutes every `color-mix(...)`.
 *
 * Runs after `var()` and `light-dark()` so its arguments are already concrete
 * colours. Innermost-first, because Astryx nests them — a hover tint over a
 * token that is itself a mix.
 *
 * An unresolvable mix is left in place rather than replaced: the declaration is
 * then dropped downstream with a warning, which is far easier to diagnose than
 * a silently wrong colour.
 */
function substituteColorMix(value: string): string {
  let result = value;
  let guard = 0;
  while (guard++ < 32) {
    const call = findCall(result, 'color-mix', 0);
    if (call == null) {
      break;
    }
    const args = result.slice(call.open + 1, call.close);
    const resolved = resolveColorMixArgs(args);
    if (resolved == null) {
      break;
    }
    result =
      result.slice(0, call.start) + resolved + result.slice(call.close + 1);
  }
  return result;
}

// --- calc() ---
// Small recursive-descent evaluator over px/unitless arithmetic. Returns the
// resolved px number as a string, or null when it hits anything it cannot
// evaluate (%, em, unresolved keywords) — the calc() is then dropped upstream.

// The lengths the relative units stand for, in px: the viewport's (vw, vh,
// vi, vb and their s/d/l variants) and the nearest container's (cqi, cqw,
// cqb, cqh); see `unitLengths`
type UnitLengths = {vw: number, vh: number, cqi: number, cqb: number};

type CalcParser = {src: string, pos: number, lengths: UnitLengths};

// A value with a viewport or container unit in it, which is only known at the
// element: `100dvh`, `calc(50vw + 10px)`, `10cqb`
const RELATIVE_UNIT = /\d(?:[sdl]?v[whib]|cq[iwbh])\b/;
// A bare length in one of those units
const RELATIVE_LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))([sdl]?v[whib]|cq[iwbh])$/;

/**
 * What the viewport and container units resolve against for an element: the
 * sizes its scope carries (a host surface declares the viewport's, a laid-out
 * container its own; see css/match.js), the window where it carries none —
 * so a page in a split view's column sizes to the column, and a container
 * query unit to the container, once each has laid out.
 */
function unitLengths(scope: ?VarScope): UnitLengths {
  const window = Dimensions.get('window');
  const viewport = scopeSize(scope, VIEWPORT_INLINE_SIZE, VIEWPORT_BLOCK_SIZE);
  const container = scopeSize(
    scope,
    CONTAINER_INLINE_SIZE,
    CONTAINER_BLOCK_SIZE,
  );
  const vw = viewport?.width ?? window.width;
  const vh = viewport?.height ?? window.height;
  return {vw, vh, cqi: container?.width ?? vw, cqb: container?.height ?? vh};
}

function calcSkipWs(p: CalcParser) {
  while (p.pos < p.src.length && p.src[p.pos] === ' ') {
    p.pos++;
  }
}

function calcParsePrimary(p: CalcParser): ?number {
  calcSkipWs(p);
  if (p.src[p.pos] === '(') {
    p.pos++;
    const v = calcParseSum(p);
    calcSkipWs(p);
    if (p.src[p.pos] !== ')') {
      return null;
    }
    p.pos++;
    return v;
  }
  // A nested math function: `calc()` is its argument; `min()`, `max()` and
  // `clamp()` take their arguments in pixels, which is what every argument
  // evaluates to here
  const fn = /^(calc|min|max|clamp)\(/.exec(p.src.slice(p.pos));
  if (fn != null) {
    p.pos += fn[0].length;
    const args: Array<number> = [];
    while (true) {
      const v = calcParseSum(p);
      if (v == null) {
        return null;
      }
      args.push(v);
      calcSkipWs(p);
      if (p.src[p.pos] === ',') {
        p.pos++;
        continue;
      }
      if (p.src[p.pos] !== ')') {
        return null;
      }
      p.pos++;
      break;
    }
    switch (fn[1]) {
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      case 'clamp':
        return args.length === 3
          ? Math.min(Math.max(args[1], args[0]), args[2])
          : null;
      default:
        return args.length === 1 ? args[0] : null;
    }
  }
  // `env(name, fallback)`: the value the app registered for the name, else
  // the fallback, else nothing
  const env = /^env\(\s*([a-z-]+)\s*(?:,\s*)?/.exec(p.src.slice(p.pos));
  if (env != null) {
    p.pos += env[0].length;
    let fallback: ?number = null;
    if (p.src[p.pos] !== ')') {
      fallback = calcParseSum(p);
      if (fallback == null) {
        return null;
      }
      calcSkipWs(p);
    }
    if (p.src[p.pos] !== ')') {
      return null;
    }
    p.pos++;
    const known = environmentResolver?.(env[1]);
    return known ?? fallback;
  }
  const m =
    /^[+-]?(\d+\.?\d*|\.\d+)(px|rem|em|[sdl]?v(?:w|h|i|b)|cq(?:i|w|b|h))?/.exec(
      p.src.slice(p.pos),
    );
  if (m == null) {
    return null;
  }
  p.pos += m[0].length;
  const n = parseFloat(m[0]);
  // rem/em normalize to the same fixed 16px root the rest of the runtime
  // uses, so mixed-unit calcs (Tailwind's `calc(0.5rem - 2px)` radii)
  // evaluate instead of dropping. The viewport and container units are what
  // the scope says they are (`unitLengths`); horizontal writing being the
  // only one here, the inline units are widths and the block units heights.
  const unit = m[2] ?? '';
  if (unit === 'rem' || unit === 'em') {
    return n * 16;
  }
  if (/^[sdl]?v[wi]$/.test(unit)) {
    return (n * p.lengths.vw) / 100;
  }
  if (/^cq[iw]$/.test(unit)) {
    return (n * p.lengths.cqi) / 100;
  }
  if (/^[sdl]?v[hb]$/.test(unit)) {
    return (n * p.lengths.vh) / 100;
  }
  if (/^cq[bh]$/.test(unit)) {
    return (n * p.lengths.cqb) / 100;
  }
  return n;
}

/**
 * What `env()` answers inside a calc: the app registers a reader of the
 * platform's environment variables (the safe-area insets above all), in
 * pixels; a name it does not know falls back to the `env()`'s own fallback.
 */
let environmentResolver: ?(name: string) => ?number = null;

// Bumped with each resolver, which is what the `props()` memo can know of the
// environment's answers changing
let environmentGeneration = 0;

export function setEnvironmentResolver(
  resolve: ?(name: string) => ?number,
): void {
  environmentResolver = resolve;
  environmentGeneration++;
  setEngineEnvironmentResolver(resolve);
}

function calcParseProduct(p: CalcParser): ?number {
  let left = calcParsePrimary(p);
  while (left != null) {
    calcSkipWs(p);
    const op = p.src[p.pos];
    if (op !== '*' && op !== '/') {
      break;
    }
    p.pos++;
    const right = calcParsePrimary(p);
    if (right == null) {
      return null;
    }
    left = op === '*' ? left * right : left / right;
  }
  return left;
}

function calcParseSum(p: CalcParser): ?number {
  let left = calcParseProduct(p);
  while (left != null) {
    calcSkipWs(p);
    const op = p.src[p.pos];
    if (op !== '+' && op !== '-') {
      break;
    }
    p.pos++;
    const right = calcParseProduct(p);
    if (right == null) {
      return null;
    }
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

// A value with a math function in it, which `substituteCalc` evaluates
const MATH_FUNCTION = /\b(?:calc|min|max|clamp)\(/;

function substituteCalc(value: string, scope: ?VarScope): ?string {
  const lengths = unitLengths(scope);
  let result = value;
  while (true) {
    // The outermost math function, whichever it is: `max(2rem, calc(…))` is
    // as much a value as `calc(…)`
    const call =
      findCall(result, 'calc', 0) ??
      findCall(result, 'max', 0) ??
      findCall(result, 'min', 0) ??
      findCall(result, 'clamp', 0);
    if (call == null) {
      break;
    }
    const inner = result.slice(call.open + 1, call.close);
    // The whole call, name included, so a comma-separated `max()`/`min()`/
    // `clamp()` is read by the primary parser's function branch
    const whole = result.slice(call.start, call.close + 1);
    const parser: CalcParser = {src: whole, pos: 0, lengths};
    const evaluated = calcParsePrimary(parser);
    calcSkipWs(parser);
    let replacement: ?string =
      evaluated == null || parser.pos !== whole.length
        ? null
        : `${evaluated}px`;
    if (replacement == null) {
      replacement = calcPercentageWithCancelledLengths(inner, lengths);
    }
    if (replacement == null) {
      return null; // unevaluable calc — drop the declaration
    }
    result =
      result.slice(0, call.start) + replacement + result.slice(call.close + 1);
  }
  return result;
}

/**
 * A sum of one percentage and lengths that add up to nothing is that
 * percentage: `calc(100% + var(--pad-start, 0px) + var(--pad-end, 0px))`,
 * Astryx's way of bleeding a block through its container's padding, is
 * `100%` wherever the padding is unset. A percentage and a non-zero length
 * cannot be added before layout and the declaration stays unevaluable.
 */
function calcPercentageWithCancelledLengths(
  inner: string,
  lengths: UnitLengths,
): ?string {
  const terms: Array<{sign: number, text: string}> = [];
  let depth = 0;
  let sign = 1;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (
      i === inner.length ||
      (depth === 0 &&
        (ch === '+' || ch === '-') &&
        i > start &&
        /\s/.test(inner[i - 1]))
    ) {
      terms.push({sign, text: inner.slice(start, i).trim()});
      sign = ch === '-' ? -1 : 1;
      start = i + 1;
    }
  }
  let percentage: ?string = null;
  for (const term of terms) {
    const pct = term.text.match(/^(-?\d*\.?\d+)%$/);
    if (pct != null) {
      if (percentage != null) {
        return null;
      }
      percentage = `${term.sign * Number(pct[1])}%`;
      continue;
    }
    const parser: CalcParser = {src: term.text, pos: 0, lengths};
    const value = calcParseSum(parser);
    calcSkipWs(parser);
    if (value !== 0 || parser.pos !== term.text.length) {
      return null;
    }
  }
  return percentage;
}

const MAX_VAR_DEPTH = 32;

// The properties whose percentages a fixed element takes against the
// viewport's width, and those against its height
const INLINE_PERCENT_PROPERTIES: Set<string> = new Set([
  'width',
  'minWidth',
  'maxWidth',
  'left',
  'right',
  'inlineSize',
  'minInlineSize',
  'maxInlineSize',
  'insetInlineStart',
  'insetInlineEnd',
]);
const BLOCK_PERCENT_PROPERTIES: Set<string> = new Set([
  'height',
  'minHeight',
  'maxHeight',
  'top',
  'bottom',
  'blockSize',
  'minBlockSize',
  'maxBlockSize',
  'insetBlockStart',
  'insetBlockEnd',
]);

// `value` with each percentage written as the length it is of the viewport,
// for a fixed element's size or inset; `min(100%, …)` then evaluates
function viewportPercentages(
  prop: string,
  value: string,
  scope: ?VarScope,
): string {
  const lengths = unitLengths(scope);
  const base = INLINE_PERCENT_PROPERTIES.has(prop)
    ? lengths.vw
    : BLOCK_PERCENT_PROPERTIES.has(prop)
      ? lengths.vh
      : null;
  if (base == null) {
    return value;
  }
  return value.replace(
    /([+-]?(?:\d+\.?\d*|\.\d+))%/g,
    (_, n: string) => `${(parseFloat(n) * base) / 100}px`,
  );
}

// A scope no element declared into, for a block resolved with none inherited
const EMPTY_SCOPE: VarScope = new Map();

/**
 * `resolveString` for a scope that outlives the call, remembered per scope:
 * the elements under one ancestor share its scope object and resolve the same
 * declarations against it. The colour scheme is part of the answer
 * (`light-dark()`), and so of the key.
 */
const substitutionsByScope: WeakMap<
  VarScope,
  Map<string, string>,
> = new WeakMap();

function resolveStringInScope(
  value: string,
  scope: VarScope,
  final: boolean,
): string {
  let substitutions = substitutionsByScope.get(scope);
  if (substitutions == null) {
    substitutions = new Map();
    substitutionsByScope.set(scope, substitutions);
  } else if (substitutions.size >= MEMO_BOUND) {
    substitutions.clear();
  }
  const key = (final ? '1' : '0') + (currentSchemeIsDark() ? '1' : '0') + value;
  let result = substitutions.get(key);
  if (result == null) {
    result = resolveString(value, scope, 0, final);
    substitutions.set(key, result);
  }
  return result;
}

function resolveString(
  value: string,
  scope: VarScope,
  depth: number,
  final: boolean,
): string {
  if (depth > MAX_VAR_DEPTH) {
    warnOnce('var-cycle', `Custom property cycle while resolving "${value}"`);
    return '';
  }
  let result = substituteVars(value, scope, depth, final);
  result = substituteLightDark(result, currentSchemeIsDark());
  // After both, so a mix's arguments are concrete colours by the time it runs.
  // Before the mixes, whose arguments may be either
  result = substituteOklabColors(result);
  result = substituteColorMix(result);
  result = substituteModernHsl(result);
  return result;
}

/**
 * css-color-4 slash-alpha hsl — `hsl(222.2 47.4% 11.2% / 0.9)`, the form
 * Tailwind emits for `bg-primary/90` — normalized to the comma form RN's
 * color parser accepts. Space-only (no alpha) already parses; only the
 * slash needs rewriting.
 */
function substituteModernHsl(value: string): string {
  if (!value.includes('hsl(') || !value.includes('/')) {
    return value;
  }
  let result = value;
  let cursor = 0;
  while (true) {
    const call = findCall(result, 'hsl', cursor);
    if (call == null) {
      break;
    }
    const inner = result.slice(call.open + 1, call.close);
    const slash = inner.indexOf('/');
    if (slash === -1) {
      cursor = call.close + 1;
      continue;
    }
    const channels = inner
      .slice(0, slash)
      .trim()
      .split(/[\s,]+/);
    const alpha = inner.slice(slash + 1).trim();
    if (channels.length !== 3 || alpha === '') {
      cursor = call.close + 1;
      continue;
    }
    const rewritten = `hsla(${channels.join(', ')}, ${alpha})`;
    result =
      result.slice(0, call.start) + rewritten + result.slice(call.close + 1);
    cursor = call.start + rewritten.length;
  }
  return result;
}

const warned: Set<string> = new Set();
function warnOnce(key: string, message: string) {
  if (__DEV__ && !warned.has(key)) {
    warned.add(key);
    console.warn(`[stylex-rn] ${message}`);
  }
}

function noteOnce(key: string, message: string) {
  if (__DEV__ && !warned.has(key)) {
    warned.add(key);
    console.info(`[stylex-rn] ${message}`);
  }
}

// The `transition-*` longhands React Native's renderer now runs natively
// (css-transitions-1: property/duration/delay/timing-function, off the JS
// thread). Passed through as-is: the native parser reads the same CSS strings
// Astryx writes, kebab-case property names and comma lists included.
// `transition-behavior` is not among them — `allow-discrete` has no native
// counterpart — so it still falls to the drop list below.
const PASSED_THROUGH_TRANSITIONS = new Set([
  'transitionProperty',
  'transitionDuration',
  'transitionDelay',
  'transitionTimingFunction',
  // The animation longhands ride the same path: CSS strings, delivered to the
  // renderer's native engine as-is. `animationName` is NOT here — it resolves
  // through the keyframes registry into `animationKeyframes` below.
  'animationDuration',
  'animationDelay',
  'animationTimingFunction',
  'animationIterationCount',
  'animationDirection',
  'animationFillMode',
]);

// CSS Grid longhands the renderer implements natively (css-grid-2/-3). They
// pass through as CSS strings — `gridTemplateColumns: 'repeat(3, 1fr)'` — and
// the fork's own track-list parser reads them, so nothing here has to
// understand grid. The `grid` prefix stays on the drop list below because the
// SHORTHANDS (`gridColumn`, `gridRow`, `gridTemplate`, `gridGap`) have no RN
// property to map to; only these twelve do.
const PASSED_THROUGH_GRID = new Set([
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridTemplateAreas',
  'gridAutoColumns',
  'gridAutoRows',
  'gridAutoFlow',
  'gridArea',
  'gridColumnStart',
  'gridColumnEnd',
  'gridRowStart',
  'gridRowEnd',
]);

// The element catalog's list containers read `listStyleType` and
// `listStylePosition` as style props (ElementBoxShadowNode), so the longhands
// pass through; the `listStyle` shorthand is split into them by
// `expandShorthand`. The prefix stays on the drop list for anything else.
const PASSED_THROUGH_LIST = new Set([
  'listStyle',
  'listStyleType',
  'listStylePosition',
]);

// CSS anchor positioning, which the top layer reads to place a popover
// (overlay/TopLayerElement.js); it reaches no native prop
const PASSED_THROUGH_ANCHOR = new Set([
  'positionAnchor',
  'positionArea',
  'positionTryFallbacks',
  'positionTryOrder',
]);

// Properties that have no RN analog (yet); dropped silently by prefix.
const DROPPED_PREFIXES = [
  'transition',
  'animation',
  'cursor',
  'outline',
  'willChange',
  'contain',
  'scroll',
  'grid',
  'listStyle',
  'textWrap',
  'overscroll',
  'appearance',
  'positionAnchor',
  'positionArea',
  'positionTry',
  'anchorName',
  'viewTransition',
  'backdropFilter',
  'clipPath',
  'mask',
  'content',
];

function isDroppedProperty(prop: string): boolean {
  let dropped = droppedProperties.get(prop);
  if (dropped == null) {
    dropped = DROPPED_PREFIXES.some(prefix => prop.startsWith(prefix));
    droppedProperties.set(prop, dropped);
  }
  return dropped;
}
const droppedProperties: Map<string, boolean> = new Map();

/**
 * A memo for a pure function of a property and a value string, which every
 * element of a page calls with the same few hundred pairs on every render: the
 * string parsing behind a declaration was the largest part of rendering one.
 * Cleared when it grows past a bound, so a value that changes every frame
 * (an inline width written by an animation) cannot grow it forever.
 */
function memoByPropertyAndValue<T>(
  compute: (prop: string, value: string) => T,
): (prop: string, value: string) => T {
  const memo: Map<string, T> = new Map();
  return (prop, value) => {
    const key = prop + '\u0000' + value;
    if (memo.has(key)) {
      return memo.get(key) as $FlowFixMe;
    }
    if (memo.size >= MEMO_BOUND) {
      memo.clear();
    }
    const result = compute(prop, value);
    memo.set(key, result);
    return result;
  };
}
const MEMO_BOUND = 4096;

// The CSS initial root font size, which `rem` is relative to.
const ROOT_FONT_SIZE = 16;

// A bare number with no unit — for `line-height`, a multiplier of the font
// size rather than a length.
const UNITLESS_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// A length in `em`: a multiple of a font size, so it cannot be converted until
// one is known.
const EM_LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+))em$/;

/**
 * The properties the renderer's text cascade inherits — the ones for which an
 * author's explicit `inherit` has a value to resolve to. Mirrors the
 * `inherited*` fields on `BaseViewProps`; `dynamicTypeRamp` is left out because
 * it is a platform control rather than a CSS property an author writes.
 */
export const INHERITED_PROPERTIES: Set<string> = new Set([
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textTransform',
  'whiteSpace',
  'writingDirection',
]);

// Set while resolving keyframe stops (single-threaded): their transforms
// stay CSS strings for the native animation parser.
let keepTransformStrings = false;

/**
 * A CSS transform string → RN's transform array. RN's own string handling is
 * uneven across arch/flag combinations; emitting the array removes the
 * dependency. Percent translates stay strings (supported); unknown functions
 * abort to the raw string.
 */
export function parseTransformString(
  value: string,
): Array<{[string]: string | number}> | null {
  const out: Array<{[string]: string | number}> = [];
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let matched = false;
  for (let m = re.exec(value); m != null; m = re.exec(value)) {
    matched = true;
    const fn = m[1];
    const args = m[2].split(',').map(a => a.trim());
    const num = (a: string): string | number => {
      if (a.endsWith('%')) {
        return a;
      }
      if (/deg|rad$/.test(a)) {
        return a;
      }
      const n = parseFloat(a);
      return Number.isNaN(n)
        ? a
        : a.endsWith('rem') || a.endsWith('em')
          ? n * 16
          : n;
    };
    switch (fn) {
      case 'translate':
      case 'translate3d':
        if (args[0] != null && args[0] !== '') {
          out.push({translateX: num(args[0])});
        }
        if (args[1] != null && args[1] !== '') {
          out.push({translateY: num(args[1])});
        }
        break;
      case 'translateX':
        out.push({translateX: num(args[0])});
        break;
      case 'translateY':
        out.push({translateY: num(args[0])});
        break;
      case 'scale':
      case 'scale3d':
        out.push({scale: num(args[0]) as $FlowFixMe});
        break;
      case 'scaleX':
        out.push({scaleX: num(args[0]) as $FlowFixMe});
        break;
      case 'scaleY':
        out.push({scaleY: num(args[0]) as $FlowFixMe});
        break;
      case 'rotate':
      case 'rotateZ':
        out.push({rotate: args[0]});
        break;
      case 'skewX':
        out.push({skewX: args[0]});
        break;
      case 'skewY':
        out.push({skewY: args[0]});
        break;
      default:
        return null; // unknown function: hand the string through untouched
    }
  }
  return matched ? out : null;
}

/**
 * CSS shorthands → the longhands React Native understands.
 *
 * RN's style API is longhand-only: `padding: '10px 16px'` is not a value it
 * can parse, so an unexpanded shorthand silently contributes NOTHING — the
 * failure mode is a box with no padding at all, which is exactly what
 * hand-written CSS produced before this existed. (A Tailwind build emits
 * longhands, so that path never noticed.)
 *
 * Returns null when the property is not a shorthand, or when a single value
 * makes the shorthand equivalent to its own name (`padding: 8px` is a valid
 * RN `padding`), so the common case allocates nothing.
 */
function splitTopLevelSpaces(value: string): Array<string> {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current !== '') {
    parts.push(current);
  }
  return parts;
}

// `padding` → the four sides, in CSS's 1/2/3/4-value order.
const BOX_SIDES: {[string]: [string, string, string, string]} = {
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  borderWidth: [
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
  ],
  borderColor: [
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
  ],
  inset: ['top', 'right', 'bottom', 'left'],
};

function sidesFrom(
  parts: Array<string>,
): [string, string, string, string] | null {
  switch (parts.length) {
    case 2:
      return [parts[0], parts[1], parts[0], parts[1]];
    case 3:
      return [parts[0], parts[1], parts[2], parts[1]];
    case 4:
      return [parts[0], parts[1], parts[2], parts[3]];
    default:
      return null;
  }
}

const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

// Memoized: the expansion is read, never written, by its one caller
const expandShorthand: (
  prop: string,
  value: string,
) => {readonly [string]: string} | null = memoByPropertyAndValue(
  expandShorthandUncached,
);

function expandShorthandUncached(
  prop: string,
  value: string,
): {[string]: string} | null {
  const parts = splitTopLevelSpaces(value);

  if (BOX_SIDES[prop] != null) {
    // Even a one-value box shorthand expands: `margin: 0` has to beat a UA
    // default like `margin-block: 1.67em`, and a shorthand cannot outrank a
    // longhand applied natively. Only the box-spacing shorthands do; borders
    // have no UA default to outrank
    const expandsSingle =
      prop === 'margin' || prop === 'padding' || prop === 'inset';
    const sides =
      parts.length === 1
        ? expandsSingle
          ? [parts[0], parts[0], parts[0], parts[0]]
          : null
        : sidesFrom(parts);
    if (sides == null) {
      return null;
    }
    const names = BOX_SIDES[prop];
    return {
      [names[0]]: sides[0],
      [names[1]]: sides[1],
      [names[2]]: sides[2],
      [names[3]]: sides[3],
    };
  }

  if (prop === 'borderRadius' && parts.length >= 2) {
    const sides = sidesFrom(parts);
    if (sides == null) {
      return null;
    }
    // CSS order is TL TR BR BL.
    return {
      borderTopLeftRadius: sides[0],
      borderTopRightRadius: sides[1],
      borderBottomRightRadius: sides[2],
      borderBottomLeftRadius: sides[3],
    };
  }

  // `place-content` / `place-items` / `place-self` set both axes' alignment; a
  // shadcn checkbox says `grid place-content-center` and nothing else
  if (prop === 'placeContent' || prop === 'placeItems') {
    const block = parts[0];
    const inline = parts.length > 1 ? parts[1] : parts[0];
    const alignKey = prop === 'placeContent' ? 'alignContent' : 'alignItems';
    const out: {[string]: string} = {justifyContent: inline};
    out[alignKey] = block;
    if (prop === 'placeContent') {
      // A flex column centres its single child across the cross axis with
      // alignItems, which `place-content` also implies for one item.
      out.alignItems = inline;
    }
    return out;
  }
  if (prop === 'placeSelf') {
    return {
      alignSelf: parts[0],
      justifySelf: parts.length > 1 ? parts[1] : parts[0],
    };
  }

  if (prop === 'gap' && parts.length === 2) {
    return {rowGap: parts[0], columnGap: parts[1]};
  }

  // `list-style: none` is how every Astryx list container turns the marker
  // off. The shorthand takes a type, a position and an image in any order; the
  // renderer has no list-style-image, so that token is dropped with a warning
  // and the other two become the longhands it reads.
  if (prop === 'listStyle') {
    const out: {[string]: string} = {};
    for (const part of parts) {
      if (part === 'inside' || part === 'outside') {
        out.listStylePosition = part;
      } else if (part.startsWith('url(') || part.startsWith('symbols(')) {
        warnOnce(
          `drop:listStyleImage`,
          `Dropping the image from "listStyle" — list-style-image is not supported`,
        );
      } else {
        out.listStyleType = part;
      }
    }
    // A shorthand that was only an image expands to nothing, and that is the
    // right outcome: the marker keeps its default
    return out;
  }

  if (
    prop === 'border' ||
    prop === 'borderTop' ||
    prop === 'borderRight' ||
    prop === 'borderBottom' ||
    prop === 'borderLeft'
  ) {
    const side = prop === 'border' ? '' : prop.slice('border'.length); // Top/Right/…
    const out: {[string]: string} = {};
    for (const part of parts) {
      if (BORDER_STYLES.has(part)) {
        out[`border${side}Style`] = part;
      } else if (/^[\d.]+(px|rem|em)?$/.test(part)) {
        out[`border${side}Width`] = part;
      } else {
        out[`border${side}Color`] = part;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  if (prop === 'flex' && parts.length >= 2) {
    const out: {[string]: string} = {flexGrow: parts[0], flexShrink: parts[1]};
    if (parts.length >= 3) {
      out.flexBasis = parts[2];
    }
    return out;
  }

  if (prop === 'overflow' && parts.length === 2) {
    // Two-value overflow: RN has one axis-agnostic property; the more
    // restrictive of the pair is the honest single answer.
    return {overflow: parts.includes('hidden') ? 'hidden' : parts[0]};
  }

  return null;
}

// Keyword/value fixups per property.
function convertValue(prop: string, value: string): unknown {
  // A transform converts to an array the style keeps, which is not shared
  // between elements, and its conversion depends on `keepTransformStrings`
  return prop === 'transform'
    ? convertValueUncached(prop, value)
    : convertValueMemoized(prop, value);
}
const convertValueMemoized: (prop: string, value: string) => unknown =
  memoByPropertyAndValue(convertValueUncached);

function convertValueUncached(prop: string, value: string): unknown {
  // The `transition-*` longhands reach the native parser as the CSS strings
  // they are. A bare-numeric delay ('0') must not become a number here: the
  // native side reads these props as strings, comma lists and units included.
  if (prop.startsWith('transition') || prop.startsWith('animation')) {
    return value;
  }
  if (prop === 'aspectRatio' && value.includes('/')) {
    // CSS writes a ratio (`1 / 1`); RN wants the number.
    const [w, h] = value.split('/').map(part => parseFloat(part.trim()));
    if (!Number.isNaN(w) && !Number.isNaN(h) && h !== 0) {
      return w / h;
    }
    return value;
  }
  if (prop === 'transform') {
    // Keyframe stops keep the CSS string — the native animation parser reads
    // it (parseUnprocessedTransformString); element styles take RN arrays.
    if (keepTransformStrings) {
      return value;
    }
    const parsed = parseTransformString(value);
    return parsed ?? value;
  }
  if (prop === 'position' && value === 'fixed') {
    // RN has no fixed positioning. Inside a top-layer entry — where every
    // fixed element that matters (dialogs, sheets) actually renders — the
    // entry wrapper IS the viewport, so absolute is exactly fixed semantics.
    // For in-page fixed elements this degrades to absolute-in-container.
    // DOM-CSS-LIMITATION(position-fixed-as-absolute)
    return 'absolute';
  }
  if (prop === 'overflow') {
    if (value === 'clip') {
      return 'hidden';
    }
    if (value === 'auto') {
      return 'scroll';
    }
    return value;
  }
  // Whole-value '<number>px' → number; unitless numerics → number.
  const px = /^[+-]?(\d+\.?\d*|\.\d+)px$/.exec(value);
  if (px != null) {
    return parseFloat(value);
  }
  // `rem` against the CSS initial root size of 16, which Astryx's tokens are
  // written against (`--font-size-base: 0.875rem` = 14px). A rem font size
  // could resolve against the real root through `fontSizeRem`, which on a
  // device tracks the user's text size; no other property has such a channel,
  // so a rem padding or width stays a constant. See
  // `no-author-facing-em-lengths`.
  // DOM-CSS-LIMITATION(rem-fixed-root)
  const rem = /^[+-]?(\d+\.?\d*|\.\d+)rem$/.exec(value);
  if (rem != null) {
    return parseFloat(value) * ROOT_FONT_SIZE;
  }
  const num = /^[+-]?(\d+\.?\d*|\.\d+)$/.exec(value);
  if (num != null && prop !== 'fontFamily') {
    return parseFloat(value);
  }
  return value;
}

/**
 * Interaction state driving pseudo-class resolution. Supplied by
 * `useInteractionState()` (or any DOM pointer/focus wiring) and threaded into
 * `props()`; omitted means "resting", which is what static content passes.
 */
/**
 * What `props()` hands to an element: the resolved RN style, plus any custom
 * properties the element declares so it can publish them to its descendants
 * (CSS inheritance, M3). The astryx JSX runtime consumes `__stylexVars` and
 * strips it before the props reach the host component.
 */
export type StyleXProps = {
  style?: {[string]: unknown},
  // `style` again, under a key a naked `style` attribute cannot clobber (see
  // props()); consumed and stripped by the JSX runtime.
  __stylexStyle?: {[string]: unknown},
  __stylexVars?: {[string]: unknown},
  // The resolved `@starting-style` block: style overrides for the element's
  // FIRST commit only. The element drops them after mount and the renderer's
  // native transitions animate to the real values.
  __startingStyle?: {[string]: unknown},
  // Whether any of these styles is keyed on a pressed pseudo-class, decided in
  // `props()` because `resolveDeclarations` drops every `:`-prefixed key; the
  // element suppresses the platform's own press feedback when so
  __stylexAnswersPress?: boolean,
  // The id of the marker this element carries, which a `when.*` condition on a
  // descendant asks about
  __stylexMarker?: string,
  // `when.*` blocks, condition key to the style it applies, left for the JSX
  // runtime to settle from the element's position in the tree
  __stylexWhen?: {[string]: unknown},
  // The resolved `::backdrop` block, which a modal dialog draws behind itself
  __stylexBackdrop?: {[string]: unknown},
  // The element is a query container (`containerType`), with the names
  // `containerName` gives it, for the container queries of its descendants
  __stylexContainer?: {names: Array<string>},
  // Where the renderer's style engine styles elements: the id the merged
  // styles are registered under, and the `::backdrop` block's
  __cssStyle?: number,
  __cssBackdrop?: number,
  __cssMarker?: string,
};

export type InteractionState = {
  readonly hovered?: boolean,
  readonly pressed?: boolean,
  readonly focused?: boolean,
  readonly disabled?: boolean,
};

// Resting (no interaction) — what static content resolves against.
const RESTING: InteractionState = Object.freeze({});

// Pseudo-class → predicate, in CSS cascade order (later wins), mirroring how
// the browser resolves a StyleX conditional value object. `:focus-visible` is
// treated as `:focus` (RN focus is keyboard/AT-driven, so it already carries
// the "visible" meaning); `:disabled` matches Astryx's aria-disabled styling.
const PSEUDO_ORDER: ReadonlyArray<[string, (InteractionState) => boolean]> = [
  [':hover', s => s.hovered === true],
  [':focus', s => s.focused === true],
  [':focus-visible', s => s.focused === true],
  [':active', s => s.pressed === true],
  [':disabled', s => s.disabled === true],
];

/**
 * The pseudo-classes that answer a finger, as opposed to focus or being
 * disabled. A component that styles either draws its own press, and the
 * platform's feedback must stay out of its way. A touch reports as a hover on
 * the way to a press in this runtime, so a hover style answers the finger too.
 */
const PRESS_ANSWERING_PSEUDOS = [':hover', ':active'];

/**
 * The condition of an `@media` or `@container` key. A container query is
 * answered as a media query over the window, the container's name dropped;
 * see DOM-CSS-DEVIATION(container-query-is-a-media-query) in css/parse.js.
 */
function conditionOf(key: string): string {
  if (key.startsWith('@media')) {
    return key.slice('@media'.length);
  }
  const condition = key.slice('@container'.length);
  const paren = condition.indexOf('(');
  return paren === -1 ? condition : condition.slice(paren);
}

// By the Media Queries grammar `matchMedia` uses, against the window. Astryx
// guards every :hover in `@media (hover: hover)`, which a touchscreen fails.
function mediaQueryApplies(query: string): boolean {
  return mediaQueryListMatches(query, windowMediaEnvironment());
}

/**
 * Picks the applicable branch of a StyleX conditional value object
 * ({default: …, ':hover': …, '@media …': …}) for the given interaction state.
 * Branch values may nest (`{'@media (hover: hover)': {':hover': …}}`), which
 * is exactly how Astryx guards its hover styles.
 */
function pickIfConditional(value: unknown, state: InteractionState): unknown {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? pickConditionalValue(value as $FlowFixMe, state)
    : value;
}

function pickConditionalValue(
  value: {readonly [string]: unknown},
  state: InteractionState,
): unknown {
  let picked: unknown = 'default' in value ? value.default : null;

  for (const key of Object.keys(value)) {
    if (key === 'default') {
      continue;
    }
    if (key.startsWith('@media') || key.startsWith('@container')) {
      if (!mediaQueryApplies(conditionOf(key))) {
        continue;
      }
      const inner = value[key];
      const resolved =
        inner != null && typeof inner === 'object' && !Array.isArray(inner)
          ? pickConditionalValue(inner, state)
          : inner;
      if (resolved != null) {
        picked = resolved;
      }
      continue;
    }
  }

  // Pseudo-classes last, in cascade order, so an active state beats hover.
  for (const [pseudo, matches] of PSEUDO_ORDER) {
    if (!matches(state)) {
      continue;
    }
    for (const key of Object.keys(value)) {
      if (key !== pseudo) {
        continue;
      }
      const inner = value[key];
      const resolved =
        inner != null && typeof inner === 'object' && !Array.isArray(inner)
          ? pickConditionalValue(inner, state)
          : inner;
      if (resolved != null) {
        picked = resolved;
      }
    }
    // Guarded pseudo (e.g. '@media (hover: hover)': {':hover': …}) — walk the
    // applicable media branches for this pseudo too.
    for (const key of Object.keys(value)) {
      if (!key.startsWith('@media') && !key.startsWith('@container')) {
        continue;
      }
      if (!mediaQueryApplies(conditionOf(key))) {
        continue;
      }
      const inner = value[key];
      if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
        // $FlowFixMe[incompatible-use] object branch
        const nested = inner[pseudo];
        if (nested != null) {
          picked =
            typeof nested === 'object' && !Array.isArray(nested)
              ? pickConditionalValue(nested, state)
              : nested;
        }
      }
    }
  }

  return picked;
}

/**
 * The logical border properties React Native has no style property for, each
 * on the physical sides it names in a horizontal writing mode:
 * `border-block-end-width` is the bottom border's width, an inline side the
 * start or end one. React Native draws one border style for all four sides,
 * so a logical side's style is the box's.
 */
const LOGICAL_BORDER_SIDES: Map<string, ReadonlyArray<string>> = new Map([
  ['borderBlockStartWidth', ['borderTopWidth']],
  ['borderBlockEndWidth', ['borderBottomWidth']],
  ['borderBlockWidth', ['borderTopWidth', 'borderBottomWidth']],
  ['borderInlineStartWidth', ['borderStartWidth']],
  ['borderInlineEndWidth', ['borderEndWidth']],
  ['borderInlineWidth', ['borderStartWidth', 'borderEndWidth']],
  ['borderInlineStartColor', ['borderStartColor']],
  ['borderInlineEndColor', ['borderEndColor']],
  ['borderInlineColor', ['borderStartColor', 'borderEndColor']],
  ['borderBlockStartStyle', ['borderStyle']],
  ['borderBlockEndStyle', ['borderStyle']],
  ['borderBlockStyle', ['borderStyle']],
  ['borderInlineStartStyle', ['borderStyle']],
  ['borderInlineEndStyle', ['borderStyle']],
  ['borderInlineStyle', ['borderStyle']],
]);

// In declaration order, so whichever of a physical side and the logical
// property that names it comes later wins, as the cascade has it for two
// declarations of equal standing
function withPhysicalBorders(declared: {[string]: unknown}): {
  [string]: unknown,
} {
  let hasLogical = false;
  for (const prop of Object.keys(declared)) {
    if (LOGICAL_BORDER_SIDES.has(prop)) {
      hasLogical = true;
      break;
    }
  }
  if (!hasLogical) {
    return declared;
  }
  const physical: {[string]: unknown} = {};
  for (const prop of Object.keys(declared)) {
    const sides = LOGICAL_BORDER_SIDES.get(prop);
    if (sides == null) {
      physical[prop] = declared[prop];
      continue;
    }
    for (const side of sides) {
      physical[side] = declared[prop];
    }
  }
  return physical;
}

export function resolveDeclarations(
  declared: {[string]: unknown},
  state: InteractionState,
  inheritedScope: ?VarScope,
  final: boolean,
): {[string]: unknown} {
  const merged = withPhysicalBorders(declared);
  // Custom properties in scope, innermost first: this element's own
  // declarations shadow the inherited ones, which shadow global tokens. The
  // inherited scope is copied only for a block that declares its own, so the
  // common block reads the ancestor's map as it is, with the substitutions
  // already made against it
  let scope: VarScope = inheritedScope ?? EMPTY_SCOPE;
  let ownScope = false;
  for (const key of Object.keys(merged)) {
    if (key.startsWith('--')) {
      if (!ownScope) {
        scope = new Map(inheritedScope ?? []);
        ownScope = true;
      }
      // A custom property declared with conditions (`{default: '0px',
      // ':has(:focus-visible)': ...}`) holds one value at a time, as any
      // other property does; the object itself would read as
      // "[object Object]" inside a var()
      scope.set(key, pickIfConditional(merged[key], state));
    }
  }

  // A fixed element's containing block is the viewport (CSS 2.1 §10.1), and
  // it is laid out here inside a box of its own (the top layer's handle), so
  // its percentages are taken against the viewport before they reach layout
  const fixedPosition = pickIfConditional(merged.position, state) === 'fixed';

  const out: {[string]: unknown} = {};
  // Held back until the whole block is resolved: a unitless line-height and an
  // `em` length both need the font size, which may be declared after them.
  let unitlessLineHeight: ?number = null;
  const emLengths: Map<string, number> = new Map();
  for (const prop of Object.keys(merged)) {
    if (prop.startsWith('--')) {
      continue; // consumed via `scope`
    }
    if (prop.startsWith(':') || prop.startsWith('@')) {
      continue; // whole-block pseudo/at-rules are applied by the caller below
    }
    if (prop === 'animationName') {
      let nameValue = merged[prop];
      if (
        nameValue != null &&
        typeof nameValue === 'object' &&
        !Array.isArray(nameValue)
      ) {
        nameValue = pickConditionalValue(nameValue, state);
      }
      if (typeof nameValue === 'string' && nameValue !== 'none') {
        if (nameValue.includes(',')) {
          warnOnce(
            'animation-list',
            'Multiple animations per element are not supported yet; using none',
          );
        } else {
          const stops = resolveKeyframes(nameValue, state);
          if (stops != null) {
            out.animationKeyframes = JSON.stringify(stops);
          } else {
            warnOnce(
              `keyframes:${nameValue}`,
              `animationName "${nameValue}" is not a stylex.keyframes() value`,
            );
          }
        }
      }
      continue;
    }
    if (
      isDroppedProperty(prop) &&
      !PASSED_THROUGH_TRANSITIONS.has(prop) &&
      !PASSED_THROUGH_GRID.has(prop) &&
      !PASSED_THROUGH_LIST.has(prop) &&
      !PASSED_THROUGH_ANCHOR.has(prop)
    ) {
      // The drop list is the properties this platform has no analog for,
      // every one of them written down in dom-css-limitations.md; a note on
      // the console, once per property, is for whoever wonders where a
      // declaration went, not a warning for the app to show. It stays quiet
      // for transition-* so it does not fire on the one member of the family
      // that genuinely has no analog.
      if (!prop.startsWith('transition')) {
        noteOnce(`drop:${prop}`, `Dropping unsupported property "${prop}"`);
      }
      continue;
    }
    let value = merged[prop];
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      value = pickConditionalValue(value, state);
    }
    if (prop === 'visibility') {
      // DOM-CSS-LIMITATION(visibility-is-opacity): the platform has no
      // visibility; `hidden` draws nothing and takes no touches, which is the
      // visible half of it. The element still holds its box, as on the web,
      // and Tab's label sizer relies on exactly that; it is not hidden from
      // assistive technology.
      if (value === 'hidden' || value === 'collapse') {
        out.opacity = 0;
        out.pointerEvents = 'none';
      }
      continue;
    }
    if (value === null) {
      // An explicit-`inherit` reset (resolveCssForElement): the null must
      // REACH the style, where the merge cancels lower layers and the
      // renderer's text cascade supplies the inherited value.
      out[prop] = null;
      continue;
    }
    if (value == null) {
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[prop] = value;
      continue;
    }
    let resolved = ownScope
      ? resolveString(String(value), scope, 0, final)
      : resolveStringInScope(String(value), scope, final);
    if (fixedPosition && resolved.includes('%')) {
      resolved = viewportPercentages(prop, resolved, inheritedScope);
    }
    // Shorthands expand BEFORE the var() deferral: a shorthand whose value
    // is still an unresolved var() must become deferred LONGHANDS, or it
    // would come back from the element's inheritance pass as a shorthand
    // again and lose to the UA longhands it was meant to override.
    const expanded = expandShorthand(prop, resolved);
    if (expanded != null) {
      for (const longhand of Object.keys(expanded)) {
        const longhandValue = expanded[longhand];
        out[longhand] = longhandValue.includes('var(')
          ? longhandValue
          : convertValue(longhand, longhandValue);
      }
      continue;
    }

    if (resolved.includes('var(')) {
      // An ancestor may still define this custom property (M3); hand the
      // expression to the element to finish. Nothing to warn about.
      out[prop] = resolved;
      continue;
    }
    if (!final && RELATIVE_UNIT.test(resolved)) {
      // A viewport or container unit is the element's to size, against the
      // boxes its scope will name (`unitLengths`)
      out[prop] = resolved;
      continue;
    }
    if (MATH_FUNCTION.test(resolved)) {
      const afterCalc = substituteCalc(resolved, inheritedScope);
      if (afterCalc == null) {
        warnOnce(
          `calc:${prop}`,
          `Dropping "${prop}" — unevaluable calc(): ${resolved}`,
        );
        continue;
      }
      resolved = afterCalc;
    }
    resolved = resolved.trim();
    if (resolved === '') {
      continue;
    }
    if (resolved === 'inherit') {
      // For a property the renderer's cascade inherits, an explicit null says
      // "nothing from this layer": the merge cancels the layers below and the
      // cascade supplies the value, which is what `inherit` computes to. Any
      // other property has no inherited value to fall back on
      if (INHERITED_PROPERTIES.has(prop)) {
        out[prop] = null;
      }
      continue;
    }
    if (prop === 'lineHeight' && UNITLESS_NUMBER.test(resolved)) {
      // Remember it as a RATIO rather than converting now — resolving it needs
      // the font size, which may appear later in this same loop.
      unitlessLineHeight = parseFloat(resolved);
      continue;
    }
    if (prop === 'borderStyle' && resolved === 'none') {
      // `border-style: none` forces the used border width to zero (CSS2
      // §8.5.3); React Native's `borderStyle` has no way to say "no border"
      out.borderWidth = 0;
      continue;
    }
    const relative = RELATIVE_LENGTH.exec(resolved);
    if (relative != null) {
      const lengths = unitLengths(inheritedScope);
      const unit = relative[2];
      const basis = /^[sdl]?v[wi]$/.test(unit)
        ? lengths.vw
        : /^cq[iw]$/.test(unit)
          ? lengths.cqi
          : /^[sdl]?v[hb]$/.test(unit)
            ? lengths.vh
            : lengths.cqb;
      resolved = `${(parseFloat(relative[1]) * basis) / 100}px`;
    }
    const em = EM_LENGTH.exec(resolved);
    if (em != null && prop !== 'fontSize') {
      // On a length, `em` is the element's own computed font size (css-values-4
      // §5.1.1), deferred like the ratio above; on `font-size` it is the
      // inherited size, which falls through to the unresolvable values below
      emLengths.set(prop, parseFloat(em[1]));
      continue;
    }
    out[prop] = convertValue(prop, resolved);
  }

  // A unitless `line-height` multiplies the font size in CSS; React Native's
  // `lineHeight` is absolute points, so the ratio passed through would collapse
  // the line box
  for (const [prop, ratio] of emLengths) {
    const fontSize = out.fontSize;
    if (typeof fontSize === 'number') {
      out[prop] = ratio * fontSize;
    } else if (!final) {
      // The font size is still a var() for the element to finish, and the
      // length is finished with it there, by this same pass run final
      out[prop] = `${ratio}em`;
    } else {
      // The font size is inherited rather than declared here, so there is
      // nothing to multiply by
      // DOM-CSS-LIMITATION(unitless-line-height-needs-local-font-size)
      warnOnce(
        `em-length:${prop}`,
        `Dropping ${prop}: ${ratio}em with no fontSize in the same style to ` +
          'resolve it against.',
      );
    }
  }

  if (unitlessLineHeight != null) {
    const fontSize = out.fontSize;
    if (typeof fontSize === 'number') {
      out.lineHeight = unitlessLineHeight * fontSize;
    } else if (!final) {
      // As for the em lengths above: the ratio waits for the element's pass
      out.lineHeight = String(unitlessLineHeight);
    } else {
      // The font size is inherited and there is no `lineHeightEm` to carry the
      // ratio to the renderer, so `lineHeight` is left unset: wrong spacing
      // beats a collapsed line box. The same missing channel as
      // `no-author-facing-em-lengths`.
      // DOM-CSS-LIMITATION(unitless-line-height-needs-local-font-size)
      warnOnce(
        'unitless-line-height',
        `Dropping unitless line-height ${unitlessLineHeight}: no fontSize in ` +
          'the same style to resolve it against.',
      );
    }
  }

  return out;
}

function flattenInto(target: {[string]: unknown}, item: unknown) {
  if (item == null || item === false || item === true) {
    return;
  }
  if (Array.isArray(item)) {
    for (const inner of item) {
      flattenInto(target, inner);
    }
    return;
  }
  if (typeof item === 'object') {
    for (const key of Object.keys(item)) {
      const value = item[key];
      if (value === null) {
        // CSS `null` means "unset this property".
        delete target[key];
        continue;
      }
      if (value !== undefined) {
        target[key] = value;
      }
    }
  }
}

/**
 * Web StyleX returns `{className, style}`; here the resolved declarations all
 * land in `style` as a plain RN style object.
 */
export function props(...items: Array<unknown>): StyleXProps {
  if (engineEnabled()) {
    return memoizedEngineProps(items);
  }
  return memoizedProps(items);
}

/*
 * `props()` where the renderer's style engine styles elements: the merged
 * styles are registered with the engine once, and the element is handed
 * their id, under `style` (so a component that passes `style` on still
 * passes it) and under a key a later `style` attribute cannot clobber.
 */
type EnginePropsTrieNode = {
  objects: WeakMap<Object, EnginePropsTrieNode>,
  primitives: Map<unknown, EnginePropsTrieNode>,
  answer: ?StyleXProps,
};

const enginePropsTrie: EnginePropsTrieNode = newEnginePropsTrieNode();

function newEnginePropsTrieNode(): EnginePropsTrieNode {
  return {objects: new WeakMap(), primitives: new Map(), answer: null};
}

function memoizedEngineProps(items: Array<unknown>): StyleXProps {
  let node = enginePropsTrie;
  for (const item of items) {
    const isObject =
      item != null && (typeof item === 'object' || typeof item === 'function');
    let next = isObject
      ? node.objects.get(item as $FlowFixMe)
      : node.primitives.get(item);
    if (next == null) {
      next = newEnginePropsTrieNode();
      if (isObject) {
        node.objects.set(item as $FlowFixMe, next);
      } else {
        node.primitives.set(item, next);
      }
    }
    node = next;
  }
  let answer = node.answer;
  if (answer == null) {
    const start = instrumenting() ? performance.now() : 0;
    answer = engineProps(items);
    node.answer = answer;
    if (start !== 0) {
      counters.props++;
      counters.propsMs += performance.now() - start;
    }
  }
  return answer;
}

function engineProps(items: Array<unknown>): StyleXProps {
  const merged: {[string]: unknown} = {};
  for (const item of items) {
    flattenInto(merged, item);
  }
  // A style handed back in (a component merging its caller's style into its
  // own) brings its declarations, and the id it carried is not one
  delete merged.__cssStyle;
  // A dialog's `::backdrop` is a box of its own, styled under its own id
  const backdrop = merged['::backdrop'];
  delete merged['::backdrop'];
  // A marker is a class the element carries, which a `when.*` condition's
  // selector names
  const marker = merged.marker;
  delete merged.marker;
  const id = registerEngineStyle(merged);
  const result: StyleXProps = {};
  if (typeof marker === 'symbol') {
    const markerId = MARKER_ID_BY_SYMBOL.get(marker);
    if (markerId != null) {
      result.__cssMarker = markerId;
    }
  }
  if (id !== 0) {
    result.style = standInFor(id, merged) as $FlowFixMe;
    result.__cssStyle = id;
  }
  if (backdrop != null && typeof backdrop === 'object') {
    // $FlowFixMe[incompatible-call] the block's declarations
    const backdropId = registerEngineStyle(backdrop);
    if (backdropId !== 0) {
      result.__cssBackdrop = backdropId;
    }
  }
  return result;
}

/**
 * `props()` for an argument list it has answered before, while the
 * environment its `@media` keys read is unchanged.
 *
 * Components call `props()` with the same `stylex.create` objects on every
 * render. Answering with the same object is cheaper than merging and resolving
 * them again, and it is also what lets the element that receives the style see
 * that nothing changed. The answers are kept in a trie over the arguments:
 * objects under weak keys, so a style made for one render is forgotten with
 * it, and the rest (`false` from `cond && style`, a string) under strong ones.
 */
type PropsTrieNode = {
  objects: WeakMap<Object, PropsTrieNode>,
  primitives: Map<unknown, PropsTrieNode>,
  answer: ?StyleXProps,
};

let propsTrie: PropsTrieNode = newPropsTrieNode();
let propsEnvironment: string = '';

function newPropsTrieNode(): PropsTrieNode {
  return {objects: new WeakMap(), primitives: new Map(), answer: null};
}

function memoizedProps(items: Array<unknown>): StyleXProps {
  const environment = mediaEnvironmentKey();
  if (environment !== propsEnvironment) {
    propsEnvironment = environment;
    propsTrie = newPropsTrieNode();
  }
  let node = propsTrie;
  for (const item of items) {
    const isObject =
      item != null && (typeof item === 'object' || typeof item === 'function');
    let next = isObject
      ? node.objects.get(item as $FlowFixMe)
      : node.primitives.get(item);
    if (next == null) {
      next = newPropsTrieNode();
      if (isObject) {
        node.objects.set(item as $FlowFixMe, next);
      } else {
        node.primitives.set(item, next);
      }
    }
    node = next;
  }
  if (node.answer == null) {
    node.answer = propsWithState(RESTING, ...items);
  }
  return node.answer;
}

// What `@media` keys and `env()` can read, as a key that changes when any of
// it does. An app whose `env()` answers change registers a new resolver.
function mediaEnvironmentKey(): string {
  const environment = windowMediaEnvironment();
  return `${environment.width}x${environment.height}@${environment.resolution} ${environment.colorScheme} ${String(environment.reducedMotion)} ${environmentGeneration}`;
}

/**
 * `props()` resolved against an interaction state — the RN analog of the
 * browser matching `:hover` / `:active` / `:focus-visible`. Style blocks keyed
 * by a whole pseudo-class (`{':hover': {backgroundColor: …}}`) merge over the
 * base declarations when their state matches (cascade order, so `:active`
 * beats `:hover`), after which per-property conditional values resolve against
 * the same state. Astryx's `@media (hover: hover)` guards are honored: on
 * touch platforms the hover branch never applies.
 *
 * Feed it from `useInteractionState()`, whose handlers are plain DOM pointer
 * events on the element — no Pressable, no gesture responder.
 */
export function propsWithState(
  state: InteractionState,
  ...items: Array<unknown>
): StyleXProps {
  const merged: {[string]: unknown} = {};
  for (const item of items) {
    flattenInto(merged, item);
  }

  // Whole-block pseudo-classes (including ones nested under an applicable
  // @media guard), applied in cascade order over the base declarations.
  for (const [pseudo, matches] of PSEUDO_ORDER) {
    if (!matches(state)) {
      continue;
    }
    const block = merged[pseudo];
    if (block != null && typeof block === 'object') {
      flattenInto(merged, block);
    }
    for (const key of Object.keys(merged)) {
      if (!key.startsWith('@media')) {
        continue;
      }
      if (!mediaQueryApplies(key.slice('@media'.length))) {
        continue;
      }
      const mediaBlock = merged[key];
      if (mediaBlock != null && typeof mediaBlock === 'object') {
        // $FlowFixMe[incompatible-use] object branch
        const nested = mediaBlock[pseudo];
        if (nested != null && typeof nested === 'object') {
          flattenInto(merged, nested);
        }
      }
    }
  }

  // Custom properties this element declares — carried on the props so the
  // element can publish them to its descendants (CSS inheritance, M3). They
  // are resolved against the element's own scope so a declaration like
  // `--container-padding-inline-start: var(--astryx-card-padding, 16px)`
  // reaches descendants already substituted where possible.
  let declaredVars: ?{[string]: unknown} = null;
  for (const key of Object.keys(merged)) {
    if (key.startsWith('--')) {
      if (declaredVars == null) {
        declaredVars = {} as {[string]: unknown};
      }
      declaredVars[key] = pickIfConditional(merged[key], state);
    }
  }

  /*
   * Whether these styles answer a press is decided here, since
   * `resolveDeclarations` drops every `:`-prefixed key as it converts.
   */
  const answersPress = PRESS_ANSWERING_PSEUDOS.some(
    pseudo => merged[pseudo] != null,
  );

  // A query container is a fact about the element for its descendants'
  // container queries, not a style of its own; the JSX runtime publishes it
  const container = containerFromDeclarations(
    pickIfConditional(merged.containerType, state),
    pickIfConditional(merged.containerName, state),
    pickIfConditional(merged.container, state),
  );
  delete merged.containerType;
  delete merged.containerName;
  delete merged.container;

  const style = resolveDeclarations(merged, state, null, false);
  const result: StyleXProps = {};
  if (Object.keys(style).length > 0) {
    result.style = style;
    // The same object under a stable duplicate key, so the web idiom
    // `{...stylex.props(...)} style={{width}}` survives: on the web those are
    // separate channels (className + inline style), but here both are
    // `style`, and the later attribute clobbers the spread. The JSX runtime
    // sees the duplicate and layers the inline override ON TOP of the
    // resolved styles instead — inline wins per property, exactly as an
    // inline style beats a class.
    result.__stylexStyle = style;
  }
  if (answersPress) {
    result.__stylexAnswersPress = true;
  }
  if (declaredVars != null) {
    result.__stylexVars = declaredVars;
  }
  if (container != null) {
    result.__stylexContainer = container;
  }
  // The `::backdrop` a dialog paints behind itself in the top layer
  // (HTML §15.3.5), resolved like the element's own declarations; the JSX
  // runtime draws it under a modal dialog
  const backdrop = merged['::backdrop'];
  if (backdrop != null && typeof backdrop === 'object') {
    result.__stylexBackdrop = resolveDeclarations(
      {...(backdrop as $FlowFixMe)},
      state,
      null,
      false,
    );
  }

  /*
   * A marker applied to this element and the `when.*` blocks that depend on one
   * cannot be settled here, since `props()` has no view of the tree: the marker
   * is surfaced for the element to publish and the blocks deferred for it to
   * evaluate, the same split as a `var()` an ancestor might still define.
   */
  const ownMarker = merged.marker;
  if (typeof ownMarker === 'symbol') {
    const id = MARKER_ID_BY_SYMBOL.get(ownMarker);
    if (id != null) {
      result.__stylexMarker = id;
    }
    // Never a style declaration; it exists to be pointed at.
    delete (result.style as $FlowFixMe)?.marker;
  }
  const deferredWhen: {[string]: unknown} = {};
  let hasDeferredWhen = false;
  for (const key of Object.keys(merged)) {
    if (key.startsWith(':where-')) {
      deferredWhen[key] = merged[key];
      hasDeferredWhen = true;
    }
  }
  if (hasDeferredWhen) {
    result.__stylexWhen = deferredWhen;
  }

  // `@starting-style` (css-transitions-2 §3): the values the element renders
  // with on its first commit and drops after mount; the renderer's own CSS
  // transitions animate from them to the real values, so any transitionable
  // property works
  const startingBlock = merged['@starting-style'];
  if (startingBlock != null && typeof startingBlock === 'object') {
    // Resolved as FINAL. Everywhere else an unknown `var()` is deferred so an
    // ancestor can still supply it at the element; these values are the first
    // committed frame, so there is no later chance — deferring one would
    // commit a raw `var()` string as a style value. Final resolution applies
    // the fallback instead.
    const resolvedStarting = resolveDeclarations(
      {...(startingBlock as $FlowFixMe)},
      state,
      null,
      true,
    );
    if (Object.keys(resolvedStarting).length > 0) {
      result.__startingStyle = resolvedStarting;
    }
  }
  return result;
}

/**
 * Finishes a style produced by `props()` at the element, with the custom
 * properties inherited from ancestors in scope (M3). Values still holding
 * `var()` references — the ones nothing local or global defined — resolve
 * here, taking their fallbacks only now that the full scope is known.
 *
 * Returns the resolved style plus the scope to hand to descendants: the
 * inherited scope with this element's own declarations layered on top, which
 * is how `Section` can reset `--container-padding-*` to `0px` for its
 * subtree while reading its ancestor's value for itself.
 */
export function resolveInherited(
  style: ?{[string]: unknown},
  declaredVars: ?{[string]: unknown},
  inheritedScope: ?VarScope,
): {
  style: ?{[string]: unknown},
  scope: ?VarScope,
} {
  let scope: ?VarScope = inheritedScope;
  if (declaredVars != null) {
    scope = new Map(inheritedScope ?? []);
    for (const key of Object.keys(declaredVars)) {
      // Resolve the declaration itself against the scope it sees, so
      // descendants read a value rather than another var() chain.
      const raw = declaredVars[key];
      scope.set(
        key,
        typeof raw === 'string' ? resolveString(raw, scope, 0, false) : raw,
      );
    }
  }

  if (style == null) {
    return {style: null, scope};
  }

  // What the eager pass left for here: a var() it could not resolve, and a
  // unitless line-height or em length waiting on a font size that was one.
  // Fast path: nothing deferred.
  let needsWork = false;
  for (const prop of Object.keys(style)) {
    const value = style[prop];
    if (typeof value === 'string' && isDeferredValue(prop, value)) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) {
    return {style, scope};
  }

  // The deferred declarations run through the same pipeline as the eager
  // pass, now final: a token's default applies where no ancestor shadowed
  // it, a ratio multiplies the font size resolved beside it, a shorthand
  // that was a var() expands. Every string goes, since a resolved one comes
  // back unchanged and the font size is needed in the same pass; converted
  // values (numbers, transform arrays, `inherit` nulls) are kept as they are.
  const pending: {[string]: unknown} = {};
  const finished: {[string]: unknown} = {};
  for (const prop of Object.keys(style)) {
    const value = style[prop];
    if (typeof value === 'string' || (prop === 'fontSize' && value != null)) {
      pending[prop] = value;
    } else {
      finished[prop] = value;
    }
  }
  const resolved = resolveDeclarations(pending, RESTING, scope, true);
  for (const prop of Object.keys(resolved)) {
    finished[prop] = resolved[prop];
  }
  return {style: finished, scope};
}

function isDeferredValue(prop: string, value: string): boolean {
  return (
    value.includes('var(') ||
    RELATIVE_UNIT.test(value) ||
    (prop === 'lineHeight' && UNITLESS_NUMBER.test(value)) ||
    (prop !== 'fontSize' && EM_LENGTH.test(value))
  );
}

// Web API parity stubs (unused by the vendored components, kept so imports
// don't crash).
export function attrs(...items: Array<unknown>): StyleXProps {
  return props(...items);
}

export function createTheme(_vars: unknown, _overrides: unknown): RawStyle {
  warnOnce('createTheme', 'stylex.createTheme() is not supported on RN yet');
  return {};
}

/**
 * Markers and `stylex.when.*`: conditions that depend on another element. The
 * shapes are `@stylexjs/stylex@0.19`'s own declarations:
 *   defineMarker(): MapNamespace<{readonly marker: symbol}>
 *   when.ancestor(pseudo?, marker?): `:where-ancestor(${Pseudo}, ${Symbol})`
 *   when.descendant / siblingBefore / siblingAfter / anySibling: likewise
 * `Pseudo` is `:${string}` or `[${string}]`; both arguments are optional, and
 * without a marker the condition refers to the default marker. A marker is a
 * style namespace applied through `props()`, with a symbol for its identity.
 * Upstream's runtime throws from these and expects the Babel plugin to have
 * rewritten them into class names and a `:has()`-style selector; without a
 * compiler they are evaluated at runtime, in the two-pass shape custom
 * properties use: `props()` defers the blocks onto its result, and
 * `resolveWhen` finishes them at the element once the marker state is known.
 */

// Symbols are not embeddable in a string, so each marker also gets a stable id
// that can appear in the condition key. The registry is keyed by symbol so two
// markers never collide, and lookups from a key go through `MARKER_BY_ID`.
const MARKER_ID_BY_SYMBOL: Map<symbol, string> = new Map();
const MARKER_BY_ID: Map<string, symbol> = new Map();
let markerSequence = 0;

/**
 * Whether any marker exists at all. The bookkeeping markers need (an element
 * knowing whether it is a first or last child) costs a walk of every
 * intrinsic's children, which an app that never calls `defineMarker` must not
 * pay. See `hasMarkers()`.
 */
export function hasMarkers(): boolean {
  return markerSequence > 0;
}

export function defineMarker(): {readonly marker: symbol} {
  markerSequence += 1;
  const symbol = Symbol(`stylex.marker.${markerSequence}`);
  const id = `m${markerSequence}`;
  MARKER_ID_BY_SYMBOL.set(symbol, id);
  MARKER_BY_ID.set(id, symbol);
  return {marker: symbol};
}

const DEFAULT_MARKER: {readonly marker: symbol} = defineMarker();

export function defaultMarker(): {readonly marker: symbol} {
  return DEFAULT_MARKER;
}

/** The id for a marker namespace, or the default marker's when absent. */
function markerIdOf(namespace: unknown): string {
  const symbol =
    namespace != null && typeof namespace === 'object'
      ? // $FlowFixMe[prop-missing] a marker namespace
        namespace.marker
      : null;
  const id =
    typeof symbol === 'symbol' ? MARKER_ID_BY_SYMBOL.get(symbol) : undefined;
  if (id != null) {
    return id;
  }
  return MARKER_ID_BY_SYMBOL.get(DEFAULT_MARKER.marker) ?? 'm1';
}
const WHEN_KIND_SELECTOR: {[string]: string} = {
  ancestor: 'where-ancestor',
  descendant: 'where-descendant',
  siblingBefore: 'where-sibling-before',
  siblingAfter: 'where-sibling-after',
  anySibling: 'where-any-sibling',
};

/**
 * Whether any `when.descendant` condition exists in the program. Answering one
 * costs an upward registration from every marked element and a second render of
 * the asking element (see `useDescendantMarkers`), which a tree that never asks
 * must not pay; settled at module scope, since the keys are built when a
 * component's styles are defined.
 */
let descendantConditionCount = 0;

export function hasDescendantConditions(): boolean {
  return descendantConditionCount > 0;
}

function whenKey(kind: string, pseudo: unknown, marker: unknown): string {
  const selector = typeof pseudo === 'string' ? pseudo : ':scope';
  if (kind === 'descendant') {
    descendantConditionCount += 1;
  }
  return `:${WHEN_KIND_SELECTOR[kind]}(${selector}, ${markerIdOf(marker)})`;
}

/** Parses a key produced by `when.*` back into its parts. */
export function parseWhenKey(
  key: string,
): ?{kind: string, pseudo: string, marker: string} {
  const match = /^:where-([a-z-]+)\(([^,]+), ([^)]+)\)$/.exec(key);
  if (match == null) {
    return null;
  }
  const kind = match[1];
  return {kind, pseudo: match[2], marker: match[3]};
}

export const when: {
  ancestor: (pseudo?: unknown, marker?: unknown) => string,
  descendant: (pseudo?: unknown, marker?: unknown) => string,
  siblingBefore: (pseudo?: unknown, marker?: unknown) => string,
  siblingAfter: (pseudo?: unknown, marker?: unknown) => string,
  anySibling: (pseudo?: unknown, marker?: unknown) => string,
} = {
  ancestor: (pseudo?: unknown, marker?: unknown) =>
    whenKey('ancestor', pseudo, marker),
  descendant: (pseudo?: unknown, marker?: unknown) =>
    whenKey('descendant', pseudo, marker),
  siblingBefore: (pseudo?: unknown, marker?: unknown) =>
    whenKey('siblingBefore', pseudo, marker),
  siblingAfter: (pseudo?: unknown, marker?: unknown) =>
    whenKey('siblingAfter', pseudo, marker),
  anySibling: (pseudo?: unknown, marker?: unknown) =>
    whenKey('anySibling', pseudo, marker),
};

/**
 * The state of every marker an element can see, and of its own position.
 *
 * `ancestors` maps a marker id to the pseudo-classes the nearest ancestor
 * carrying that marker matches; `siblings` does the same for the markers on
 * this element's previous and following siblings. Both come from the JSX
 * runtime, which is the only place that knows the shape of the tree.
 */
export type MarkerState = {
  readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>,
  readonly before: ReadonlyMap<string, ReadonlySet<string>>,
  readonly after: ReadonlyMap<string, ReadonlySet<string>>,
  /*
   * The union of what every marked descendant matches (`:has()` semantics),
   * collected by registration because it travels upward; see
   * `useDescendantMarkers`.
   */
  readonly descendants: ReadonlyMap<string, ReadonlySet<string>>,
};

export const EMPTY_MARKER_STATE: MarkerState = {
  ancestors: new Map(),
  before: new Map(),
  after: new Map(),
  descendants: new Map(),
};

/** Whether a single `when.*` condition holds for `state`. */
export function whenConditionApplies(key: string, state: MarkerState): boolean {
  const parsed = parseWhenKey(key);
  if (parsed == null) {
    return false;
  }
  const {kind, pseudo, marker} = parsed;
  switch (kind) {
    // `parseWhenKey` returns the relation WITHOUT the `where-` prefix, which
    // the key carries only to look like the selector it stands in for.
    case 'ancestor':
      return state.ancestors.get(marker)?.has(pseudo) === true;
    case 'sibling-before':
      return state.before.get(marker)?.has(pseudo) === true;
    case 'sibling-after':
      return state.after.get(marker)?.has(pseudo) === true;
    case 'any-sibling':
      return (
        state.before.get(marker)?.has(pseudo) === true ||
        state.after.get(marker)?.has(pseudo) === true
      );
    case 'descendant':
      /*
       * `:has()` semantics: one matching descendant is enough. The only relation
       * whose answer travels up, so it cannot be settled during the asking element's
       * first render; marked descendants register in a layout effect and the asker
       * re-renders before paint. That extra render is paid only by trees that ask.
       */
      return state.descendants.get(marker)?.has(pseudo) === true;
    default:
      return false;
  }
}

/**
 * Applies the deferred `when.*` blocks a `props()` result carries, given the
 * marker state at the element. Returns the style to render with.
 */
export function resolveWhen(
  style: {[string]: unknown} | null,
  deferred: ?{[string]: unknown},
  state: MarkerState,
  inheritedScope: ?VarScope,
): {[string]: unknown} | null {
  if (deferred == null) {
    return style;
  }
  let result = style;
  for (const key of Object.keys(deferred)) {
    if (!whenConditionApplies(key, state)) {
      continue;
    }
    const block = deferred[key];
    if (block == null || typeof block !== 'object') {
      continue;
    }
    // A matching block layers over the base declarations, as the conditional
    // rule authored after the unconditional one wins at equal specificity, and
    // is resolved against the element's own custom-property scope like them
    result = {
      ...(result ?? {}),
      ...resolveDeclarations({...block}, RESTING, inheritedScope, true),
    };
  }
  return result;
}

export type StyleXStyles = unknown;
export type {VarScope};

export default {
  create,
  props,
  propsWithState,
  resolveInherited,
  attrs,
  defineVars,
  keyframes,
  firstThatWorks,
  createTheme,
  when,
  defineMarker,
  defaultMarker,
};
