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
 * The stylesheet engine: installed sheets, the live matcher, and per-element
 * resolution for the intrinsics runtime.
 *
 * Division of labor: `parse.js` turns text into rules, `match.js` picks the
 * winning declarations for an element, and this module owns everything
 * environmental — the singleton sheet list, the match context (appearance,
 * window, reduce-motion), `:root` variables, @keyframes registration, and
 * the animation/transition shorthands — before handing values to the same
 * stylex-rn pipeline every other style in the runtime resolves through.
 */

import type {ElementDescriptor, InteractionStates, Matcher} from './match';
import type {Stylesheet} from './parse';

import {registerNamedKeyframes, resolveDeclarations} from '../stylex-rn';
import {createMatcher} from './match';
import {compileSelector, parseStylesheet} from './parse';
import {AccessibilityInfo, Appearance, Dimensions} from 'react-native';

export type {ElementDescriptor} from './match';

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()?.then?.(
  (enabled: boolean) => {
    reduceMotion = enabled === true;
  },
  () => {},
);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', enabled => {
  reduceMotion = enabled === true;
  bumpVersion();
});

function currentContext() {
  const window = Dimensions.get('window');
  return {
    schemeIsDark: Appearance.getColorScheme() === 'dark',
    reduceMotion,
    windowWidth: window.width,
    windowHeight: window.height,
    touch: true,
  };
}

// -----------------------------------------------------------------------------
// Installed sheets and the version signal
// -----------------------------------------------------------------------------

const sheets: Array<Stylesheet> = [];
let matcher: Matcher | null = null;
let ruleCount = 0;

// Bumped when anything that could change EVERY element's match changes:
// sheet installation, appearance, window size, reduce-motion. Intrinsic
// elements subscribe (useSyncExternalStore) and re-resolve on change.
let version = 0;
const subscribers: Set<() => void> = new Set();

function bumpVersion() {
  version++;
  for (const cb of subscribers) {
    cb();
  }
}

Appearance.addChangeListener?.(() => bumpVersion());
Dimensions.addEventListener?.('change', () => bumpVersion());

export function subscribeCss(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function cssVersion(): number {
  return version;
}

/**
 * Installs a stylesheet (text or pre-parsed). Later sheets cascade after
 * earlier ones, exactly like a later <link>. Idempotence is the caller's
 * concern; the demo/runtime installs at module scope, once per bundle load.
 */
/**
 * Tailwind expresses child spacing through a sibling combinator:
 * `.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem }`.
 * The matcher has no sibling knowledge, so those rules can never apply and
 * shadcn's stacks (a Card header's title and description, most obviously)
 * render with no spacing at all.
 *
 * A gap on the PARENT says the same thing in a way this renderer can honor,
 * and it is what the utility means. The rewrite is exact for the flex
 * containers `space-*` is used on, and closer than nothing elsewhere.
 * `divide-*` uses the same selector shape for borders, which has no gap
 * equivalent, so it is left alone.
 * DOM-CSS-LIMITATION(sibling-combinator-spacing-as-gap)
 */
const SPACE_SELECTOR =
  /^\.([^\s>]+)\s*>\s*:not\(\[hidden\]\)\s*~\s*:not\(\[hidden\]\)$/;

function rewriteSiblingSpacing(sheet: Stylesheet): void {
  const synthesized = [];
  for (const rule of sheet.rules) {
    for (const selector of rule.selectors) {
      const match = SPACE_SELECTOR.exec(selector.raw.trim());
      if (match == null) {
        continue;
      }
      const gap: {[string]: string} = {};
      if (rule.declarations['margin-top'] != null) {
        gap['row-gap'] = rule.declarations['margin-top'];
      }
      if (rule.declarations['margin-left'] != null) {
        gap['column-gap'] = rule.declarations['margin-left'];
      }
      if (Object.keys(gap).length === 0) {
        continue;
      }
      synthesized.push({
        type: 'style',
        selectors: [compileSelector('.' + match[1])],
        declarations: gap,
        media: rule.media,
        layer: rule.layer,
        order: rule.order,
      });
    }
  }
  for (const rule of synthesized) {
    sheet.rules.push(rule as $FlowFixMe);
  }
}

export function installStylesheet(css: string | Stylesheet): void {
  const sheet = typeof css === 'string' ? parseStylesheet(css, ruleCount) : css;
  rewriteSiblingSpacing(sheet);
  ruleCount += sheet.rules.length;
  sheets.push(sheet);
  matcher = createMatcher(sheets);
  for (const kf of sheet.keyframes) {
    registerNamedKeyframes(kf.name, keyframesToFrames(kf.stops));
  }
  bumpVersion();
}

/**
 * Test-only: drop every installed sheet.
 */
export function resetStylesheets(): void {
  sheets.length = 0;
  ruleCount = 0;
  matcher = null;
  bumpVersion();
}

export function hasStylesheets(): boolean {
  return matcher != null;
}

// -----------------------------------------------------------------------------
// Property-name conversion and shorthands
// -----------------------------------------------------------------------------

function camelize(property: string): string {
  return property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const ANIMATION_TIMING =
  /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\))$/;
const ANIMATION_DIRECTION = /^(normal|reverse|alternate|alternate-reverse)$/;
const ANIMATION_FILL = /^(none|forwards|backwards|both)$/;
const TIME = /^-?[\d.]+m?s$/;

/**
 * `animation: spin 1s linear infinite` → the longhands the renderer reads.
 * One animation per element (comma lists take the first, matching the
 * engine's current support).
 */
function expandAnimationShorthand(value: string): {[string]: string} {
  const first = value.split(',')[0].trim();
  if (first === '' || first === 'none') {
    return {};
  }
  const out: {[string]: string} = {};
  let sawDuration = false;
  for (const token of first.split(/\s+/)) {
    const t = token.trim();
    if (t === '') {
      continue;
    }
    if (TIME.test(t)) {
      // First time is duration, second is delay (css-animations-1 §5).
      if (!sawDuration) {
        out.animationDuration = t;
        sawDuration = true;
      } else {
        out.animationDelay = t;
      }
      continue;
    }
    if (ANIMATION_TIMING.test(t)) {
      out.animationTimingFunction = t;
      continue;
    }
    if (t === 'infinite' || /^[\d.]+$/.test(t)) {
      out.animationIterationCount = t;
      continue;
    }
    if (ANIMATION_DIRECTION.test(t)) {
      out.animationDirection = t;
      continue;
    }
    if (ANIMATION_FILL.test(t)) {
      out.animationFillMode = t;
      continue;
    }
    if (t === 'running' || t === 'paused') {
      continue; // play-state is not modeled
    }
    out.animationName = t;
  }
  return out;
}

/**
 * `transition: color 150ms ease-in` (comma list allowed) → the longhand
 * comma lists the renderer zips.
 */
function expandTransitionShorthand(value: string): {[string]: string} {
  const properties = [];
  const durations = [];
  const timings = [];
  const delays = [];
  for (const segment of value.split(',')) {
    let property = 'all';
    let duration = '0s';
    let timing = 'ease';
    let delay = '0s';
    let sawDuration = false;
    for (const token of segment.trim().split(/\s+/)) {
      if (token === '') {
        continue;
      }
      if (TIME.test(token)) {
        if (!sawDuration) {
          duration = token;
          sawDuration = true;
        } else {
          delay = token;
        }
      } else if (ANIMATION_TIMING.test(token)) {
        timing = token;
      } else {
        property = token;
      }
    }
    properties.push(property);
    durations.push(duration);
    timings.push(timing);
    delays.push(delay);
  }
  return {
    transitionProperty: properties.join(', '),
    transitionDuration: durations.join(', '),
    transitionTimingFunction: timings.join(', '),
    transitionDelay: delays.join(', '),
  };
}

function keyframesToFrames(
  stops: Array<{offset: number, declarations: {[string]: string}}>,
): {[string]: {[string]: string}} {
  const frames: {[string]: {[string]: string}} = {};
  for (const stop of stops) {
    const key = `${stop.offset * 100}%`;
    const declarations: {[string]: string} = {};
    for (const property of Object.keys(stop.declarations)) {
      declarations[camelize(property)] = stop.declarations[property];
    }
    frames[key] = {...(frames[key] ?? {}), ...declarations};
  }
  return frames;
}

// -----------------------------------------------------------------------------
// Per-element resolution
// -----------------------------------------------------------------------------

/**
 * The canonical "visually hidden" clip block — `position: absolute; width:
 * 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0)` — which shadcn
 * and every accessible component library uses to put text in the
 * accessibility tree without showing it (`sr-only`, `<VisuallyHidden>`).
 *
 * It works on the web because a 1×1 clipped BOX still contributes its text
 * to the a11y tree. Here the elements it lands on are inline text, which
 * cannot be a box — the text simply rendered next to the icon it was
 * captioning. The honest platform mapping is not to render it: React
 * Native's accessibility tree reads `accessibilityLabel`, not hidden text
 * nodes, so the hidden string was never going to be announced from here.
 * DOM-CSS-LIMITATION(sr-only-not-in-a11y-tree)
 */
export function isVisuallyHidden(style: {[string]: unknown} | null): boolean {
  if (style == null) {
    return false;
  }
  return (
    style.position === 'absolute' &&
    style.overflow === 'hidden' &&
    (style.width === 1 || style.width === '1px') &&
    (style.height === 1 || style.height === '1px')
  );
}

export type CssResolution = {
  // Resolved RN style, ready to layer UNDER stylex/inline styles.
  style: {[string]: unknown} | null,
  // Custom properties this element's matched rules declare, for descendants.
  vars: {[string]: unknown} | null,
  // Some candidate rule gates on interaction state: track it.
  dependsOnStates: boolean,
};

const QUIET_WEB_ONLY: Set<string> = new Set([
  'cursor',
  'outline',
  'outlineOffset',
  'outlineStyle',
  'outlineWidth',
  'outlineColor',
  'appearance',
  'clip',
  'willChange',
  'transitionBehavior',
  'animationPlayState',
  'transformOrigin',
]);

const EMPTY: CssResolution = {style: null, vars: null, dependsOnStates: false};

/**
 * Resolves the stylesheet-matched styles for one element. The declarations
 * go through the SAME value pipeline as stylex styles (var()/calc()/
 * light-dark()/color-mix(), unit conversion, the animationName registry
 * interception), with `final=false` so an unresolved var() defers to the
 * element's inheritance pass exactly like a stylex value would.
 */
export function resolveCssForElement(
  el: ElementDescriptor,
  interaction: InteractionStates,
): CssResolution {
  const active = matcher;
  if (active == null) {
    return EMPTY;
  }
  const {declarations, dependsOnStates: subjectDependsOnStates} =
    active.matchDeclarations({...el, states: interaction}, currentContext());
  // An element whose class some rule reads state from in an ancestor position
  // (`.group:hover .x`) must track interaction even though nothing about its
  // OWN styling depends on it — its descendants' does.
  const dependsOnStates =
    subjectDependsOnStates ||
    el.classes.some(cls => active.tracksStateForDescendants(cls));
  const keys = Object.keys(declarations);
  if (keys.length === 0) {
    return dependsOnStates ? {...EMPTY, dependsOnStates} : EMPTY;
  }

  let vars: {[string]: unknown} | null = null;
  const merged: {[string]: unknown} = {};
  for (const property of keys) {
    const value = declarations[property];
    if (property.startsWith('--')) {
      const bucket: {[string]: unknown} = vars ?? {};
      bucket[property] = value;
      vars = bucket;
      continue;
    }
    if (property === 'animation') {
      const expanded = expandAnimationShorthand(value);
      for (const k of Object.keys(expanded)) {
        merged[k] = expanded[k];
      }
      continue;
    }
    if (property === 'transition') {
      const expanded = expandTransitionShorthand(value);
      for (const k of Object.keys(expanded)) {
        merged[k] = expanded[k];
      }
      continue;
    }
    const camel = camelize(property);
    if (QUIET_WEB_ONLY.has(camel)) {
      // Every real-world sheet carries these (Tailwind emits cursor and
      // outline resets constantly); dropping them is correct and not worth a
      // warning per element.
      continue;
    }
    merged[camel] = value;
  }

  // `display: grid` degrades to flex (grid layout is upstream, in flight).
  // The direction matters: a grid's default auto-flow stacks children in
  // ROWS, while RN's flex default is a row AXIS, so a bare `flex` laid a
  // dialog's header and footer out side by side and pushed the buttons off
  // screen. Only fill in the direction the author did not state.
  // DOM-CSS-LIMITATION(display-grid-as-flex-column)
  if (merged.display === 'grid' || merged.display === 'inline-grid') {
    merged.display = 'flex';
    if (merged.flexDirection == null) {
      merged.flexDirection = 'column';
    }
  }

  // `inherit` is not a value RN can be handed: inheritance happens in the
  // renderer's own text cascade, so a literal `inherit` means "leave it
  // alone" — which is exactly what dropping it does. (Preflight sets
  // `font-size: inherit` on headings; keeping it made a font size look
  // present-but-unusable to everything downstream.)
  for (const property of Object.keys(merged)) {
    if (merged[property] === 'inherit') {
      delete merged[property];
    }
  }

  // `color: currentColor` is an identity — it means "whatever colour is
  // inherited" — so the honest resolution is to state nothing and let
  // inheritance do it. Passing the literal through handed RN a colour it
  // cannot parse AND overwrote the real inherited value for anything
  // painting with it, which is how a checkmark under `text-current`
  // disappeared instead of turning white.
  if (
    typeof merged.color === 'string' &&
    merged.color.toLowerCase() === 'currentcolor'
  ) {
    delete merged.color;
  }

  // A unitless `line-height` needs a font size to resolve against. In a
  // stylesheet those routinely arrive from DIFFERENT rules (`text-sm` sets
  // one, `leading-none` the other) — and when the size is inherited rather
  // than declared, there is nothing here to resolve against and RN's own
  // line height is the better answer. Dropping it is right; warning about it
  // once per element is noise the author cannot act on.
  if (
    typeof merged.lineHeight === 'string' &&
    /^[\d.]+$/.test(merged.lineHeight) &&
    merged.fontSize == null
  ) {
    delete merged.lineHeight;
  }

  const style = resolveDeclarations(
    merged,
    interactionToState(interaction),
    null,
    false,
  );
  return {
    style: Object.keys(style).length > 0 ? style : null,
    vars,
    dependsOnStates,
  };
}

function interactionToState(states: InteractionStates): $FlowFixMe {
  return {
    hovered: states.hovered === true,
    pressed: states.pressed === true,
    focused: states.focusVisible === true || states.focused === true,
    disabled: states.disabled === true,
  };
}

/**
 * `:root` custom properties under the CURRENT scheme — matched with the
 * scheme-aware context, so a `.dark { --background: … }` block flips with
 * the OS appearance. Fed into the runtime's root variable scope.
 */
export function rootVariables(): {[string]: unknown} | null {
  const active = matcher;
  if (active == null) {
    return null;
  }
  const ctx = currentContext();
  const root: ElementDescriptor = {
    tag: null,
    classes: ctx.schemeIsDark ? ['dark'] : [],
    attributes: {},
    states: {},
    parent: null,
    isRoot: true,
  };
  const {declarations} = active.matchDeclarations(root, ctx);
  let vars: {[string]: unknown} | null = null;
  for (const property of Object.keys(declarations)) {
    if (property.startsWith('--')) {
      const bucket: {[string]: unknown} = vars ?? {};
      bucket[property] = declarations[property];
      vars = bucket;
    }
  }
  return vars;
}
