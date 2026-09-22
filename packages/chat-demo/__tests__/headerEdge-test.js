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

  test('a square window keeps the fade', () => {
    windowSize = {width: 500, height: 500};
    expect(useHeaderEdgeEffects()).toEqual({top: 'soft'});
  });

  // `edgeEffects` is a raw prop parsed natively for every new object.
  test('and it is the same object each time, not a fresh one', () => {
    windowSize = {width: 402, height: 874};
    expect(useHeaderEdgeEffects()).toBe(useHeaderEdgeEffects());
  });
});
