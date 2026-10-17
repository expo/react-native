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
 * On the web, `stylex.create()` compiles to atomic CSS at build time. Here
 * nothing compiles: `create()` keeps the raw objects, and `props()` registers
 * the merged styles with the renderer's style engine, which resolves them as
 * the tree is committed (native-css/engine.js), with the tokens `defineVars()`
 * and the animations `keyframes()` register. Metro aliases `@stylexjs/stylex`
 * to this module.
 *
 * Not supported: `createTheme()`.
 */

import {
  counters,
  instrumenting,
  notePressReadThroughMarker,
  registerKeyframes as registerEngineKeyframes,
  registerStyle as registerEngineStyle,
  registerTokens as registerEngineTokens,
  standInFor,
} from './native-css/engine';

type RawStyle = {readonly [string]: unknown};

/**
 * Registers token defaults with the engine and returns web-shaped var
 * references (`{'--spacing-4': 'var(--spacing-4)'}`), which is exactly what
 * token consumers embed into their style values.
 */
export function defineVars<T extends {readonly [string]: unknown}>(
  defaults: T,
): T {
  const refs: {[string]: unknown} = {};
  for (const name of Object.keys(defaults)) {
    refs[name] = `var(${name})`;
  }
  registerEngineTokens(defaults);
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

/**
 * `stylex.keyframes()` returns an opaque animation name, exactly as on the
 * web, and registers the frames with the engine under it, where a style's
 * `animationName` finds them
 */
export function keyframes(frames: RawStyle): string {
  const name = `__rn_keyframes_${keyframesCounter++}`;
  const declared: {[string]: unknown} = {};
  for (const offset of Object.keys(frames)) {
    const frame = frames[offset];
    declared[offset] = isPlainBlock(frame)
      ? declarationsOf(frame as $FlowFixMe)
      : frame;
  }
  registerEngineKeyframes(name, declared);
  return name;
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

const warned: Set<string> = new Set();
function warnOnce(key: string, message: string) {
  if (__DEV__ && !warned.has(key)) {
    warned.add(key);
    console.warn(`[stylex-rn] ${message}`);
  }
}

/**
 * What `props()` hands to an element: the id its merged styles are registered
 * under, which the element names to the engine, and the boxes it generates
 */
export type StyleXProps = {
  // A stand-in for the registered styles, so a component that passes `style`
  // on still passes them; see `standInFor`
  style?: {[string]: unknown},
  // The id the merged styles are registered under, under a key a later `style`
  // attribute cannot clobber, and the `::backdrop` block's
  __cssStyle?: number,
  __cssBackdrop?: number,
  // The marker this element carries, a class the `when.*` conditions name
  __cssMarker?: string,
  // The `::before` and `::after` boxes, each styled under its own id, with
  // the text its `content` generates
  __cssBefore?: GeneratedContent,
  __cssAfter?: GeneratedContent,
};

/**
 * A `::before` or `::after` box (css-pseudo-4 §2): the id its declarations
 * are registered under, and its `content` (css-content-3 §2), a string or an
 * attribute of the element it is generated for.
 */
export type GeneratedContent = {
  readonly id: number,
  readonly text: string,
  readonly attr: ?string,
};

export type InteractionState = {
  readonly hovered?: boolean,
  readonly pressed?: boolean,
  readonly focused?: boolean,
  readonly disabled?: boolean,
};

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
    for (const written of Object.keys(item)) {
      const value = item[written];
      const key = propertyOf(written);
      if (value === null) {
        // CSS `null` means "unset this property".
        delete target[key];
        continue;
      }
      if (value !== undefined) {
        const previous = target[key];
        // A block (`::backdrop`, `:hover`, `@media …`) merges declaration by
        // declaration, as StyleX compiles each of its properties to a class of
        // its own: a later block that sets only `opacity` keeps the earlier
        // block's `backgroundColor`
        if (
          (key[0] === ':' || key[0] === '@') &&
          isPlainBlock(value) &&
          isPlainBlock(previous)
        ) {
          const block: {[string]: unknown} = {...(previous as $FlowFixMe)};
          flattenInto(block, value);
          target[key] = block;
        } else {
          target[key] = value;
        }
      }
    }
  }
}

function isPlainBlock(value: unknown): boolean {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// A variable `defineVars()` made, written as a key (`[vars.alpha]: 1`),
// declares that variable, as the StyleX compiler reads it: the key is the
// variable's `var()` reference, and the property is the variable
const VARIABLE_KEY = /^var\((--[^\s,()]+)\)$/;

function propertyOf(key: string): string {
  const variable = VARIABLE_KEY.exec(key);
  return variable != null ? variable[1] : key;
}

// A block of declarations with each key as the property it declares
function declarationsOf(block: RawStyle): {[string]: unknown} {
  const declared: {[string]: unknown} = {};
  for (const key of Object.keys(block)) {
    declared[propertyOf(key)] = block[key];
  }
  return declared;
}

/**
 * Web StyleX returns `{className, style}`; here the merged styles are
 * registered with the renderer's style engine once, and the element is handed
 * their id, under `style` (so a component that passes `style` on still
 * passes it) and under a key a later `style` attribute cannot clobber.
 */
export function props(...items: Array<unknown>): StyleXProps {
  return memoizedEngineProps(items);
}

/*
 * The answers `props()` has given, kept in a trie over the arguments: objects
 * under weak keys, so a style made for one render is forgotten with it, and
 * the rest (`false` from `cond && style`, a string) under strong ones.
 * Components call `props()` with the same `stylex.create` objects on every
 * render, and answering with the same object is what lets the element see
 * that nothing changed.
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
  // So are `::before` and `::after`, which the element draws first and last
  const before = merged['::before'];
  delete merged['::before'];
  const after = merged['::after'];
  delete merged['::after'];
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
  const beforeBox = generatedContent(before);
  if (beforeBox != null) {
    result.__cssBefore = beforeBox;
  }
  const afterBox = generatedContent(after);
  if (afterBox != null) {
    result.__cssAfter = afterBox;
  }
  return result;
}

/*
 * The box a `::before` or `::after` block generates, or null where it
 * generates none: `content` is `none` or `normal` or not stated (which is
 * `normal`, and computes to `none` on these two; css-content-3 §2), or is a
 * value this renderer draws nothing for (a counter, an image).
 */
function generatedContent(declarations: unknown): ?GeneratedContent {
  if (declarations == null || typeof declarations !== 'object') {
    return null;
  }
  const block = declarations as {readonly [string]: unknown};
  let content = block.content;
  // A value set per condition generates by its default
  if (
    content != null &&
    typeof content === 'object' &&
    !Array.isArray(content)
  ) {
    content = (content as {readonly [string]: unknown}).default;
  }
  if (typeof content !== 'string') {
    return null;
  }
  const value = content.trim();
  const attribute = /^attr\(\s*([\w-]+)\s*\)$/.exec(value);
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  if (attribute == null && quoted == null) {
    return null;
  }
  const {content: _content, ...rest} = block;
  // $FlowFixMe[incompatible-call] the block's declarations
  const id = registerEngineStyle(rest);
  return {
    id,
    text: quoted != null ? quoted[2] : '',
    attr: attribute != null ? attribute[1] : null,
  };
}

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
 * style namespace applied through `props()`, with a symbol for its identity,
 * and reaches the engine as a class the element carries; the engine answers a
 * condition as a selector over the tree it styles.
 */

// Symbols are not embeddable in a string, so each marker also gets a stable id
// that can appear in the condition key
const MARKER_ID_BY_SYMBOL: Map<symbol, string> = new Map();
let markerSequence = 0;

export function defineMarker(): {readonly marker: symbol} {
  markerSequence += 1;
  const symbol = Symbol(`stylex.marker.${markerSequence}`);
  MARKER_ID_BY_SYMBOL.set(symbol, `m${markerSequence}`);
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

function whenKey(kind: string, pseudo: unknown, marker: unknown): string {
  const selector = typeof pseudo === 'string' ? pseudo : ':scope';
  const markerId = markerIdOf(marker);
  // Note a condition on the marked element's press, which the element's own
  // styles may not read
  if (/:(?:hover|active)\b/.test(selector)) {
    notePressReadThroughMarker(markerId);
  }
  return `:${WHEN_KIND_SELECTOR[kind]}(${selector}, ${markerId})`;
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

export type StyleXStyles = unknown;

export default {
  create,
  props,
  attrs,
  defineVars,
  keyframes,
  firstThatWorks,
  createTheme,
  when,
  defineMarker,
  defaultMarker,
};
