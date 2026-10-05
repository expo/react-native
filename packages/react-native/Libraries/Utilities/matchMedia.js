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
import type {MediaEnvironment, ParsedMediaQueryList} from './MediaQueries';
import type {DisplayCapabilities} from './NativeDisplayCapabilities';

import Event from '../../src/private/webapis/dom/events/Event';
import EventTarget from '../../src/private/webapis/dom/events/EventTarget';
import AccessibilityInfo from '../Components/AccessibilityInfo/AccessibilityInfo';
import NativeEventEmitter from '../EventEmitter/NativeEventEmitter';
import * as Appearance from './Appearance';
import Dimensions from './Dimensions';
import {parsedMediaQueryListMatches, parseMediaQueryList} from './MediaQueries';
import NativeDisplayCapabilities from './NativeDisplayCapabilities';
import PixelRatio from './PixelRatio';
import Platform from './Platform';

/**
 * `window.matchMedia` (cssom-view-1 §4), by the Media Queries 4 grammar in
 * MediaQueries.js, about the window: its size, aspect ratio, orientation and
 * resolution, the pointer, `prefers-color-scheme` and
 * `prefers-reduced-motion`, and the display's `color-gamut` and
 * `dynamic-range` (Media Queries 5 §6), each asked of the OS.
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
  #queries: ParsedMediaQueryList;

  constructor(query: string) {
    super();
    this.media = query.trim();
    this.#queries = parseMediaQueryList(this.media);
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
    return parsedMediaQueryListMatches(this.#queries, windowMediaEnvironment());
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

// -- The window --

const DEFAULT_CAPABILITIES: DisplayCapabilities = {
  colorGamut: 'srgb',
  dynamicRange: 'standard',
};

function displayCapabilities(): DisplayCapabilities {
  return NativeDisplayCapabilities?.getCapabilities() ?? DEFAULT_CAPABILITIES;
}

// The touchscreen is the pointer on a phone or tablet. An iPad's trackpad, a
// mouse or a stylus is not asked about, so `any-pointer: fine` and
// `any-hover: hover` are false beside one.
// DOM-CSS-LIMITATION(media-pointer-is-the-touchscreen)
const TOUCH_FIRST: boolean = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * The window as a media query sees it. A stylesheet engine that styles a
 * surface smaller than the window can spread this and give the surface's
 * size instead.
 */
export function windowMediaEnvironment(): MediaEnvironment {
  askReducedMotion();
  const {width, height} = Dimensions.get('window');
  return {
    width,
    height,
    viewportWidth: width,
    viewportHeight: height,
    resolution: PixelRatio.get(),
    colorScheme: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
    reducedMotion,
    pointer: TOUCH_FIRST ? 'coarse' : 'fine',
    hover: !TOUCH_FIRST,
    display: displayCapabilities,
  };
}

// The OS answers the reduce-motion setting asynchronously, so it is kept here
// and kept current. Until the first answer, motion is allowed, as the web's
// default is; a list whose answer then changes fires `change`.
// DOM-CSS-LIMITATION(reduced-motion-is-known-after-the-first-read)
let reducedMotion = false;
let askedReducedMotion = false;

// Asked once, and the change listener kept for the life of the app rather
// than released with the other sources when no list is watched, so a read
// without listeners is current too
function askReducedMotion(): void {
  if (askedReducedMotion) {
    return;
  }
  askedReducedMotion = true;
  // A change event is newer than the first answer, which may arrive after it
  let changed = false;
  const update = (enabled: boolean) => {
    if (reducedMotion !== (enabled === true)) {
      reducedMotion = enabled === true;
      refreshAll();
    }
  };
  AccessibilityInfo.isReduceMotionEnabled().then(
    enabled => {
      if (!changed) {
        update(enabled);
      }
    },
    () => {},
  );
  AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
    changed = true;
    update(enabled);
  });
}

const watched: Set<MediaQueryList> = new Set();
let subscriptions: ?Array<EventSubscription> = null;

function refreshAll(): void {
  for (const list of Array.from(watched)) {
    list.__refresh();
  }
}

function ensureWatching(): void {
  if (subscriptions != null) {
    return;
  }
  askReducedMotion();
  subscriptions = [
    Appearance.addChangeListener(refreshAll),
    Dimensions.addEventListener('change', refreshAll),
  ];
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
