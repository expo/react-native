/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

import normalizeColorSpace from '../colorSpaces';

// After CSS Color 4's parsing rules and WPT's `css/css-color/parsing` cases;
// expected values are parsed values, before any conversion

describe('css-syntax numbers', () => {
  it('refuses a trailing dot, as CSS tokenizes it apart', () => {
    expect(normalizeColorSpace('color(srgb 1. 0 0)')).toBe(null);
    expect(normalizeColorSpace('color(srgb 1.0 0 0)')).not.toBe(null);
    expect(normalizeColorSpace('color(srgb .5 0 0)')).not.toBe(null);
  });

  it("accepts CSS's whitespace between channels", () => {
    expect(normalizeColorSpace('color(srgb\r1\f0 0)')).not.toBe(null);
  });
});

describe('color()', () => {
  it('keeps each predefined RGB space and its channels', () => {
    for (const space of [
      'srgb',
      'srgb-linear',
      'display-p3',
      'display-p3-linear',
      'a98-rgb',
      'prophoto-rgb',
      'rec2020',
    ]) {
      expect(normalizeColorSpace(`color(${space} 0.1 0.2 0.3)`)).toEqual({
        space,
        r: 0.1,
        g: 0.2,
        b: 0.3,
        alpha: 1,
      });
    }
  });

  it('reads percentages as fractions of 1', () => {
    expect(normalizeColorSpace('color(display-p3 100% 50% 0%)')).toEqual({
      space: 'display-p3',
      r: 1,
      g: 0.5,
      b: 0,
      alpha: 1,
    });
  });

  it("keeps out-of-range channels, which CSS doesn't clamp", () => {
    expect(normalizeColorSpace('color(srgb-linear 2 -0.5 1.5)')).toEqual({
      space: 'srgb-linear',
      r: 2,
      g: -0.5,
      b: 1.5,
      alpha: 1,
    });
  });

  it('reads `none` as 0', () => {
    expect(normalizeColorSpace('color(srgb none 1 none / none)')).toEqual({
      space: 'srgb',
      r: 0,
      g: 1,
      b: 0,
      alpha: 0,
    });
  });

  it('reads alpha as a number or a percentage, clamped to [0, 1]', () => {
    expect(normalizeColorSpace('color(srgb 1 0 0 / 0.5)')?.alpha).toBe(0.5);
    expect(normalizeColorSpace('color(srgb 1 0 0 / 25%)')?.alpha).toBe(0.25);
    expect(normalizeColorSpace('color(srgb 1 0 0 / 2)')?.alpha).toBe(1);
    expect(normalizeColorSpace('color(srgb 1 0 0 / -1)')?.alpha).toBe(0);
  });

  it('matches function and space names case-insensitively', () => {
    expect(normalizeColorSpace('COLOR(Display-P3 1 0 0)')).toEqual({
      space: 'display-p3',
      r: 1,
      g: 0,
      b: 0,
      alpha: 1,
    });
  });

  it('names xyz as xyz-d65, its CSS alias', () => {
    expect(normalizeColorSpace('color(xyz 0.1 0.2 0.3)')).toEqual({
      space: 'xyz-d65',
      x: 0.1,
      y: 0.2,
      z: 0.3,
      alpha: 1,
    });
    expect(normalizeColorSpace('color(xyz-d50 0.1 0.2 0.3)')?.space).toBe(
      'xyz-d50',
    );
  });

  it('keeps CSS Color HDR spaces and HDR values', () => {
    expect(normalizeColorSpace('color(rec2100-pq 0.58 0.58 0.58)')).toEqual({
      space: 'rec2100-pq',
      r: 0.58,
      g: 0.58,
      b: 0.58,
      alpha: 1,
    });
    expect(normalizeColorSpace('color(rec2100-linear 4 4 4)')?.r).toBe(4);
  });

  it('keeps the standard dashed spaces, case-sensitively', () => {
    expect(normalizeColorSpace('color(--dci-p3 1 0 0)')).toEqual({
      space: '--dci-p3',
      r: 1,
      g: 0,
      b: 0,
      alpha: 1,
    });
    // A dashed ident is case-sensitive, as CSS's custom identifiers are
    expect(normalizeColorSpace('color(--DCI-P3 1 0 0)')).toBe(null);
  });

  it('spreads a one-channel gray space over RGB', () => {
    expect(normalizeColorSpace('color(--gray-linear 0.25)')).toEqual({
      space: '--gray-linear',
      r: 0.25,
      g: 0.25,
      b: 0.25,
      alpha: 1,
    });
    expect(normalizeColorSpace('color(--gray-linear 0.25 0.5 1)')).toBe(null);
  });

  it('refuses what CSS refuses', () => {
    for (const invalid of [
      'color(srgb 1 0)',
      'color(srgb 1 0 0 0)',
      'color(srgb, 1, 0, 0)',
      'color(srgb 1 0 0 / 1 / 1)',
      'color(srgb 1deg 0 0)',
      'color(unknown 1 0 0)',
      'color(--unknown 1 0 0)',
      'color(1 0 0)',
      'color()',
      'color(srgb 1 0 0',
      'colour(srgb 1 0 0)',
      'color(srgb 1e999 0 0)',
      'lch(50 30 1e999)',
    ]) {
      expect(normalizeColorSpace(invalid)).toBe(null);
    }
  });
});

describe('lab() and oklab()', () => {
  it('reads lightness and the a and b axes', () => {
    expect(normalizeColorSpace('lab(54 80 70)')).toEqual({
      space: 'lab',
      l: 54,
      a: 80,
      b: 70,
      alpha: 1,
    });
    expect(normalizeColorSpace('oklab(0.6 0.2 -0.1 / 0.5)')).toEqual({
      space: 'oklab',
      l: 0.6,
      a: 0.2,
      b: -0.1,
      alpha: 0.5,
    });
  });

  it("resolves percentages against each channel's reference range", () => {
    // lab: 100% L = 100, 100% a or b = 125
    expect(normalizeColorSpace('lab(50% 100% -100%)')).toEqual({
      space: 'lab',
      l: 50,
      a: 125,
      b: -125,
      alpha: 1,
    });
    // oklab: 100% L = 1, 100% a or b = 0.4
    expect(normalizeColorSpace('oklab(50% 50% -50%)')).toEqual({
      space: 'oklab',
      l: 0.5,
      a: 0.2,
      b: -0.2,
      alpha: 1,
    });
  });

  it('clamps lightness at parsed-value time', () => {
    expect(normalizeColorSpace('lab(150 0 0)')?.l).toBe(100);
    expect(normalizeColorSpace('lab(-10 0 0)')?.l).toBe(0);
    expect(normalizeColorSpace('oklab(1.5 0 0)')?.l).toBe(1);
  });

  it('refuses a hue or the wrong number of channels', () => {
    expect(normalizeColorSpace('lab(50 0deg 0)')).toBe(null);
    expect(normalizeColorSpace('lab(50 0)')).toBe(null);
    expect(normalizeColorSpace('oklab(0.5, 0, 0)')).toBe(null);
  });
});

describe('lch() and oklch()', () => {
  it('reads lightness, chroma and hue', () => {
    expect(normalizeColorSpace('lch(54 100 40)')).toEqual({
      space: 'lch',
      l: 54,
      c: 100,
      h: 40,
      alpha: 1,
    });
    expect(normalizeColorSpace('oklch(0.7 0.2 30 / 80%)')).toEqual({
      space: 'oklch',
      l: 0.7,
      c: 0.2,
      h: 30,
      alpha: 0.8,
    });
  });

  it('reads a hue in any angle unit and normalizes it to [0, 360)', () => {
    expect(normalizeColorSpace('oklch(0.5 0.1 0.5turn)')?.h).toBeCloseTo(180);
    expect(normalizeColorSpace('oklch(0.5 0.1 200grad)')?.h).toBeCloseTo(180);
    expect(normalizeColorSpace('oklch(0.5 0.1 3.14159265rad)')?.h).toBeCloseTo(
      180,
    );
    expect(normalizeColorSpace('oklch(0.5 0.1 -90deg)')?.h).toBe(270);
    expect(normalizeColorSpace('oklch(0.5 0.1 720)')?.h).toBe(0);
  });

  it('resolves chroma percentages and clamps negative chroma to 0', () => {
    expect(normalizeColorSpace('lch(50 100% 0)')?.c).toBe(150);
    expect(normalizeColorSpace('oklch(0.5 50% 0)')?.c).toBe(0.2);
    expect(normalizeColorSpace('lch(50 -10 0)')?.c).toBe(0);
  });

  it('refuses a percentage hue', () => {
    expect(normalizeColorSpace('lch(50 10 10%)')).toBe(null);
  });
});

describe('everything else', () => {
  it('is left to the legacy parser or refused', () => {
    for (const other of [
      'red',
      '#ff0000',
      'rgb(255 0 0)',
      'hsl(0 100% 50%)',
      'hwb(0 0% 0%)',
      'color-mix(in oklab, red, blue)',
      '',
      'lab',
    ]) {
      expect(normalizeColorSpace(other)).toBe(null);
    }
    // $FlowExpectedError[incompatible-type]
    expect(normalizeColorSpace(0xff0000ff)).toBe(null);
  });
});
