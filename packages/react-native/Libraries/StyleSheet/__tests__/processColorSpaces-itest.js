/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableColorSpaces:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

const {OS} = require('../../Utilities/Platform').default;
const Fantom = require('@react-native/fantom');
const React = require('react');
const {View} = require('react-native');
const processColor = require('../processColor').default;

/*
 * What a view's background mounts as on this test host, which draws 8-bit
 * sRGB only: a color in another space is converted by CSS's arithmetic and
 * clipped to sRGB
 */
function mountedBackground(color: string): ?string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View style={{width: 10, height: 10, backgroundColor: color}} />,
    );
  });
  const output = root
    .getRenderedOutput({props: ['backgroundColor']})
    .toJSON() as $FlowFixMe;
  root.destroy();
  return output?.props?.backgroundColor;
}

const platformSpecific =
  OS === 'android'
    ? (unsigned: number) => unsigned | 0 // eslint-disable-line no-bitwise
    : (unsigned: number) => unsigned;

describe('processColor with color spaces', () => {
  it('keeps every legacy sRGB color an integer', () => {
    expect(processColor('red')).toBe(platformSpecific(0xffff0000));
    expect(processColor('#00ff0080')).toBe(platformSpecific(0x8000ff00));
    expect(processColor('rgb(0 0 255)')).toBe(platformSpecific(0xff0000ff));
    expect(processColor('hsl(0 100% 50%)')).toBe(platformSpecific(0xffff0000));
  });

  it('passes a color() color as its space and named channels', () => {
    expect(processColor('color(display-p3 1 0 0 / 0.5)')).toEqual({
      space: 'display-p3',
      r: 1,
      g: 0,
      b: 0,
      alpha: 0.5,
    });
  });

  it('passes Lab-family colors with their own channel names', () => {
    expect(processColor('oklch(0.7 0.2 30)')).toEqual({
      space: 'oklch',
      l: 0.7,
      c: 0.2,
      h: 30,
      alpha: 1,
    });
    expect(processColor('lab(50 20 -30)')).toEqual({
      space: 'lab',
      l: 50,
      a: 20,
      b: -30,
      alpha: 1,
    });
  });

  it('returns the same object for the same string', () => {
    const color = processColor('color(rec2020 0 1 0)');
    expect(color).toEqual({space: 'rec2020', r: 0, g: 1, b: 0, alpha: 1});
    expect(processColor('color(rec2020 0 1 0)')).toBe(color);
  });

  it("still refuses what isn't a color", () => {
    expect(processColor('color(nowhere 1 0 0)')).toBe(undefined);
    expect(processColor('not a color')).toBe(undefined);
  });
});

describe('the native side of color spaces', () => {
  it("draws CSS spaces by CSS's arithmetic where the host has no space", () => {
    // Each of these is sRGB red, written in another space
    for (const red of [
      'oklch(0.62796 0.25768 29.2339)',
      'oklab(0.62796 0.22486 0.12585)',
      'lab(54.2905 80.8049 69.891)',
      'lch(54.2905 106.8371 40.8526)',
      'color(xyz-d65 0.41239 0.21264 0.01933)',
      'color(srgb-linear 1 0 0)',
    ]) {
      expect(mountedBackground(red)).toBe('rgba(255, 0, 0, 1)');
    }
  });

  it('clips a wide color to sRGB on an sRGB host', () => {
    expect(mountedBackground('color(display-p3 1 0 0)')).toBe(
      'rgba(255, 0, 0, 1)',
    );
    expect(mountedBackground('color(rec2020 0 1 0)')).toBe(
      'rgba(0, 255, 0, 1)',
    );
  });

  it("reads PQ at CSS Color HDR's reference white as SDR white", () => {
    // A PQ signal of 0.5807 is 203 cd/m², which CSS Color HDR makes 1.0
    expect(mountedBackground('color(rec2100-pq 0.5807 0.5807 0.5807)')).toBe(
      'rgba(255, 255, 255, 1)',
    );
  });

  it('keeps alpha', () => {
    expect(mountedBackground('color(srgb 0 0 1 / 0.5)')).toBe(
      'rgba(0, 0, 255, 0.501961)',
    );
  });

  it('draws nothing for a space neither the host nor CSS defines', () => {
    expect(mountedBackground('color(--dci-p3 1 0 0)')).toBe(undefined);
  });

  it('keeps integer colors sRGB', () => {
    expect(mountedBackground('#ff0000')).toBe('rgba(255, 0, 0, 1)');
  });
});
