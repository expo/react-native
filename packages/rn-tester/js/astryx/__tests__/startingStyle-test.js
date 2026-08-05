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

import {
  parseDurationMs,
  parseTranslate,
  toStartingStyle,
} from '../startingStyle';
import * as stylex from '../stylex-rn';

describe('reading a CSS duration', () => {
  it('reads milliseconds and seconds', () => {
    expect(parseDurationMs('200ms')).toBe(200);
    expect(parseDurationMs('0.2s')).toBe(200);
    expect(parseDurationMs('1s')).toBe(1000);
  });

  // Astryx's reduced-motion branches use 0.01ms. It has to survive as a
  // near-zero rather than being treated as absent, because "animate instantly"
  // and "do not animate" take different paths.
  it('keeps a near-zero duration', () => {
    expect(parseDurationMs('0.01ms')).toBeCloseTo(0.01, 4);
  });

  it('falls back when there is no duration', () => {
    expect(parseDurationMs(null)).toBe(200);
    expect(parseDurationMs('nonsense')).toBe(200);
  });
});

describe('reading a transform', () => {
  it('picks out translateY', () => {
    expect(parseTranslate('translateY(8px)')).toEqual({y: 8});
  });

  it('picks out a negative translateY', () => {
    expect(parseTranslate('translateY(-4px)')).toEqual({y: -4});
  });

  it('picks out both axes', () => {
    expect(parseTranslate('translateX(2px) translateY(3px)')).toEqual({
      x: 2,
      y: 3,
    });
  });

  // `translateY(100%)` is relative to the element's own height, which is not
  // known without measuring it. Ignored rather than guessed at.
  it('ignores a percentage translate rather than guessing', () => {
    expect(parseTranslate('translateY(100%)')).toEqual({});
  });
});

describe('extracting the starting values', () => {
  it('takes opacity and translate', () => {
    expect(toStartingStyle({opacity: 0, transform: 'translateY(8px)'})).toEqual(
      {opacity: 0, translateY: 8},
    );
  });

  // Nothing animatable means no animation at all, so callers can skip the
  // animated element entirely rather than mount one that does nothing.
  it('returns null when there is nothing it can animate', () => {
    expect(toStartingStyle({backgroundColor: 'red'})).toBeNull();
    expect(toStartingStyle(null)).toBeNull();
  });
});

describe('through the style pipeline', () => {
  it('carries the starting values and the transition off the props', () => {
    const props = stylex.props({
      opacity: 1,
      transitionDuration: '300ms',
      transitionTimingFunction: 'ease-out',
      '@starting-style': {opacity: 0, transform: 'translateY(8px)'},
    });
    expect(props.__startingStyle).toEqual({opacity: 0, translateY: 8});
    expect(props.__entryTransition).toEqual({
      durationMs: 300,
      easing: 'ease-out',
    });
  });

  it('resolves tokens inside the starting block', () => {
    // The block goes through the same resolution as any other declarations,
    // so a var() in it is substituted rather than passed through raw.
    const props = stylex.props({
      '@starting-style': {
        opacity: 0,
        transform: 'translateY(var(--nope, 6px))',
      },
    });
    expect(props.__startingStyle).toEqual({opacity: 0, translateY: 6});
  });

  it('says nothing when there is no starting block', () => {
    const props = stylex.props({opacity: 1});
    expect(props.__startingStyle).toBeUndefined();
    expect(props.__entryTransition).toBeUndefined();
  });
});
