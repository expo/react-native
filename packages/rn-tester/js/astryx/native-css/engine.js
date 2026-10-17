/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/* eslint no-bitwise: 0 */

/**
 * The renderer's style engine, as the Astryx runtime talks to it.
 *
 * The engine (ReactCommon/react/renderer/cssengine) resolves CSS for HTML
 * elements in C++ while a tree is committed: the sheets, the cascade, custom
 * properties and every value. The runtime hands it what it cannot know
 * without JavaScript — the sheets as they are installed, StyleX's styles,
 * tokens and keyframes as they are made, and the window — and renders each
 * element as one host node that names its inputs.
 */

import {Appearance, Dimensions, Platform, Settings} from 'react-native';
import matchMedia, {
  windowMediaEnvironment,
} from 'react-native/Libraries/Utilities/matchMedia';

type Binding = {
  addStyleSheet: (text: string) => number,
  replaceStyleSheet: (id: number, text: string) => void,
  removeStyleSheet: (id: number) => void,
  registerStyle: (entries: EncodedStyle) => number,
  registerTokens: (entries: EncodedStyle) => void,
  registerKeyframes: (name: string, frames: EncodedStyle) => void,
  setEnvironment: (environment: {...}) => void,
  computedStyle: (node: unknown) => ?{[string]: unknown},
  customProperty: (node: unknown, name: string) => ?string,
  matches: (node: unknown, selectors: string) => boolean,
  hints: (
    tag: string,
    className: string,
    attributes: ?{...},
    styleId: number,
    inlineStyle: ?EncodedStyle,
  ) => number,
  stats: () => {[string]: number},
  resetStats: () => void,
  flush: () => void,
};

export type EncodedStyle = Array<[string, unknown]>;

// What `hints()` reports; see StyleHint in StyleEngine.h
export const HINT_BOX = 1;
export const HINT_SCROLL = 2;
export const HINT_CONTENTS = 4;
export const HINT_STATES = 8;
export const HINT_BACKGROUND_IMAGE = 16;
export const HINT_CONTAINER = 32;
export const HINT_SCROLL_BLOCK = 64;

// The `cssStates` bits; see ElementState in StyleContext.h
export const STATE_HOVER = 1;
export const STATE_ACTIVE = 2;
export const STATE_FOCUS = 4;
export const STATE_FOCUS_VISIBLE = 8;
export const STATE_POPOVER_OPEN = 16;
export const STATE_CHECKED = 32;

/*
 * Counters for the timing harness, kept while it sets
 * `globalThis.__astryxInstrument`: elements rendered through a component and
 * the time in their own render, `stylex.props()` answers made and their time,
 * styles registered with the engine and hints asked of it.
 */
export const counters: {
  elements: number,
  elementMs: number,
  hostElements: number,
  hostElementMs: number,
  props: number,
  propsMs: number,
  registered: number,
  registerMs: number,
  hints: number,
  hintsMs: number,
  // What makes the engine restyle every element
  sheets: number,
  tokens: number,
  environments: number,
} = {
  elements: 0,
  elementMs: 0,
  hostElements: 0,
  hostElementMs: 0,
  props: 0,
  propsMs: 0,
  registered: 0,
  registerMs: 0,
  hints: 0,
  hintsMs: 0,
  sheets: 0,
  tokens: 0,
  environments: 0,
};

export function instrumenting(): boolean {
  // $FlowExpectedError[prop-missing] set by the timing harness
  return globalThis.__astryxInstrument === true;
}

export function resetCounters(): void {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}

function binding(): ?Binding {
  // $FlowExpectedError[prop-missing] installed by the renderer
  return globalThis.__cssEngine;
}

/*
 * Whether elements are styled by the engine. On where the renderer installed
 * one, unless the JavaScript engine is asked for, as the A/B timing harness
 * does: `globalThis.__astryxJavaScriptCss`, or on iOS the launch argument
 * `-AstryxJavaScriptCss 1`.
 */
const enabled: boolean =
  binding() != null &&
  // $FlowExpectedError[prop-missing] a switch for measurements
  globalThis.__astryxJavaScriptCss !== true &&
  !(Platform.OS === 'ios' && Settings.get('AstryxJavaScriptCss') != null);

export function engineEnabled(): boolean {
  return enabled;
}

function engine(): Binding {
  const installed = binding();
  if (installed == null) {
    throw new Error(
      'The renderer installed no style engine (`__cssEngine`), so elements ' +
        'cannot be styled natively. Check that the app runs the new ' +
        'architecture with this fork of the renderer.',
    );
  }
  return installed;
}

// -- Styles --

/*
 * A StyleX style or an inline style as the engine takes it: its entries in
 * order, a conditional value (`{default: …, ':hover': …}`) or a block
 * (`':hover': {…}`) as `{c: entries}`, and a value React Native reads as it
 * is (a transform array, a shadow offset) as `{r: value}`.
 */
export function encodeStyle(style: {readonly [string]: unknown}): EncodedStyle {
  const entries: EncodedStyle = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value === undefined || typeof value === 'function') {
      continue;
    }
    if (typeof value === 'symbol') {
      // A StyleX marker, which is not a declaration
      continue;
    }
    entries.push([key, encodeValue(value)]);
  }
  return entries;
}

function encodeValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return null;
  }
  if (Array.isArray(value)) {
    return {r: value};
  }
  if (typeof value === 'object') {
    // $FlowFixMe[incompatible-type] an object value
    const object: {readonly [string]: unknown} = value;
    const keys = Object.keys(object);
    // A condition is `default`, a pseudo-class, an at-rule or an attribute
    // selector (`[data-state="open"]`)
    const conditional =
      keys.length > 0 &&
      keys.every(
        key =>
          key === 'default' ||
          key.startsWith(':') ||
          key.startsWith('@') ||
          key.startsWith('['),
      );
    return conditional ? {c: encodeStyle(object)} : {r: value};
  }
  return null;
}

// Registered styles by their encoding, so one style is registered once, and
// what each id was registered from
const styleIds: Map<string, number> = new Map();
const stylesById: Map<number, {readonly [string]: unknown}> = new Map();

/*
 * The id a merged StyleX style is registered under. The same declarations
 * register once, so a style made afresh on every render (a dynamic style)
 * grows the engine's registry only with what is new.
 */
export function registerStyle(style: {readonly [string]: unknown}): number {
  const encoded = encodeStyle(style);
  if (encoded.length === 0) {
    return 0;
  }
  const key = JSON.stringify(encoded);
  let id = styleIds.get(key);
  if (id == null) {
    const start = instrumenting() ? performance.now() : 0;
    id = engine().registerStyle(encoded);
    if (start !== 0) {
      counters.registered++;
      counters.registerMs += performance.now() - start;
    }
    styleIds.set(key, id);
    stylesById.set(id, style);
  }
  return id;
}

/*
 * What `stylex.props()` hands an element as its `style`: the merged
 * declarations as written, and the id they are registered under. Components
 * spread one style into another (`{...a.style, ...b.style}`, as Astryx's
 * `mergeProps` does), and a spread copy keeps the declarations and the key
 * that says they came from StyleX; only the original, frozen and shared per
 * id, is known by its id alone.
 */
export type EngineStyle = {readonly __cssStyle: number, ...};

const standIns: Map<number, EngineStyle> = new Map();

export function standInFor(
  id: number,
  declarations: {readonly [string]: unknown},
): EngineStyle {
  let standIn = standIns.get(id);
  if (standIn == null) {
    standIn = Object.freeze({...declarations, __cssStyle: id});
    standIns.set(id, standIn);
  }
  return standIn;
}

const OVERFLOW_KEYS = [
  'overflow',
  'overflowX',
  'overflowY',
  'overflowInline',
  'overflowBlock',
];

/*
 * Whether a registered style states an `overflow` at all, in any value: a
 * style made per render (a scroll area's, which says `clip` until it has
 * measured and `auto` after) states one in every version, so the answer
 * stays the same while the value changes.
 */
export function declaresOverflow(
  id: number,
  inline: ?{readonly [string]: unknown},
): boolean {
  const style = id !== 0 ? stylesById.get(id) : null;
  return OVERFLOW_KEYS.some(
    key => style?.[key] != null || inline?.[key] != null,
  );
}

// A spread copy's declarations, without the id it carried over
function registerSpreadStyle(object: {readonly [string]: unknown}): number {
  const {__cssStyle: _id, ...declarations} = object;
  return registerStyle(declarations);
}

const combinedIds: Map<string, number> = new Map();

// Two or more registered styles applied together, as one, later ones winning
function combine(ids: Array<number>): number {
  const key = ids.join(',');
  let id = combinedIds.get(key);
  if (id == null) {
    const merged: {[string]: unknown} = {};
    for (const each of ids) {
      const style = stylesById.get(each);
      if (style != null) {
        for (const name of Object.keys(style)) {
          merged[name] = style[name];
        }
      }
    }
    id = registerStyle(merged);
    combinedIds.set(key, id);
  }
  return id;
}

/*
 * An element's registered style and its inline style, from what it was
 * given: the id `stylex.props()` planted, and a `style` that may be that
 * style, an inline object, the style spread into an inline object (as
 * Astryx's `mergeProps` merges them), or an array of all of these.
 */
export function styleInputsOf(
  base: unknown,
  style: unknown,
): {styleId: number, inline: ?{[string]: unknown}} {
  const baseId = typeof base === 'number' ? base : 0;
  if (style == null || style === false) {
    return {styleId: baseId, inline: null};
  }
  // The registered style's own stand-in, as `stylex.props()` handed it
  if (
    typeof style === 'object' &&
    typeof (style as $FlowFixMe).__cssStyle === 'number' &&
    standIns.get((style as $FlowFixMe).__cssStyle) === style &&
    (baseId === 0 || baseId === (style as $FlowFixMe).__cssStyle)
  ) {
    return {styleId: (style as $FlowFixMe).__cssStyle, inline: null};
  }
  const ids: Array<number> = baseId !== 0 ? [baseId] : [];
  // The inline declarations, in order; one object is handed on as it is
  const parts: Array<{readonly [string]: unknown}> = [];
  const walk = (item: unknown) => {
    if (item == null || item === false || item === true) {
      return;
    }
    if (Array.isArray(item)) {
      for (const each of item) {
        walk(each);
      }
      return;
    }
    if (typeof item !== 'object') {
      return;
    }
    const object: {readonly [string]: unknown} = item as $FlowFixMe;
    const id = object.__cssStyle;
    if (typeof id !== 'number') {
      parts.push(object);
      return;
    }
    // A registered style's stand-in is its id; a copy spread from one or
    // more of them, with whatever was spread beside, is registered as it
    // stands, as the StyleX style it merges
    const own =
      Object.isFrozen(object) && standIns.get(id) === object
        ? id
        : registerSpreadStyle(object);
    if (own !== 0 && !ids.includes(own)) {
      ids.push(own);
    }
  };
  walk(style);
  const styleId =
    ids.length === 0 ? 0 : ids.length === 1 ? ids[0] : combine(ids);
  const inline =
    parts.length === 0
      ? null
      : parts.length === 1
        ? (parts[0] as $FlowFixMe)
        : parts.reduce(
            (merged: {[string]: unknown}, part) => ({...merged, ...part}),
            {},
          );
  return {styleId, inline};
}

/*
 * The props an element hands the engine, picked from a component's props so
 * a behaviour-mapped element (an `<input>` drawn by a text field) passes them
 * to the host it renders.
 */
export function engineInputProps(props: {readonly [string]: unknown}): {
  [string]: unknown,
} {
  const picked: {[string]: unknown} = {};
  for (const key of Object.keys(props)) {
    if (key.startsWith('css')) {
      picked[key] = props[key];
    }
  }
  return picked;
}

// -- Sheets, tokens and keyframes --

/*
 * A change to the sheets, tokens or environment is not committed by itself:
 * the commit that comes with it styles the tree under it (a page's `<style>`
 * and tokens arrive as the page renders). Once the runtime is idle, the
 * engine commits the surfaces no pass has styled since.
 */
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    binding()?.flush();
  }, 0);
}

const hintsByKey: Map<string, number> = new Map();

// A sheet changes what an element's inputs may match, so the hints asked
// before it are forgotten
export function addStyleSheet(text: string): number {
  counters.sheets++;
  hintsByKey.clear();
  const id = engine().addStyleSheet(text);
  scheduleFlush();
  return id;
}

export function replaceStyleSheet(id: number, text: string): void {
  counters.sheets++;
  hintsByKey.clear();
  engine().replaceStyleSheet(id, text);
  scheduleFlush();
}

export function removeStyleSheet(id: number): void {
  counters.sheets++;
  hintsByKey.clear();
  engine().removeStyleSheet(id);
  scheduleFlush();
}

export function registerTokens(tokens: {readonly [string]: unknown}): void {
  const entries: EncodedStyle = [];
  for (const name of Object.keys(tokens)) {
    const value = tokens[name];
    if (typeof value === 'string' || typeof value === 'number') {
      entries.push([name, value]);
    }
  }
  if (entries.length > 0) {
    counters.tokens++;
    engine().registerTokens(entries);
    scheduleFlush();
  }
}

export function registerKeyframes(
  name: string,
  frames: {readonly [string]: unknown},
): void {
  const entries: EncodedStyle = [];
  for (const offset of Object.keys(frames)) {
    const stop = frames[offset];
    if (stop != null && typeof stop === 'object') {
      // $FlowFixMe[incompatible-type] a stop's declarations
      entries.push([offset, {c: encodeStyle(stop)}]);
    }
  }
  engine().registerKeyframes(name, entries);
}

// -- Queries --

/*
 * What an element's inputs may do, over every state and condition: whether
 * it may need a box, may scroll, may read its interaction state. Asked once
 * for each combination of inputs; an inline style's part is the caller's,
 * read off the plain object.
 */
export function hintsFor(
  tag: string,
  className: string,
  attributes: ?{readonly [string]: unknown},
  attributesKey: string,
  styleId: number,
): number {
  const key = `${tag}|${className}|${attributesKey}|${styleId}`;
  let hints = hintsByKey.get(key);
  if (hints == null) {
    const start = instrumenting() ? performance.now() : 0;
    hints = engine().hints(tag, className, attributes, styleId, null);
    if (start !== 0) {
      counters.hints++;
      counters.hintsMs += performance.now() - start;
    }
    hintsByKey.set(key, hints);
  }
  return hints;
}

/*
 * The engine's counters (see StyleEngine::Stats), and their reset.
 */
export function engineStats(): ?{[string]: number} {
  return binding()?.stats() ?? null;
}

export function resetEngineStats(): void {
  binding()?.resetStats();
}

export function computedStyle(node: unknown): ?{[string]: unknown} {
  return engine().computedStyle(node);
}

// The shadow node React holds for a host instance
export function nodeOf(instance: unknown): unknown {
  // The Fabric host instance's internals
  const handle = (instance as $FlowFixMe)?.__internalInstanceHandle;
  return handle?.stateNode?.node ?? null;
}

/*
 * The style an element resolved to, in React Native's spelling, as the DOM
 * methods read a JavaScript-resolved style: colours as CSS colours, its
 * computed `color` and font size included.
 */
export function computedStyleForInstance(
  instance: unknown,
): ?{[string]: unknown} {
  const node = nodeOf(instance);
  if (node == null) {
    return null;
  }
  const computed = engine().computedStyle(node);
  if (computed == null) {
    return null;
  }
  const style: {[string]: unknown} = {};
  for (const key of Object.keys(computed)) {
    const value = computed[key];
    if (key === '__color') {
      style.color ??= value;
      continue;
    }
    if (key === '__fontSize') {
      style.fontSize ??= value;
      continue;
    }
    if (typeof value === 'number' && /colou?r$/i.test(key)) {
      style[key] = cssColor(value);
      continue;
    }
    // The engine names an inline edge by its logical side
    style[PHYSICAL_NAMES[key] ?? key] = value;
  }
  return style;
}

const PHYSICAL_NAMES: {[string]: string} = {
  start: 'left',
  end: 'right',
  marginStart: 'marginLeft',
  marginEnd: 'marginRight',
  paddingStart: 'paddingLeft',
  paddingEnd: 'paddingRight',
  borderStartWidth: 'borderLeftWidth',
  borderEndWidth: 'borderRightWidth',
  borderStartColor: 'borderLeftColor',
  borderEndColor: 'borderRightColor',
};

// React Native's packed 0xAARRGGBB as `rgba()`
function cssColor(packed: number): string {
  const value = packed >>> 0;
  const a = ((value >>> 24) & 0xff) / 255;
  const r = (value >>> 16) & 0xff;
  const g = (value >>> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

export function customProperty(node: unknown, name: string): ?string {
  return engine().customProperty(node, name);
}

export function matches(node: unknown, selectors: string): boolean {
  return engine().matches(node, selectors);
}

// -- The environment --

// The `env()` names the engine is told, from the app's resolver
const ENVIRONMENT_NAMES = [
  'safe-area-inset-top',
  'safe-area-inset-right',
  'safe-area-inset-bottom',
  'safe-area-inset-left',
];

let environmentResolver: ?(name: string) => ?number = null;

export function setEnvironmentResolver(
  resolve: ?(name: string) => ?number,
): void {
  environmentResolver = resolve;
  syncEnvironment();
}

/*
 * Tells the engine what media queries and `env()` read. The engine restyles
 * every surface when the answer changes.
 */
export function syncEnvironment(): void {
  if (!enabled) {
    return;
  }
  counters.environments++;
  const media = windowMediaEnvironment();
  const display = media.display();
  const env: {[string]: number} = {};
  for (const name of ENVIRONMENT_NAMES) {
    const value = environmentResolver?.(name);
    if (typeof value === 'number') {
      env[name] = value;
    }
  }
  engine().setEnvironment({
    width: media.width,
    height: media.height,
    viewportWidth: media.viewportWidth,
    viewportHeight: media.viewportHeight,
    resolution: media.resolution,
    dark: media.colorScheme === 'dark',
    reducedMotion: media.reducedMotion,
    pointer: media.pointer,
    hover: media.hover,
    gamut: display.colorGamut,
    highDynamicRange: display.dynamicRange === 'high',
    env,
  });
  scheduleFlush();
}

if (enabled) {
  syncEnvironment();
  Appearance.addChangeListener?.(() => syncEnvironment());
  Dimensions.addEventListener?.('change', () => syncEnvironment());
  // The reduce-motion preference arrives asynchronously
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
    'change',
    () => syncEnvironment(),
  );
}
