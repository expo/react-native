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
 * `@starting-style` (css-transitions-2 §3) — the values an element animates
 * FROM the first time it renders.
 *
 * On the web the browser paints the starting values for one frame, then
 * transitions to the real ones; that is how a toast slides up as it appears
 * instead of popping into place. React Native has no transitions at all, so
 * the equivalent is an explicit animation from the starting values on mount.
 *
 * Scoped to what Astryx actually writes. Across its five uses the blocks only
 * ever set `opacity` and `transform: translateY(...)`, always paired with a
 * `transition-duration` and easing on the same rule — so those are what this
 * animates, and anything else is ignored rather than half-applied.
 * DOM-CSS-LIMITATION(starting-style-subset)
 */

import {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing} from 'react-native';

export type StartingStyle = {
  opacity?: number,
  translateY?: number,
  translateX?: number,
};

export type EntryTransition = {
  durationMs: number,
  easing: string,
};

const DEFAULT_DURATION_MS = 200;

/**
 * Reads a CSS duration (`200ms`, `0.2s`) as milliseconds.
 *
 * `0.01ms` appears in Astryx's reduced-motion branches and must survive as a
 * near-zero rather than being rounded to nothing, since a zero-length
 * animation and no animation take different code paths in RN.
 */
export function parseDurationMs(value: ?string): number {
  if (value == null) {
    return DEFAULT_DURATION_MS;
  }
  const text = String(value).trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) {
    return DEFAULT_DURATION_MS;
  }
  return text.endsWith('ms') ? number : number * 1000;
}

/**
 * Maps a CSS timing function onto RN's easing curves.
 *
 * `cubic-bezier()` is passed through exactly; the keywords are their defined
 * bezier equivalents (css-easing-1 §2.1) rather than approximations.
 */
export function parseEasing(value: ?string): (t: number) => number {
  const text = (value ?? 'ease').trim();
  const bezier = text.match(
    /^cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)$/,
  );
  if (bezier != null) {
    return Easing.bezier(
      parseFloat(bezier[1]),
      parseFloat(bezier[2]),
      parseFloat(bezier[3]),
      parseFloat(bezier[4]),
    );
  }
  switch (text) {
    case 'linear':
      return Easing.linear;
    case 'ease-in':
      return Easing.bezier(0.42, 0, 1, 1);
    case 'ease-out':
      return Easing.bezier(0, 0, 0.58, 1);
    case 'ease-in-out':
      return Easing.bezier(0.42, 0, 0.58, 1);
    case 'step-start':
      return Easing.step0;
    case 'step-end':
      return Easing.step1;
    default:
      // `ease`, and anything unrecognised.
      return Easing.bezier(0.25, 0.1, 0.25, 1);
  }
}

/** Pulls `translateY`/`translateX` out of a `transform` value. */
export function parseTranslate(transform: unknown): {x?: number, y?: number} {
  if (typeof transform !== 'string') {
    return {};
  }
  const out: {x?: number, y?: number} = {};
  const y = transform.match(/translateY\(\s*(-?[\d.]+)px\s*\)/);
  if (y != null) {
    out.y = parseFloat(y[1]);
  }
  const x = transform.match(/translateX\(\s*(-?[\d.]+)px\s*\)/);
  if (x != null) {
    out.x = parseFloat(x[1]);
  }
  // `translateY(100%)` appears in Astryx's slide-from-bottom. A percentage is
  // relative to the element's own height, which is not known here — the
  // element would have to measure itself first. Ignored rather than guessed.
  // DOM-CSS-LIMITATION(starting-style-percentage-translate)
  return out;
}

/**
 * Animates from `starting` to the element's resolved style on mount.
 *
 * Returns a style object to merge over the resolved one. The animation runs
 * once: `@starting-style` is about first appearance, and re-running it on
 * every re-render would make an element that updates flicker.
 */
export function useEntryTransition(
  starting: ?StartingStyle,
  transition: ?EntryTransition,
): ?{opacity?: unknown, transform?: unknown} {
  const active = starting != null && Object.keys(starting).length > 0;
  // 0 at mount, driven to 1. Interpolating one value keeps the properties in
  // step and needs a single animation regardless of how many are involved.
  const progress = useRef(new Animated.Value(0)).current;
  const hasRun = useRef(false);

  useEffect(() => {
    if (!active || hasRun.current) {
      return;
    }
    hasRun.current = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: transition?.durationMs ?? DEFAULT_DURATION_MS,
      easing: parseEasing(transition?.easing),
      // Both animated properties are transform/opacity, which the native
      // driver supports — so this runs off the JS thread.
      useNativeDriver: true,
    }).start();
  }, [active, progress, transition]);

  return useMemo(() => {
    if (!active || starting == null) {
      return null;
    }
    const style: {opacity?: unknown, transform?: unknown} = {};
    if (starting.opacity != null) {
      style.opacity = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [starting.opacity, 1],
      });
    }
    // Heterogeneous by nature: RN's transform array holds one key per entry.
    const transforms: Array<{[string]: unknown}> = [];
    if (starting.translateY != null) {
      transforms.push({
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [starting.translateY, 0],
        }),
      });
    }
    if (starting.translateX != null) {
      transforms.push({
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [starting.translateX, 0],
        }),
      });
    }
    if (transforms.length > 0) {
      style.transform = transforms;
    }
    return style;
  }, [active, starting, progress]);
}

/**
 * Extracts the animatable subset of a resolved `@starting-style` block.
 *
 * Returns null when there is nothing this can animate, so callers can skip the
 * animated wrapper entirely rather than mounting one that does nothing.
 */
export function toStartingStyle(block: unknown): ?StartingStyle {
  if (block == null || typeof block !== 'object') {
    return null;
  }
  const out: StartingStyle = {};
  // $FlowFixMe[incompatible-use] reading a resolved style block
  const opacity = block.opacity;
  if (typeof opacity === 'number') {
    out.opacity = opacity;
  }
  // $FlowFixMe[incompatible-use] reading a resolved style block
  const {x, y} = parseTranslate(block.transform);
  if (x != null) {
    out.translateX = x;
  }
  if (y != null) {
    out.translateY = y;
  }
  return Object.keys(out).length > 0 ? out : null;
}
