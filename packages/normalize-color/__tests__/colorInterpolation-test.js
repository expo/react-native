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

import {
  approximateSRGB,
  interpolateColor,
  parseInterpolationMethod,
} from '../colorInterpolation';
import normalizeColorSpace from '../colorSpaces';

const BLUE = 0x0000ffff;
const YELLOW = 0xffff00ff;
const RED = 0xff0000ff;
const TRANSPARENT = 0x00000000;

function close(actual: ?{...}, expected: {...}, digits: number = 4) {
  expect(actual).not.toBe(null);
  for (const key of Object.keys(expected)) {
    // $FlowFixMe[prop-missing]
    const value = actual?.[key];
    if (typeof expected[key] === 'number') {
      expect(value).toBeCloseTo(expected[key], digits);
    } else {
      expect(value).toBe(expected[key]);
    }
  }
}

const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

describe('parseInterpolationMethod', () => {
  it('finds the method among the other words, with its hue method', () => {
    expect(parseInterpolationMethod(['in', 'oklab', 'to', 'right'])).toEqual({
      method: {space: 'oklab', hue: 'shorter'},
      rest: ['to', 'right'],
    });
    expect(
      parseInterpolationMethod(['45deg', 'in', 'oklch', 'longer', 'hue']),
    ).toEqual({method: {space: 'oklch', hue: 'longer'}, rest: ['45deg']});
    expect(parseInterpolationMethod(['in', 'xyz'])?.method?.space).toBe(
      'xyz-d65',
    );
  });

  it('refuses an unknown space and a hue method on a rectangular one', () => {
    expect(parseInterpolationMethod(['in', 'nowhere'])).toEqual({error: true});
    expect(parseInterpolationMethod(['in'])).toEqual({error: true});
    expect(parseInterpolationMethod(['to', 'right'])).toBe(null);
  });
});

describe('interpolateColor', () => {
  it('gives each end back exactly', () => {
    const method = {space: 'oklab', hue: 'shorter'};
    close(interpolateColor(BLUE, YELLOW, 0, method), {
      r: 0,
      g: 0,
      b: 1,
      alpha: 1,
    });
    close(interpolateColor(BLUE, YELLOW, 1, method), {
      r: 1,
      g: 1,
      b: 0,
      alpha: 1,
    });
  });

  it('mixes in sRGB to the sRGB midpoint', () => {
    // sRGB's midpoint of blue and yellow is 50% gray, in linear terms 0.214
    close(
      interpolateColor(BLUE, YELLOW, 0.5, {space: 'srgb', hue: 'shorter'}),
      {r: linear(0.5), g: linear(0.5), b: linear(0.5)},
    );
  });

  it('mixes in Oklab to a lighter midpoint than sRGB', () => {
    const srgb = interpolateColor(BLUE, YELLOW, 0.5, {
      space: 'srgb',
      hue: 'shorter',
    });
    const oklab = interpolateColor(BLUE, YELLOW, 0.5, {
      space: 'oklab',
      hue: 'shorter',
    });
    const luminance = (c: $FlowFixMe) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(luminance(oklab)).toBeGreaterThan(luminance(srgb));
  });

  it('premultiplies, so a fade to transparent keeps its hue', () => {
    close(
      interpolateColor(RED, TRANSPARENT, 0.5, {space: 'srgb', hue: 'shorter'}),
      {r: 1, g: 0, b: 0, alpha: 0.5},
    );
  });

  it('goes round the hue wheel as each hue method says', () => {
    // Red's oklch hue is about 29°, blue's about 264°
    const at = (hue: string) =>
      interpolateColor(RED, BLUE, 0.5, {space: 'oklch', hue});
    const shorter = at('shorter');
    const longer = at('longer');
    // The short way passes through magenta, the long way through green
    expect(shorter?.r).toBeGreaterThan(shorter?.g ?? 0);
    expect(longer?.g).toBeGreaterThan(longer?.r ?? 0);
  });

  it('mixes colors written in their own spaces', () => {
    const p3Red = normalizeColorSpace('color(display-p3 1 0 0)');
    close(
      interpolateColor(p3Red, p3Red, 0.5, {space: 'oklab', hue: 'shorter'}),
      {
        r: 1.2249,
        g: -0.0421,
        b: -0.0196,
      },
      3,
    );
  });

  it("refuses a color CSS doesn't define", () => {
    const dashed = normalizeColorSpace('color(--dci-p3 1 0 0)');
    expect(
      interpolateColor(dashed, RED, 0.5, {space: 'oklab', hue: 'shorter'}),
    ).toBe(null);
  });
});

describe('HDR spaces', () => {
  it('reads a PQ or HLG reference white as SDR white', () => {
    const pqWhite = normalizeColorSpace('color(rec2100-pq 0.58 0.58 0.58)');
    const mixed = interpolateColor(pqWhite, pqWhite, 0.5, {
      space: 'oklab',
      hue: 'shorter',
    });
    close(mixed, {r: 1, g: 1, b: 1}, 1);
    const hlgWhite = normalizeColorSpace('color(rec2100-hlg 0.75 0.75 0.75)');
    close(
      interpolateColor(hlgWhite, hlgWhite, 0.5, {
        space: 'oklab',
        hue: 'shorter',
      }),
      {r: 1, g: 1, b: 1},
      1,
    );
  });

  it('keeps a linear Rec. 2020 value above white', () => {
    const bright = normalizeColorSpace('color(rec2100-linear 2 2 2)');
    const mixed = interpolateColor(bright, bright, 0.5, {
      space: 'srgb-linear',
      hue: 'shorter',
    });
    close(mixed, {r: 2, g: 2, b: 2}, 2);
  });
});

describe('approximateSRGB', () => {
  it('gives an integer back, and the nearest sRGB integer for a wide color', () => {
    expect(approximateSRGB(RED)).toBe(RED);
    expect(approximateSRGB(normalizeColorSpace('color(srgb 1 0 0)'))).toBe(
      0xff0000ff,
    );
    // P3 red clips to sRGB red
    expect(
      approximateSRGB(normalizeColorSpace('color(display-p3 1 0 0 / 0.5)')),
    ).toBe(0xff000080);
    expect(approximateSRGB(normalizeColorSpace('color(--dci-p3 1 0 0)'))).toBe(
      null,
    );
  });
});
