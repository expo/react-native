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

import type {MediaEnvironment} from '../MediaQueries';
import type {DisplayCapabilities} from '../NativeDisplayCapabilities';

const {mediaQueryListMatches} = require('../MediaQueries');

// An iPhone in portrait
const PHONE: MediaEnvironment = {
  width: 402,
  height: 874,
  viewportWidth: 402,
  viewportHeight: 874,
  resolution: 3,
  colorScheme: 'light',
  reducedMotion: false,
  pointer: 'coarse',
  hover: false,
  display: () => ({colorGamut: 'p3', dynamicRange: 'high'}),
};

function matches(
  query: string,
  environment: MediaEnvironment = PHONE,
): boolean {
  return mediaQueryListMatches(query, environment);
}

describe('mediaQueryListMatches', () => {
  it('compares width and height by min-, max- and plain features', () => {
    expect(matches('(max-width: 768px)')).toBe(true);
    expect(matches('(min-width: 768px)')).toBe(false);
    expect(matches('(width: 402px)')).toBe(true);
    expect(matches('(min-height: 800px) and (max-height: 900px)')).toBe(true);
    expect(matches('(min-width: 768px)', {...PHONE, width: 1024})).toBe(true);
  });

  it('reads the range syntax either way round, and between two values', () => {
    expect(matches('(width < 768px)')).toBe(true);
    expect(matches('(768px > width)')).toBe(true);
    expect(matches('(width >= 402px)')).toBe(true);
    expect(matches('(width > 402px)')).toBe(false);
    expect(matches('(400px <= width < 500px)')).toBe(true);
    expect(matches('(500px > width >= 400px)')).toBe(true);
    expect(matches('(403px <= width <= 500px)')).toBe(false);
    // The two comparisons of a double range point the same way
    expect(matches('(400px < width > 300px)')).toBe(false);
    expect(matches('not (400px < width > 300px)')).toBe(false);
  });

  it('converts lengths: em and rem as 16px, absolute units, viewport units', () => {
    expect(matches('(max-width: 48em)')).toBe(true);
    expect(matches('(min-width: 25rem)')).toBe(true);
    expect(matches('(min-width: 26rem)')).toBe(false);
    expect(matches('(max-width: 5in)')).toBe(true);
    expect(matches('(width: 100vw)')).toBe(true);
    expect(matches('(height > 50vh)')).toBe(true);
    expect(matches('(min-width: 0)')).toBe(true);
    // A number other than zero needs a unit
    expect(matches('(min-width: 10)')).toBe(false);
  });

  it('answers aspect-ratio, orientation and resolution', () => {
    expect(matches('(max-aspect-ratio: 1/1)')).toBe(true);
    expect(matches('(min-aspect-ratio: 16 / 9)')).toBe(false);
    expect(matches('(aspect-ratio < 1)')).toBe(true);
    expect(matches('(orientation: portrait)')).toBe(true);
    expect(matches('(orientation: landscape)')).toBe(false);
    expect(
      matches('(orientation: landscape)', {...PHONE, width: 874, height: 402}),
    ).toBe(true);
    expect(matches('(min-resolution: 2dppx)')).toBe(true);
    expect(matches('(min-resolution: 2x)')).toBe(true);
    expect(matches('(resolution >= 192dpi)')).toBe(true);
    expect(matches('(max-resolution: 1dppx)')).toBe(false);
  });

  it('answers the pointer and hover of a touchscreen', () => {
    expect(matches('(hover: none)')).toBe(true);
    expect(matches('(hover: hover)')).toBe(false);
    expect(matches('(hover)')).toBe(false);
    expect(matches('(any-hover: hover)')).toBe(false);
    expect(matches('(pointer: coarse)')).toBe(true);
    expect(matches('(pointer: fine)')).toBe(false);
    expect(matches('(pointer)')).toBe(true);
    expect(matches('(any-pointer: coarse)')).toBe(true);
    expect(matches('(max-width: 768px) and (pointer: coarse)')).toBe(true);
    const desk = {...PHONE, pointer: 'fine' as const, hover: true};
    expect(matches('(hover: hover) and (pointer: fine)', desk)).toBe(true);
  });

  it('answers the preferences', () => {
    expect(matches('(prefers-color-scheme: light)')).toBe(true);
    expect(matches('(prefers-color-scheme: dark)')).toBe(false);
    expect(matches('(prefers-color-scheme)')).toBe(true);
    expect(matches('(prefers-reduced-motion: no-preference)')).toBe(true);
    expect(matches('(prefers-reduced-motion)')).toBe(false);
    const still = {...PHONE, reducedMotion: true};
    expect(matches('(prefers-reduced-motion: reduce)', still)).toBe(true);
    expect(matches('(prefers-reduced-motion)', still)).toBe(true);
  });

  it('asks the display only for a gamut or a dynamic range', () => {
    const display = jest.fn((): DisplayCapabilities => ({
      colorGamut: 'srgb',
      dynamicRange: 'standard',
    }));
    const environment = {...PHONE, display};
    expect(matches('(min-width: 1px)', environment)).toBe(true);
    expect(display).not.toHaveBeenCalled();
    expect(matches('(color-gamut: p3)', environment)).toBe(false);
    expect(matches('(dynamic-range: high)', environment)).toBe(false);
    expect(matches('(color-gamut: p3)')).toBe(true);
    expect(matches('(dynamic-range: high)')).toBe(true);
  });

  it('parses or, nesting and not, which and does not mix with or unbracketed', () => {
    expect(matches('(min-width: 768px) or (pointer: coarse)')).toBe(true);
    expect(matches('(min-width: 768px) or (hover: hover)')).toBe(false);
    expect(
      matches('((min-width: 768px) or (pointer: coarse)) and (hover: none)'),
    ).toBe(true);
    expect(matches('not ((min-width: 768px) and (hover: hover))')).toBe(true);
    expect(matches('(hover: none) and (not (pointer: fine))')).toBe(true);
    expect(matches('(a: b) or (pointer: coarse)')).toBe(true);
    // Mixing and and or without brackets is invalid, so false under not too
    expect(
      matches('(pointer: coarse) and (hover: none) or (hover: hover)'),
    ).toBe(false);
    expect(matches('not (pointer: coarse) and (hover: none)')).toBe(false);
  });

  it('takes a media type with only, not, and a condition without or', () => {
    expect(matches('screen')).toBe(true);
    expect(matches('only screen and (max-width: 768px)')).toBe(true);
    expect(matches('not screen and (min-width: 768px)')).toBe(true);
    expect(matches('screen and not (min-width: 768px)')).toBe(true);
    expect(matches('print')).toBe(false);
    expect(matches('not print')).toBe(true);
    expect(matches('speech and (max-width: 768px)')).toBe(false);
    expect(matches('screen and (min-width: 1px) or (hover: none)')).toBe(false);
    expect(matches('only (max-width: 768px)')).toBe(false);
    expect(matches('not and (max-width: 768px)')).toBe(false);
  });

  it('keeps an unknown feature unknown, and false under not', () => {
    expect(matches('(paper-size: a4)')).toBe(false);
    expect(matches('not (paper-size: a4)')).toBe(false);
    expect(matches('(min-orientation: portrait)')).toBe(false);
    expect(matches('(orientation: diagonal)')).toBe(false);
    expect(matches('not (orientation: diagonal)')).toBe(false);
    expect(matches('(width > height)')).toBe(false);
    expect(matches('selector(:hover)')).toBe(false);
    // Unknown and false is false, so not makes it true
    expect(matches('not ((paper-size: a4) and (hover: hover))')).toBe(true);
  });

  it('is true for an empty list, and reads each query of a list', () => {
    expect(matches('')).toBe(true);
    expect(matches('print, (max-width: 768px)')).toBe(true);
    expect(matches('print, (min-width: 768px)')).toBe(false);
    expect(matches('(hover: hover), , (pointer: coarse)')).toBe(true);
    expect(matches('(max-width: 768px')).toBe(false);
    expect(matches('SCREEN AND (MAX-WIDTH: 768PX)')).toBe(true);
  });

  it('reads a name off the object prototype as unknown, not as a feature', () => {
    expect(matches('(constructor)')).toBe(false);
    expect(matches('(constructor: 1)')).toBe(false);
    expect(matches('(constructor) or (width > 0)')).toBe(true);
    expect(matches('(min-width: 1tostring)')).toBe(false);
  });

  it('resolves viewport units against the viewport, not the queried box', () => {
    const container = {...PHONE, width: 300, viewportWidth: 1000};
    expect(matches('(width > 50vw)', container)).toBe(false);
    expect(matches('(width < 50vw)', container)).toBe(true);
  });

  it('takes only an identifier as a media type', () => {
    expect(matches('not 123')).toBe(false);
    expect(matches('not @screen')).toBe(false);
    expect(matches('not screen;')).toBe(false);
    expect(matches('not --custom')).toBe(true);
  });

  it('drops comments as CSS tokenizes them', () => {
    expect(matches('not screen/**/')).toBe(false);
    expect(matches('screen/**/ and (width > 0)')).toBe(true);
    expect(matches('(width > 0) /* and (hover: hover) */')).toBe(true);
  });

  it('keeps strings and brackets inside a general-enclosed term', () => {
    expect(matches('future(")") or (width > 0)')).toBe(true);
    expect(matches('future("a, b") or (width > 0)')).toBe(true);
    expect(matches('(]) or (width > 0)')).toBe(false);
    expect(matches('([x]) or (width > 0)')).toBe(true);
  });

  it('takes a decimal point only before a digit', () => {
    expect(matches('(width: 402.px)')).toBe(false);
    expect(matches('(width: 402.0px)')).toBe(true);
    expect(matches('(min-width: .5px)')).toBe(true);
  });
});
