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

// `enableColorSpaces` is a native flag, which `override` doesn't reach
jest.mock('../../../src/private/featureflags/ReactNativeFeatureFlags', () => ({
  ...jest.requireActual(
    '../../../src/private/featureflags/ReactNativeFeatureFlags',
  ),
  enableColorSpaces: () => true,
}));

jest.mock('../../Utilities/NativeDisplayCapabilities', () => ({
  __esModule: true,
  default: {
    getCapabilities: () => ({colorGamut: 'srgb', dynamicRange: 'standard'}),
    isColorSpaceAvailable: (name: string) =>
      !name.startsWith('--') || name === '--dci-p3',
    addListener: () => {},
    removeListeners: () => {},
  },
}));

const CSS = require('../CSS').default;

describe('CSS.supports', () => {
  it('supports every color this renderer draws', () => {
    expect(CSS.supports('color', 'red')).toBe(true);
    expect(CSS.supports('color', '#ff000080')).toBe(true);
    expect(CSS.supports('background-color', 'color(display-p3 1 0 0)')).toBe(
      true,
    );
    expect(CSS.supports('border-top-color', 'oklch(0.7 0.2 30)')).toBe(true);
    expect(CSS.supports('color', 'color(rec2100-pq 0.5 0.5 0.5)')).toBe(true);
  });

  it("refuses a color that doesn't parse", () => {
    expect(CSS.supports('color', 'nonsense')).toBe(false);
    expect(CSS.supports('color', 'color(display-p3 1 0)')).toBe(false);
    expect(CSS.supports('color', '')).toBe(false);
  });

  it("answers a platform space from this device's OS", () => {
    expect(CSS.supports('color', 'color(--dci-p3 1 0 0)')).toBe(true);
    expect(CSS.supports('color', 'color(--rec709 1 0 0)')).toBe(false);
  });

  it('supports dynamic-range-limit by its keywords', () => {
    expect(CSS.supports('dynamic-range-limit', 'standard')).toBe(true);
    expect(CSS.supports('dynamic-range-limit', 'constrained')).toBe(true);
    expect(CSS.supports('dynamic-range-limit', ' no-limit ')).toBe(true);
    expect(
      CSS.supports(
        'dynamic-range-limit',
        'dynamic-range-limit-mix(standard 50%, no-limit 50%)',
      ),
    ).toBe(false);
  });

  it('reads a parenthesised declaration, and a bare one as the spec wraps it', () => {
    expect(CSS.supports('(color: color(display-p3 1 0 0))')).toBe(true);
    expect(CSS.supports('( background-color : red )')).toBe(true);
    expect(CSS.supports('(color: nonsense)')).toBe(false);
    expect(CSS.supports('color: red')).toBe(true);
    expect(CSS.supports('(color)')).toBe(false);
    expect(CSS.supports('color')).toBe(false);
  });

  it('combines conditions with and, or and not', () => {
    expect(CSS.supports('(color: red) and (color: blue)')).toBe(true);
    expect(CSS.supports('(display: grid) and (color: red)')).toBe(false);
    expect(CSS.supports('(display: grid) or (color: red)')).toBe(true);
    expect(CSS.supports('not (display: grid)')).toBe(true);
    expect(CSS.supports('(color: red) and (not (color: nonsense))')).toBe(true);
    expect(
      CSS.supports('((color: red) or (display: grid)) and (color: blue)'),
    ).toBe(true);
    // Mixed operators without parentheses are no condition
    expect(CSS.supports('(color: red) and (color: blue) or (color: red)')).toBe(
      false,
    );
    expect(CSS.supports('(color: red')).toBe(false);
  });

  it('answers only the color properties it has', () => {
    expect(CSS.supports('made-up-color', 'red')).toBe(false);
    expect(CSS.supports('Border-Top-Color', 'red')).toBe(true);
    expect(CSS.supports('outline-color', 'oklch(0.5 0.1 20)')).toBe(true);
  });

  it('matches the two-argument property as written, and a declaration with its whitespace', () => {
    expect(CSS.supports(' color ', 'red')).toBe(false);
    expect(CSS.supports('COLOR', 'red')).toBe(true);
    expect(CSS.supports('( color : red )')).toBe(true);
  });

  it('treats a general enclosed term as valid and false', () => {
    expect(CSS.supports('(future-feature)')).toBe(false);
    expect(CSS.supports('not (future-feature)')).toBe(true);
    expect(CSS.supports('(color: red) or (future-feature)')).toBe(true);
    expect(CSS.supports('(color: red) and (future-feature)')).toBe(false);
    expect(CSS.supports('(selector(:focus-visible))')).toBe(false);
  });

  it("is false for a property it doesn't answer", () => {
    expect(CSS.supports('display', 'grid')).toBe(false);
    expect(CSS.supports('background-image', 'linear-gradient(red, blue)')).toBe(
      false,
    );
  });
});
