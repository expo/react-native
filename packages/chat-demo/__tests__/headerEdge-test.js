/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * Which scroll edge effect the bar gets, which is a DECISION and so is what
 * there is to test. What the effect then draws is the platform's business, and
 * `RevealShot`'s kind of instrument is what reads that.
 */

let windowSize = {width: 402, height: 874};
jest.mock('react-native', () => ({
  useWindowDimensions: () => windowSize,
}));

const useHeaderEdgeEffects = require('../headerEdge').default;

describe('the bar keeps its fade upright and not on its side', () => {
  test('upright the top edge is soft', () => {
    windowSize = {width: 402, height: 874};
    expect(useHeaderEdgeEffects()).toEqual({top: 'soft'});
  });

  test('on its side it is the platform default', () => {
    windowSize = {width: 874, height: 402};
    expect(useHeaderEdgeEffects()).toEqual({top: 'automatic'});
  });

  /*
   * A square window is not a real device and the answer only has to be one of
   * the two; what matters is that `width > height` is the whole rule, so a
   * window that is not wider than it is tall keeps the fade.
   */
  test('a square window keeps the fade', () => {
    windowSize = {width: 500, height: 500};
    expect(useHeaderEdgeEffects()).toEqual({top: 'soft'});
  });

  /*
   * The same object every time: it crosses to the renderer as a raw prop and is
   * parsed there, so a fresh one per render is a fresh parse of a decision that
   * changes when the phone turns and not otherwise.
   */
  test('and it is the same object each time, not a fresh one', () => {
    windowSize = {width: 402, height: 874};
    expect(useHeaderEdgeEffects()).toBe(useHeaderEdgeEffects());
  });
});
