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
 * A React Native runtime for StyleX — the styling half of running Astryx
 * (Meta's StyleX-authored design system) on this fork.
 *
 * On web, `stylex.create()` is compiled to atomic CSS classes at build time.
 * Here nothing is compiled: `create()` keeps the raw style objects and
 * `props()` resolves them at render time into a plain React Native `style`
 * object. Metro aliases `@stylexjs/stylex` to this module
 * (see packages/rn-tester/metro.config.js), so vendored Astryx sources run
 * unmodified.
 *
 * Supported CSS machinery (the pieces Astryx actually leans on):
 *  - `defineVars()` design tokens → a global token table; token references
 *    (`var(--spacing-4)`) resolve recursively, including chained
 *    `var(--x, var(--y, 16px))` fallbacks.
 *  - element-local custom properties (`'--_card-radius': …`) declared in the
 *    same `props()` call, shadowing global tokens.
 *  - `light-dark(a, b)` resolved against the current Appearance color scheme
 *    (re-resolved every render, so `useColorScheme()` re-renders retheme).
 *  - `calc()` with px/unitless arithmetic (`calc(var(--p) - 1px)`).
 *  - conditional values (`{default: …, ':hover': …, '@media …': …}`) — the
 *    `default` branch applies; interaction/media branches are inert for now.
 *  - final values: `'16px'` → 16, keywords/colors/shadow lists stay strings
 *    (the fork's CSS value parsers take them natively, e.g. boxShadow).
 *
 * Deliberately not here yet: cross-element custom-property inheritance
 * (a parent's `--container-padding-*` read by a *child* element — needs a
 * context channel), pseudo-class state styling, transitions/animations,
 * keyframes. Unsupported declarations are dropped with a one-time dev warn.
 */

import {resolveColorMixArgs} from './colorMix';
import {
  AccessibilityInfo,
  Appearance,
  Platform,
  processColor,
} from 'react-native';

type RawStyle = {readonly [string]: unknown};

// -----------------------------------------------------------------------------
// Global design-token table (defineVars)
// -----------------------------------------------------------------------------

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
  // $FlowFixMe[incompatible-type] same keys, var-reference values
  return refs;
}

// -----------------------------------------------------------------------------
// create / keyframes / firstThatWorks
// -----------------------------------------------------------------------------

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
    const resolved = resolveDeclarations(
      {...(frames[key] as $FlowFixMe)},
      state,
      null,
      true,
    );
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

// -----------------------------------------------------------------------------
// Value resolution: var() / light-dark() / calc()
// -----------------------------------------------------------------------------

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
  const raw = scope.has(name) ? scope.get(name) : tokenTable.get(name);
  if (raw == null) {
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

type CalcParser = {src: string, pos: number};

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
  const m = /^[+-]?(\d+\.?\d*|\.\d+)(px)?/.exec(p.src.slice(p.pos));
  if (m == null) {
    return null;
  }
  p.pos += m[0].length;
  return parseFloat(m[0]);
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

function substituteCalc(value: string): ?string {
  let result = value;
  while (true) {
    const call = findCall(result, 'calc', 0);
    if (call == null) {
      break;
    }
    const inner = result.slice(call.open + 1, call.close);
    const parser: CalcParser = {src: inner, pos: 0};
    const evaluated = calcParseSum(parser);
    calcSkipWs(parser);
    if (evaluated == null || parser.pos !== inner.length) {
      return null; // unevaluable calc — drop the declaration
    }
    result =
      result.slice(0, call.start) +
      `${evaluated}px` +
      result.slice(call.close + 1);
  }
  return result;
}

const MAX_VAR_DEPTH = 32;

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
  result = substituteColorMix(result);
  return result;
}

// -----------------------------------------------------------------------------
// Property conversion to React Native styles
// -----------------------------------------------------------------------------

const warned: Set<string> = new Set();
function warnOnce(key: string, message: string) {
  if (__DEV__ && !warned.has(key)) {
    warned.add(key);
    console.warn(`[stylex-rn] ${message}`);
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
  'whiteSpace',
];

function isDroppedProperty(prop: string): boolean {
  return DROPPED_PREFIXES.some(prefix => prop.startsWith(prefix));
}

// The CSS initial root font size, which `rem` is relative to.
const ROOT_FONT_SIZE = 16;

// A bare number with no unit — for `line-height`, a multiplier of the font
// size rather than a length.
const UNITLESS_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// Keyword/value fixups per property.
function convertValue(prop: string, value: string): unknown {
  // The `transition-*` longhands reach the native parser as the CSS strings
  // they are. A bare-numeric delay ('0') must not become a number here: the
  // native side reads these props as strings, comma lists and units included.
  if (prop.startsWith('transition') || prop.startsWith('animation')) {
    return value;
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
  // `rem` against the CSS initial root font size. Astryx's whole type scale is
  // authored in rem (`--font-size-base: 0.875rem` = 14px), so without this
  // every font size reaches RN as a string and is rejected outright —
  // "Error while converting prop 'fontSize': Value is a string, expected a
  // number", once per text element.
  //
  // 16 is the root size the tokens are written against, and their own comments
  // confirm it: 0.875 × 16 = 14, 0.75 × 16 = 12. RN has no document root to
  // read a user-adjusted value from, so this is a constant rather than a
  // lookup. DOM-CSS-LIMITATION(rem-fixed-root)
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

// The OS accessibility setting behind `prefers-reduced-motion`, cached so the
// synchronous style-resolution path can read it. Seeded and kept fresh by
// AccessibilityInfo; until the first async answer arrives, motion is allowed
// (the web default).
let reduceMotionEnabled = false;
if (AccessibilityInfo != null) {
  AccessibilityInfo.isReduceMotionEnabled?.()?.then?.(
    (enabled: boolean) => {
      reduceMotionEnabled = enabled === true;
    },
    () => {},
  );
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', enabled => {
    reduceMotionEnabled = enabled === true;
  });
}

// `@media (hover: hover)` / `(pointer: coarse)` are the capability guards
// Astryx wraps every :hover in; resolve them against the platform rather than
// dropping the branch (touch → no hover, coarse pointer).
function mediaQueryApplies(query: string): boolean {
  const q = query.toLowerCase();
  if (q.includes('hover: hover')) {
    return Platform.OS !== 'ios' && Platform.OS !== 'android';
  }
  if (q.includes('hover: none')) {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }
  if (q.includes('pointer: coarse')) {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }
  if (q.includes('pointer: fine')) {
    return Platform.OS !== 'ios' && Platform.OS !== 'android';
  }
  if (q.includes('prefers-reduced-motion')) {
    // Tracks the OS "Reduce Motion" setting (cached below; style resolution
    // is synchronous). Before animations existed this branch hard-coded
    // `reduce` as matching so every vendored `animationName: 'none'` fallback
    // won — with the renderer running animations for real, that guard had
    // become the thing disabling them.
    return q.includes('reduce') === reduceMotionEnabled;
  }
  // Width/feature queries we cannot evaluate: keep the default branch.
  return false;
}

/**
 * Picks the applicable branch of a StyleX conditional value object
 * ({default: …, ':hover': …, '@media …': …}) for the given interaction state.
 * Branch values may nest (`{'@media (hover: hover)': {':hover': …}}`), which
 * is exactly how Astryx guards its hover styles.
 */
function pickConditionalValue(
  value: {readonly [string]: unknown},
  state: InteractionState,
): unknown {
  let picked: unknown = 'default' in value ? value.default : null;

  for (const key of Object.keys(value)) {
    if (key === 'default') {
      continue;
    }
    if (key.startsWith('@media')) {
      if (!mediaQueryApplies(key.slice('@media'.length))) {
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
      if (!key.startsWith('@media')) {
        continue;
      }
      if (!mediaQueryApplies(key.slice('@media'.length))) {
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

export function resolveDeclarations(
  merged: {[string]: unknown},
  state: InteractionState,
  inheritedScope: ?VarScope,
  final: boolean,
): {[string]: unknown} {
  // Custom properties in scope, innermost first: this element's own
  // declarations shadow the inherited ones, which shadow global tokens.
  const scope: VarScope = new Map(inheritedScope ?? []);
  for (const key of Object.keys(merged)) {
    if (key.startsWith('--')) {
      scope.set(key, merged[key]);
    }
  }

  const out: {[string]: unknown} = {};
  // Held back until the whole block is resolved: a unitless line-height needs
  // the font size, which may be declared after it.
  let unitlessLineHeight: ?number = null;
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
    if (isDroppedProperty(prop) && !PASSED_THROUGH_TRANSITIONS.has(prop)) {
      // `transition-behavior` and the rest of the drop list. The warning stays
      // quiet for transition-* so it does not fire on the one member of the
      // family that genuinely has no analog.
      if (!prop.startsWith('transition')) {
        warnOnce(`drop:${prop}`, `Dropping unsupported property "${prop}"`);
      }
      continue;
    }
    let value = merged[prop];
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      value = pickConditionalValue(value, state);
    }
    if (value == null) {
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[prop] = value;
      continue;
    }
    let resolved = resolveString(String(value), scope, 0, final);
    if (resolved.includes('var(')) {
      // An ancestor may still define this custom property (M3); hand the
      // expression to the element to finish. Nothing to warn about.
      out[prop] = resolved;
      continue;
    }
    if (resolved.includes('calc(')) {
      const afterCalc = substituteCalc(resolved);
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
    if (prop === 'lineHeight' && UNITLESS_NUMBER.test(resolved)) {
      // Remember it as a RATIO rather than converting now — resolving it needs
      // the font size, which may appear later in this same loop.
      unitlessLineHeight = parseFloat(resolved);
      continue;
    }
    out[prop] = convertValue(prop, resolved);
  }

  // A unitless `line-height` is a MULTIPLIER of the font size in CSS
  // (`line-height: 1.6667` on 12px text means 20px). React Native's
  // `lineHeight` is absolute points, so passing the ratio straight through
  // told RN the line was 1.6667pt tall — collapsing the line box, which with
  // `alignItems: center` pushed the text to the top of its container. Astryx
  // writes every line-height this way, so it affected all of its text.
  if (unitlessLineHeight != null) {
    const fontSize = out.fontSize;
    if (typeof fontSize === 'number') {
      out.lineHeight = unitlessLineHeight * fontSize;
    } else {
      // The font size is inherited rather than declared here, and RN gives no
      // way to resolve it at this point. Emitting the bare ratio would be
      // actively wrong, so leave `lineHeight` unset and let RN use its own —
      // wrong spacing beats a collapsed line box.
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

// -----------------------------------------------------------------------------
// props()
// -----------------------------------------------------------------------------

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
  return propsWithState(RESTING, ...items);
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
      declaredVars[key] = merged[key];
    }
  }

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
  if (declaredVars != null) {
    result.__stylexVars = declaredVars;
  }

  // `@starting-style` (css-transitions-2 §3): the values the element renders
  // with on its FIRST commit. The element drops them after mount, and the
  // renderer's native CSS transitions — the same `transition-*` declarations
  // this style already carries — animate from them to the real values, off
  // the JS thread. That is the web's own model: paint the starting values,
  // then transition. Nothing here is an animation; it is only the first
  // frame's worth of style. Any transitionable property works, not a
  // hand-picked subset — the old Animated-on-mount path supported exactly
  // opacity and translate, and existed only because the renderer had no
  // transitions to fall out of. It does now.
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

  // Fast path: nothing deferred.
  let needsWork = false;
  for (const prop of Object.keys(style)) {
    const value = style[prop];
    if (typeof value === 'string' && value.includes('var(')) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) {
    return {style, scope};
  }

  const finished: {[string]: unknown} = {};
  for (const prop of Object.keys(style)) {
    const value = style[prop];
    if (typeof value !== 'string' || !value.includes('var(')) {
      finished[prop] = value;
      continue;
    }
    let resolved = resolveString(value, scope ?? new Map(), 0, true);
    if (resolved.includes('calc(')) {
      const afterCalc = substituteCalc(resolved);
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
    finished[prop] = convertValue(prop, resolved);
  }
  return {style: finished, scope};
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
};
