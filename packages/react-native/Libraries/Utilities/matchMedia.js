/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

// `matches` and `onchange` are accessors, as the DOM defines them
// flowlint unsafe-getters-setters:off

import type {EventSubscription} from '../vendor/emitter/EventEmitter';
import type {DisplayCapabilities} from './NativeDisplayCapabilities';

import Event from '../../src/private/webapis/dom/events/Event';
import EventTarget from '../../src/private/webapis/dom/events/EventTarget';
import NativeEventEmitter from '../EventEmitter/NativeEventEmitter';
import * as Appearance from './Appearance';
import NativeDisplayCapabilities from './NativeDisplayCapabilities';

/**
 * `window.matchMedia` (cssom-view-1 §4) for `color-gamut`, `dynamic-range`,
 * `video-dynamic-range` (Media Queries 5 §6) and `prefers-color-scheme`,
 * asked of the OS. `or` and nested conditions aren't parsed.
 * DOM-CSS-LIMITATION(media-queries-have-no-or-and-no-nesting)
 */
export default function matchMedia(query: string): MediaQueryList {
  return new MediaQueryList(String(query));
}

export type MediaQueryListEvent = Event & {
  readonly matches: boolean,
  readonly media: string,
};

type ChangeListener = MediaQueryListEvent => unknown;

// A change listener, with the abort handler to detach when it is removed
type Registration = {
  signal: ?AbortSignalLike,
  onAbort: ?() => void,
};

type AbortSignalLike = {
  aborted: boolean,
  addEventListener: $FlowFixMe,
  removeEventListener: $FlowFixMe,
  ...
};

export class MediaQueryList extends EventTarget {
  readonly media: string;
  #lastReported: boolean;
  // Keyed as the target keys listeners: by callback and capture
  #registrations: Map<string, Registration> = new Map();
  #onchange: ?ChangeListener = null;
  // Kept while `onchange` is non-null, so a replaced handler keeps its place
  // among the listeners (HTML's event handler processing algorithm)
  #onchangeDispatcher: ?(Event) => void = null;
  #queries: ReadonlyArray<Query>;

  constructor(query: string) {
    super();
    this.media = query.trim();
    this.#queries = parseQueryList(this.media);
    this.#lastReported = this.#evaluate();
  }

  // Live, and reading it isn't reporting: the change event still fires
  get matches(): boolean {
    return this.#evaluate();
  }

  get onchange(): ?ChangeListener {
    return this.#onchange;
  }

  set onchange(handler: ?ChangeListener) {
    this.#onchange = handler;
    if (handler == null) {
      if (this.#onchangeDispatcher != null) {
        this.removeEventListener('change', this.#onchangeDispatcher);
        this.#onchangeDispatcher = null;
      }
      return;
    }
    if (this.#onchangeDispatcher == null) {
      const dispatcher = (event: Event) => {
        const current = this.#onchange;
        if (current != null) {
          current.call(this, event as $FlowFixMe);
        }
      };
      this.#onchangeDispatcher = dispatcher;
      this.addEventListener('change', dispatcher);
    }
  }

  addEventListener(
    type: string,
    listener: $FlowFixMe,
    options?: $FlowFixMe,
  ): void {
    super.addEventListener(type, listener, options);
    if (type !== 'change' || listener == null) {
      return;
    }
    const {capture, signal} = normalizeOptions(options);
    if (signal != null && signal.aborted) {
      return;
    }
    const key = registrationKey(listener, capture);
    if (this.#registrations.has(key)) {
      return;
    }
    const registration: Registration = {signal, onAbort: null};
    if (signal != null) {
      // Only this registration: a later one under the same key is its own
      registration.onAbort = () => this.#forget(key, registration);
      signal.addEventListener('abort', registration.onAbort);
    }
    this.#registrations.set(key, registration);
    watched.add(this);
    ensureWatching();
  }

  removeEventListener(
    type: string,
    listener: $FlowFixMe,
    options?: $FlowFixMe,
  ): void {
    super.removeEventListener(type, listener, options);
    if (type !== 'change' || listener == null) {
      return;
    }
    this.#forget(registrationKey(listener, normalizeOptions(options).capture));
  }

  addListener(listener: ChangeListener): void {
    this.addEventListener('change', listener);
  }

  removeListener(listener: ChangeListener): void {
    this.removeEventListener('change', listener);
  }

  #forget(key: string, expected?: Registration): void {
    const registration = this.#registrations.get(key);
    if (
      registration == null ||
      (expected != null && registration !== expected)
    ) {
      return;
    }
    this.#registrations.delete(key);
    if (registration.signal != null && registration.onAbort != null) {
      registration.signal.removeEventListener('abort', registration.onAbort);
    }
    if (this.#registrations.size === 0) {
      watched.delete(this);
      releaseWatchingIfIdle();
    }
  }

  #evaluate(): boolean {
    return this.#queries.some(query => evaluateQuery(query) === true);
  }

  // Dispatches a change event only when the answer changed
  __refresh(): void {
    const now = this.#evaluate();
    if (this.#lastReported === now) {
      return;
    }
    this.#lastReported = now;
    const event: $FlowFixMe = new Event('change');
    event.matches = now;
    event.media = this.media;
    this.dispatchEvent(event);
  }
}

// The callback is held only by the WeakMap
let nextCallbackId = 1;
const callbackIds: WeakMap<$FlowFixMe, number> = new WeakMap();

function registrationKey(callback: $FlowFixMe, capture: boolean): string {
  let id = callbackIds.get(callback);
  if (id == null) {
    id = nextCallbackId++;
    callbackIds.set(callback, id);
  }
  return `${id}:${capture ? 'c' : 'b'}`;
}

function normalizeOptions(options: $FlowFixMe): {
  capture: boolean,
  signal: ?AbortSignalLike,
} {
  if (options == null) {
    return {capture: false, signal: null};
  }
  if (typeof options === 'boolean') {
    return {capture: options, signal: null};
  }
  return {
    capture: Boolean(options.capture),
    signal: options.signal ?? null,
  };
}

// -- The sources --

const DEFAULT_CAPABILITIES: DisplayCapabilities = {
  colorGamut: 'srgb',
  dynamicRange: 'standard',
};

function displayCapabilities(): DisplayCapabilities {
  return NativeDisplayCapabilities?.getCapabilities() ?? DEFAULT_CAPABILITIES;
}

const watched: Set<MediaQueryList> = new Set();
let subscriptions: ?Array<EventSubscription> = null;

function ensureWatching(): void {
  if (subscriptions != null) {
    return;
  }
  const refreshAll = () => {
    for (const list of Array.from(watched)) {
      list.__refresh();
    }
  };
  subscriptions = [Appearance.addChangeListener(refreshAll)];
  if (NativeDisplayCapabilities != null) {
    subscriptions.push(
      new NativeEventEmitter<{
        displayCapabilitiesDidChange: [DisplayCapabilities],
      }>(NativeDisplayCapabilities).addListener(
        'displayCapabilitiesDidChange',
        refreshAll,
      ),
    );
  }
}

function releaseWatchingIfIdle(): void {
  if (subscriptions == null || watched.size > 0) {
    return;
  }
  for (const subscription of subscriptions) {
    subscription.remove();
  }
  subscriptions = null;
}

// -- The grammar --

type Feature = {name: string, value: ?string};
type Query = {
  negated: boolean,
  // A media type this renderer doesn't describe (`print`) is valid and false
  mediaTypeMatches: boolean,
  features: ReadonlyArray<Feature>,
  valid: boolean,
};

const INVALID: Query = {
  negated: false,
  mediaTypeMatches: false,
  features: [],
  valid: false,
};

function parseQueryList(text: string): ReadonlyArray<Query> {
  return splitTopLevel(text, ',').map(parseQuery);
}

// Media Queries 5 §2.1: `[not | only]? <media-type> [and <feature>]*`, or
// `<feature> [and <feature>]*`, or `not <feature>` on its own
function parseQuery(text: string): Query {
  const tokens = splitTopLevel(text, /\s+and\s+/i).map(token => token.trim());
  if (tokens.some(token => token === '')) {
    return INVALID;
  }
  const first = tokens[0];
  const words = first.split(/\s+/);
  const modifier = words[0].toLowerCase();
  if (modifier === 'not' || modifier === 'only') {
    const rest = first.slice(words[0].length).trim();
    if (isMediaType(rest)) {
      // `not screen and (…)` negates the whole query
      return parseFeatures(tokens.slice(1), {
        negated: modifier === 'not',
        mediaTypeMatches: mediaTypeMatches(rest),
      });
    }
    // `not (feature)`, and nothing joined to it
    if (modifier === 'not' && tokens.length === 1 && isParenthesised(rest)) {
      return parseFeatures([rest], {negated: true, mediaTypeMatches: true});
    }
    return INVALID;
  }
  if (isMediaType(first)) {
    return parseFeatures(tokens.slice(1), {
      negated: false,
      mediaTypeMatches: mediaTypeMatches(first),
    });
  }
  return parseFeatures(tokens, {negated: false, mediaTypeMatches: true});
}

function parseFeatures(
  tokens: ReadonlyArray<string>,
  head: {negated: boolean, mediaTypeMatches: boolean},
): Query {
  const features = [];
  for (const token of tokens) {
    const feature = parseFeature(token);
    if (feature == null) {
      return INVALID;
    }
    features.push(feature);
  }
  return {...head, features, valid: true};
}

function isMediaType(text: string): boolean {
  return /^[a-z-]+$/i.test(text);
}

function mediaTypeMatches(type: string): boolean {
  const name = type.toLowerCase();
  return name === 'all' || name === 'screen';
}

function isParenthesised(text: string): boolean {
  return text.startsWith('(') && text.endsWith(')');
}

function parseFeature(text: string): ?Feature {
  const part = text.trim();
  if (!isParenthesised(part)) {
    return null;
  }
  const inner = part.slice(1, -1).trim();
  const colon = inner.indexOf(':');
  if (colon < 0) {
    return {name: inner.toLowerCase(), value: null};
  }
  return {
    name: inner.slice(0, colon).trim().toLowerCase(),
    value: inner
      .slice(colon + 1)
      .trim()
      .toLowerCase(),
  };
}

// Splits on a separator that isn't inside parentheses
function splitTopLevel(
  text: string,
  separator: string | RegExp,
): Array<string> {
  const parts = [];
  let depth = 0;
  let start = 0;
  const pattern =
    typeof separator === 'string'
      ? new RegExp(separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : new RegExp(
          separator.source,
          separator.flags.includes('g')
            ? separator.flags
            : separator.flags + 'g',
        );
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      pattern.lastIndex = i;
      const match = pattern.exec(text);
      if (match != null && match.index === i && match[0].length > 0) {
        parts.push(text.slice(start, i));
        i += match[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// -- Evaluation --

const GAMUT_RANK: {[string]: number} = {srgb: 0, p3: 1, rec2020: 2};

// Media Queries 5 §3.1: `unknown` stays unknown under `not`
type Truth = boolean | 'unknown';

function evaluateQuery(query: Query): Truth {
  if (!query.valid) {
    return false;
  }
  let result: Truth = query.mediaTypeMatches;
  for (const feature of query.features) {
    const value = evaluateFeature(feature);
    if (value === false || result === false) {
      result = false;
    } else if (value === 'unknown' || result === 'unknown') {
      result = 'unknown';
    }
  }
  if (query.negated) {
    return result === 'unknown' ? 'unknown' : !result;
  }
  return result;
}

// `color-gamut: p3` is true for P3 "or more"; in the boolean context every
// feature is true
function evaluateFeature(feature: Feature): Truth {
  const {name, value} = feature;
  switch (name) {
    case 'color-gamut': {
      if (value == null) {
        return true;
      }
      const asked = GAMUT_RANK[value];
      if (asked === undefined) {
        return 'unknown';
      }
      return asked <= (GAMUT_RANK[displayCapabilities().colorGamut] ?? 0);
    }
    case 'dynamic-range':
    case 'video-dynamic-range': {
      if (value == null || value === 'standard') {
        return true;
      }
      if (value === 'high') {
        return displayCapabilities().dynamicRange === 'high';
      }
      return 'unknown';
    }
    case 'prefers-color-scheme': {
      if (value == null) {
        return true;
      }
      if (value !== 'light' && value !== 'dark') {
        return 'unknown';
      }
      return value === (Appearance.getColorScheme() ?? 'light');
    }
    default:
      return 'unknown';
  }
}
