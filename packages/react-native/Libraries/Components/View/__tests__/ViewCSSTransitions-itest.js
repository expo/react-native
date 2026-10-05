/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags useSharedAnimatedBackend:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

/*
 * CSS transitions (css-transitions-1) run in the renderer: a committed change
 * to a transitioned property starts an interpolation whose frames reach the
 * view as direct manipulation. These tests drive the backend clock with
 * `unstable_produceFramesForDuration` and read that channel back.
 */

function translateXOf(viewRef: {current: HostInstance | null}): number {
  const {transform} = Fantom.unstable_getDirectManipulationProps(
    nullthrows(viewRef.current),
  );
  if (!Array.isArray(transform)) {
    return NaN;
  }
  for (const operation of transform) {
    // $FlowFixMe[incompatible-use] the direct-manipulation channel is dynamic
    if (operation != null && typeof operation.translateX === 'number') {
      // $FlowFixMe[incompatible-return]
      return operation.translateX;
    }
  }
  return 0;
}

test('a transform transition interpolates and lands on the target', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  const render = (translate: string) => {
    Fantom.runTask(() => {
      root.render(
        <View
          ref={viewRef}
          style={{
            width: 200,
            height: 20,
            transform: translate,
            transitionProperty: 'transform',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}
        />,
      );
    });
  };

  render('translateX(0px)');
  render('translateX(100px)');

  Fantom.unstable_produceFramesForDuration(500);
  const midway = translateXOf(viewRef);
  expect(midway).toBeGreaterThan(30);
  expect(midway).toBeLessThan(70);

  Fantom.unstable_produceFramesForDuration(600);
  expect(translateXOf(viewRef)).toBeCloseTo(100, 1);
});

/*
 * A percentage translate resolves against the element's own size, which only
 * the shadow tree knows; resolving against zero would collapse every offset to
 * 0px.
 */
test('percent translations resolve against the transitioning view own size', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  const render = (translate: string) => {
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 200, height: 20}}>
          <View
            ref={viewRef}
            style={{
              width: '100%',
              height: 20,
              transform: translate,
              transitionProperty: 'transform',
              transitionDuration: '1000ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </View>,
      );
    });
  };

  // -70% and -20% of the 200pt indicator
  render('translateX(-70%)');
  render('translateX(-20%)');

  Fantom.unstable_produceFramesForDuration(500);
  const midway = translateXOf(viewRef);
  // Halfway between -140pt and -40pt
  expect(midway).toBeGreaterThan(-110);
  expect(midway).toBeLessThan(-70);

  Fantom.unstable_produceFramesForDuration(600);
  expect(translateXOf(viewRef)).toBeCloseTo(-40, 1);
});
