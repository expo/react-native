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
 * The four jump positions of `steps()` (css-easing-1 §2.3) differ in the
 * number of jumps as well as their placement: `jump-none` makes n-1 jumps and
 * reaches both endpoints, `jump-both` makes n+1 and reaches neither.
 *
 * Each case drives the transition to a fraction of its duration and reads the
 * committed translate mid-interval, where a step easing holds one value, rather
 * than on a boundary where a frame either side of the jump would decide it.
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

const DURATION = 1000;

function runEasing(easing: string): (fraction: number) => number {
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
            transitionDuration: `${DURATION}ms`,
            transitionTimingFunction: easing,
          }}
        />,
      );
    });
  };
  render('translateX(0px)');
  render('translateX(100px)');

  let elapsed = 0;
  return (fraction: number) => {
    const target = DURATION * fraction;
    if (target > elapsed) {
      Fantom.unstable_produceFramesForDuration(target - elapsed);
      elapsed = target;
    }
    return translateXOf(viewRef);
  };
}

describe('steps() jump positions', () => {
  it('jump-end holds the start value through the first interval', () => {
    const at = runEasing('steps(4, jump-end)');
    // 4 jumps of 25: [0,.25) is still 0, [.25,.5) is 25
    expect(at(0.12)).toBeCloseTo(0, 1);
    expect(at(0.37)).toBeCloseTo(25, 1);
    expect(at(0.62)).toBeCloseTo(50, 1);
  });

  it('jump-start rises immediately', () => {
    const at = runEasing('steps(4, jump-start)');
    // The same 4 jumps of 25, each taken at the interval's start
    expect(at(0.12)).toBeCloseTo(25, 1);
    expect(at(0.37)).toBeCloseTo(50, 1);
    expect(at(0.62)).toBeCloseTo(75, 1);
  });

  it('jump-none makes n-1 jumps and reaches both endpoints', () => {
    const at = runEasing('steps(4, jump-none)');
    // 3 jumps of 100/3: the first interval is still 0 and the last is 100
    expect(at(0.12)).toBeCloseTo(0, 1);
    expect(at(0.37)).toBeCloseTo(100 / 3, 1);
    expect(at(0.62)).toBeCloseTo(200 / 3, 1);
    expect(at(0.87)).toBeCloseTo(100, 1);
  });

  it('jump-both makes n+1 jumps and reaches neither endpoint', () => {
    const at = runEasing('steps(4, jump-both)');
    // 5 jumps of 20: the first interval is already 20 and the last is 80
    expect(at(0.12)).toBeCloseTo(20, 1);
    expect(at(0.37)).toBeCloseTo(40, 1);
    expect(at(0.62)).toBeCloseTo(60, 1);
    expect(at(0.87)).toBeCloseTo(80, 1);
  });

  // A timing function is one entry of a comma-separated list, and
  // `cubic-bezier` has three commas inside it; an unparseable easing falls
  // back to the default, so a split that ignored parentheses would run `ease`
  it('cubic-bezier survives being an entry in a comma-separated list', () => {
    // A steep ease-in: at the midpoint it is well below the linear 50
    const at = runEasing('cubic-bezier(0.9, 0, 1, 0.2)');
    const midway = at(0.5);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(25);
  });

  it('step-start and step-end are the n == 1 cases', () => {
    const start = runEasing('step-start');
    expect(start(0.5)).toBeCloseTo(100, 1);
    const end = runEasing('step-end');
    expect(end(0.5)).toBeCloseTo(0, 1);
  });
});
