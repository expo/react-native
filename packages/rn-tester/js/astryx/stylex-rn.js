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
  const m = /^[+-]?(\d+\.?\d*|\.\d+)(px|rem|em)?/.exec(p.src.slice(p.pos));
  if (m == null) {
    return null;
  }
  p.pos += m[0].length;
  const n = parseFloat(m[0]);
  // rem/em normalize to the same fixed 16px root the rest of the runtime
  // uses, so mixed-unit calcs (Tailwind's `calc(0.5rem - 2px)` radii)
  // evaluate instead of dropping.
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
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
  return DROPPED_PREFIXES.some(prefix => prop.startsWith(prefix));
}

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

function expandShorthand(
  prop: string,
  value: string,
): {[string]: string} | null {
  const parts = splitTopLevelSpaces(value);

  if (BOX_SIDES[prop] != null) {
    // Even a ONE-value box shorthand expands. `margin: 0` has to beat a UA
    // default like `margin-block: 1.67em` (which is what put ~27px of
    // phantom space above every <h5> shadcn styles as an alert title), and a
    // shorthand cannot outrank a longhand that was applied natively rather
    // than through this cascade. Writing the longhands makes the intent
    // survive the trip.
    // Only the box-spacing shorthands expand from a single value; borders
    // have no UA default to outrank, and four longhands there would just be
    // noise.
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

  // `place-content` / `place-items` / `place-self` are the grid alignment
  // shorthands. With grid degraded to flex, what these actually have to
  // produce is centring on BOTH axes — a shadcn checkbox says
  // `grid place-content-center` and nothing else, so without this its
  // checkmark has no reason to be anywhere but the corner.
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
  // `rem` against the CSS initial root font size. Astryx's whole type scale is
  // authored in rem (`--font-size-base: 0.875rem` = 14px), so without this
  // every font size reaches RN as a string and is rejected outright —
  // "Error while converting prop 'fontSize': Value is a string, expected a
  // number", once per text element.
  //
  // 16 is the root size the tokens are written against, and their own comments
  // confirm it: 0.875 × 16 = 14, 0.75 × 16 = 12.
  //
  // Half of this is now addressable and half is not, checked rather than
  // assumed. `fontSizeRem` is author-facing (`StyleSheetTypes`), so a rem FONT
  // SIZE could resolve against the real root — which on a device is the
  // platform body size and tracks the user's text-size setting, where 16 does
  // not. That is a behaviour change to every token, so it wants deciding
  // rather than slipping in.
  //
  // Every other property has no such channel: the only relative-length props
  // that exist are `fontSizeEm`, `fontSizeRem` and the three UA-sheet ones, so
  // a rem PADDING or WIDTH has nothing to resolve against and stays a
  // constant. See `no-author-facing-em-lengths`.
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
  // The id of the marker this element carries, if it carries one. What a
  // `when.*` condition on a descendant is asking about.
  __stylexMarker?: string,
  // `when.*` blocks, condition key to the style it applies, left UNRESOLVED
  // here: whether one applies depends on the element's position in the tree,
  // which `props()` cannot see. The JSX runtime settles them.
  __stylexWhen?: {[string]: unknown},
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

/*
 * The pseudo-classes that answer a FINGER, as opposed to focus or being
 * disabled. A component that styles either of these is drawing its own press,
 * and the platform's press feedback must stay out of its way — two answers to
 * one touch, on different clocks, is what a device showed as a button going
 * one colour on press and another on hold.
 *
 * A touch reports as a hover on the way to a press in this runtime, so a
 * component that styled only hover still answers the finger.
 */
const PRESS_ANSWERING_PSEUDOS = [':hover', ':active'];

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
      !PASSED_THROUGH_GRID.has(prop)
    ) {
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
    let resolved = resolveString(String(value), scope, 0, final);
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
    if (resolved === 'inherit') {
      // The value the parent computed. For a property the renderer's cascade
      // inherits, an explicit null says "nothing from this layer" — the merge
      // cancels the layers below and the cascade supplies the value, which is
      // what `inherit` computes to. For any other property there is no
      // inherited value to fall back on and no way to read the parent's here.
      // The stylesheet path already did this; a stylex value written straight
      // in the component reached the renderer as the literal string.
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
      // `border-style: none` forces the USED border width to zero (CSS2 §8.5.3)
      // — which is how it reads here, since React Native's `borderStyle` takes
      // solid, dotted or dashed and has no way to say "no border". Passing the
      // literal through was rejected outright and left the width standing.
      out.borderWidth = 0;
      continue;
    }
    const em = EM_LENGTH.exec(resolved);
    if (em != null && prop !== 'fontSize') {
      // Same deferral as the ratio above, and the same base: on a LENGTH, `em`
      // is the element's own computed font size (css-values-4 §5.1.1). On
      // `font-size` it is the INHERITED one instead, which is a step further
      // up than anything here can see, so that case falls through and is
      // handled with the rest of the unresolvable values below.
      emLengths.set(prop, parseFloat(em[1]));
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
  for (const [prop, ratio] of emLengths) {
    const fontSize = out.fontSize;
    if (typeof fontSize === 'number') {
      out[prop] = ratio * fontSize;
    } else {
      // As with the ratio below: the font size is inherited rather than
      // declared here, so there is nothing to multiply by.
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
    } else {
      // The font size is inherited rather than declared here, and RN gives no
      // way to resolve it at this point. Emitting the bare ratio would be
      // actively wrong, so leave `lineHeight` unset and let RN use its own —
      // wrong spacing beats a collapsed line box.
      //
      // Still true, checked: the relative-length props are `fontSizeEm`,
      // `fontSizeRem` and three UA-sheet ones. There is no `lineHeightEm`, so
      // a unitless ratio has nothing to multiply by until one exists — which
      // is the same missing channel as `no-author-facing-em-lengths`, not a
      // separate problem.
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

  /*
   * Whether these styles answer a press — decided HERE, and not from the
   * resolved style, because `resolveDeclarations` drops every `:`-prefixed key
   * as it converts declarations. By the time a style reaches the element there
   * is nothing left to look for, which is exactly the mistake that let the
   * three-colour button survive a fix and four passing tests.
   */
  const answersPress = PRESS_ANSWERING_PSEUDOS.some(
    pseudo => merged[pseudo] != null,
  );

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

  /*
   * A marker applied to this element, and the `when.*` blocks that depend on
   * one. Neither can be settled here: `props()` is a plain function with no
   * view of the tree, so the marker is surfaced for the element to publish and
   * the blocks are deferred for it to evaluate — the same split M3 uses for a
   * `var()` an ancestor might still define.
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

/**
 * Markers and `stylex.when.*` — conditions that depend on ANOTHER element.
 *
 * The spec, read off `@stylexjs/stylex@0.19`'s own type declarations rather
 * than inferred from call sites:
 *
 *   defineMarker(): MapNamespace<{readonly marker: symbol}>
 *   when.ancestor(pseudo?, marker?): `:where-ancestor(${Pseudo}, ${Symbol})`
 *   when.descendant / siblingBefore / siblingAfter / anySibling: likewise
 *
 * `Pseudo` is `:${string}` or `[${string}]` — a pseudo-class such as
 * `:first-child`, or an attribute selector. Both arguments are optional; with
 * no marker the condition refers to the DEFAULT marker. A marker is a style
 * namespace, so it is applied by passing it to `props()` like any other style,
 * and its identity is a symbol.
 *
 * Upstream these are compile-time only: the runtime entry points in the real
 * package THROW, because the Babel plugin is expected to have rewritten them
 * into class names and a `:has()`-style selector. There is no compiler here,
 * so they are evaluated at runtime instead — which is possible because the
 * element tree already carries a channel for exactly this kind of question
 * (the custom-property scope M3 added), and the JSX runtime is the element's
 * own React component, so it can read context that a plain `props()` call
 * cannot.
 *
 * The division of labour is the same two-pass shape M3 uses: `props()` cannot
 * know anything about ancestors, so it DEFERS these blocks onto the props it
 * returns, and `resolveWhen` finishes them at the element once the marker
 * state in scope is known.
 */

// Symbols are not embeddable in a string, so each marker also gets a stable id
// that can appear in the condition key. The registry is keyed by symbol so two
// markers never collide, and lookups from a key go through `MARKER_BY_ID`.
const MARKER_ID_BY_SYMBOL: Map<symbol, string> = new Map();
const MARKER_BY_ID: Map<string, symbol> = new Map();
let markerSequence = 0;

/**
 * Whether any marker exists at all.
 *
 * The structural bookkeeping markers need (an element knowing whether it is a
 * first or last child) costs a walk of every intrinsic's children, and an app
 * that never calls `defineMarker` must not pay it. Nothing in React Native
 * uses markers; only a vendored design system does. See `hasMarkers()`.
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

/*
 * Whether any `when.descendant` condition exists in the program.
 *
 * Answering one costs an upward registration from every marked element and a
 * second render of the asking element (see `useDescendantMarkers` in the JSX
 * runtime). A tree that never asks must pay neither, and the question is
 * settled at module scope — these keys are built when a component's styles are
 * defined, long before anything renders.
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
   * The union of what every marked DESCENDANT matches — `:has()` semantics,
   * where one matching descendant satisfies the condition. Collected by
   * registration rather than published downward, because it travels the other
   * way: see `useDescendantMarkers`.
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
export function whenConditionApplies(
  key: string,
  state: MarkerState,
): boolean {
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
       * `:has()` semantics: one matching descendant is enough.
       *
       * This is the only relation whose answer travels UP, and it is therefore
       * the only one that cannot be settled during the asking element's first
       * render — a parent renders before its descendants exist, so on that pass
       * the map is legitimately empty. Marked descendants register in a layout
       * effect and the asker re-renders before paint, so the settled answer is
       * the first one presented. That is an extra render for trees that ask,
       * which is why nothing pays for it unless it does.
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
    // A matching block layers over the base declarations, which is what the
    // generated CSS would do: the conditional rule is authored after the
    // unconditional one and wins at equal specificity.
    // Resolved against the element's OWN custom-property scope and finished,
    // exactly as its base declarations were: a `var()` inside a conditional
    // block reads the same cascade as one outside it, and by this point the
    // scope is known. Called with two of its four arguments, this silently
    // resolved against no scope at all and left the values unfinished.
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
