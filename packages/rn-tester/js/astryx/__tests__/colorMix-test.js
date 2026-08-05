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

import {parseColor, resolveColorMixArgs} from '../colorMix';
import * as stylex from '../stylex-rn';

/** The resolved mix as {r,g,b,a} in 0..255 / 0..1, for readable assertions. */
function mix(expression: string) {
  const resolved = resolveColorMixArgs(expression);
  if (resolved == null) {
    return null;
  }
  const parsed = parseColor(resolved);
  if (parsed == null) {
    return null;
  }
  return {
    r: Math.round(parsed.r * 255),
    g: Math.round(parsed.g * 255),
    b: Math.round(parsed.b * 255),
    a: Number(parsed.a.toFixed(3)),
  };
}

describe('color-mix in srgb', () => {
  it('mixes evenly when no percentage is given', () => {
    expect(mix('in srgb, #000000, #FFFFFF')).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    });
  });

  it('honours a stated percentage', () => {
    // 25% black, so 75% white.
    expect(mix('in srgb, #000000 25%, #FFFFFF')).toEqual({
      r: 191,
      g: 191,
      b: 191,
      a: 1,
    });
  });

  it('takes the omitted percentage as the remainder', () => {
    expect(mix('in srgb, red 30%, blue')).toEqual(
      mix('in srgb, red 30%, blue 70%'),
    );
  });

  // The subtlety that matters most in practice: Astryx fades tokens toward
  // `transparent`, which is rgba(0,0,0,0). Mixed without premultiplying, the
  // channels drag toward black and the colour darkens as it fades.
  it('fading to transparent keeps the hue', () => {
    const faded = mix('in srgb, red 50%, transparent');
    // Full red at half alpha. Mixed without premultiplying this comes out
    // {128, 0, 0} — the colour darkens as it fades, which is the bug.
    expect(faded?.r).toBe(255);
    expect(faded?.g).toBe(0);
    expect(faded?.b).toBe(0);
    // Alpha round-trips through an 8-bit channel, so 0.5 lands on 128/255.
    expect(faded?.a).toBeCloseTo(0.5, 2);
  });

  it('fading to transparent at 20% still keeps the hue', () => {
    expect(mix('in srgb, white 20%, transparent')).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.2,
    });
  });

  // §3.2: percentages summing to less than 100 are not an error — the
  // shortfall becomes transparency.
  it('turns a shortfall below 100% into alpha', () => {
    // An even mix of red and blue, at 60% alpha.
    expect(mix('in srgb, red 30%, blue 30%')).toEqual({
      r: 128,
      g: 0,
      b: 128,
      a: 0.6,
    });
  });

  it('normalises percentages summing above 100', () => {
    expect(mix('in srgb, red 150%, blue 50%')).toEqual({
      r: 191,
      g: 0,
      b: 64,
      a: 1,
    });
  });

  it('accepts a leading percentage', () => {
    expect(mix('in srgb, 25% #000000, #FFFFFF')).toEqual(
      mix('in srgb, #000000 25%, #FFFFFF'),
    );
  });
});

describe('color-mix in oklab', () => {
  // Worth doing properly rather than approximating with an sRGB mix: mixing in
  // a perceptual space is the entire reason to ask for oklab.
  it('round-trips a colour mixed with itself', () => {
    expect(mix('in oklab, #3366CC, #3366CC')).toEqual({
      r: 51,
      g: 102,
      b: 204,
      a: 1,
    });
  });

  it('puts the black-to-white midpoint where the maths says', () => {
    // Checked against the prediction rather than against sRGB: OKLab's L is
    // roughly the cube root of linear luminance, so L=0.5 means Y=0.125, which
    // encodes to sRGB 1.055*0.125^(1/2.4) - 0.055 = 0.383 -> 98.
    //
    // Note this is DARKER than sRGB's own midpoint of 128, not lighter — sRGB's
    // gamma overshoots the perceptual middle. I asserted the opposite first and
    // the implementation was right.
    const oklab = mix('in oklab, black, white');
    expect(oklab?.r).toBeGreaterThanOrEqual(97);
    expect(oklab?.r).toBeLessThanOrEqual(100);
    expect(mix('in srgb, black, white')?.r).toBe(128);
  });
});

describe('refusing rather than guessing', () => {
  it('leaves an unknown colour space alone', () => {
    expect(resolveColorMixArgs('in lch, red, blue')).toBeNull();
  });

  it('leaves an unresolved var() alone', () => {
    expect(resolveColorMixArgs('in srgb, var(--nope), blue')).toBeNull();
  });

  it('rejects two zero percentages', () => {
    expect(resolveColorMixArgs('in srgb, red 0%, blue 0%')).toBeNull();
  });
});

describe('through the style pipeline', () => {
  it('resolves a mix of design tokens', () => {
    const {style} = stylex.props({
      backgroundColor: 'color-mix(in srgb, #000000, #FFFFFF)',
    });
    expect(style).toEqual({backgroundColor: 'rgba(128, 128, 128, 1)'});
  });

  it('resolves a mix whose arguments are var() tokens', () => {
    const {style} = stylex.props({
      // --color-accent is a defined token; mixing it with itself must give it
      // back, which proves var() substitution runs before the mix.
      backgroundColor:
        'color-mix(in srgb, var(--color-accent), var(--color-accent))',
    });
    const direct = stylex.props({backgroundColor: 'var(--color-accent)'}).style;
    expect(parseColor(String((style as $FlowFixMe).backgroundColor))).toEqual(
      parseColor(String((direct as $FlowFixMe).backgroundColor)),
    );
  });
});
