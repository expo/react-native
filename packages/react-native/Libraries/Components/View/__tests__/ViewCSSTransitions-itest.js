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
import type {TransitionEvent} from 'react-native/Libraries/Types/CoreEventTypes';

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

/*
 * At an opacity of 1 nothing else here would keep this view, and flattened
 * away it would leave the frames fading it in nowhere to land: the child
 * would appear at full opacity at once
 */
test('a view fading in to an opacity of 1 keeps its view', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  const render = (opacity: number) => {
    Fantom.runTask(() => {
      root.render(
        <View
          ref={viewRef}
          style={{
            opacity,
            transitionProperty: 'opacity',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}>
          <View nativeID="child" collapsable={false} />
        </View>,
      );
    });
  };

  render(0);
  render(1);
  Fantom.unstable_produceFramesForDuration(500);

  // The child is drawn inside the fading view, which applies its opacity
  expect(root.getRenderedOutput({props: ['nativeID']}).toJSX()).toEqual(
    <rn-view>
      <rn-view nativeID="child" />
    </rn-view>,
  );
  const {opacity} = Fantom.unstable_getDirectManipulationProps(
    nullthrows(viewRef.current),
  );
  expect(typeof opacity === 'number' ? opacity : NaN).toBeGreaterThan(0.3);
  expect(typeof opacity === 'number' ? opacity : NaN).toBeLessThan(0.7);
});

/*
 * A transition announces itself (css-transitions-1 §6): `transitionrun` as it
 * is created, `transitionstart` once its delay is over, `transitionend` when
 * it completes, and `transitioncancel` when a new end value replaces it. A
 * page waits on `transitionend` to finish what the transition was for (a
 * bottom sheet closes its dialog when its slide is over), and without it
 * could only guess.
 */
test('a transition dispatches its run, start, end and cancel events', () => {
  const root = Fantom.createRoot();
  const events: Array<string> = [];
  const record = (event: TransitionEvent) => {
    events.push(
      // $FlowFixMe[prop-missing] the event's DOM type, which the legacy type omits
      `${String(event.type)} ${event.nativeEvent.propertyName} ${event.nativeEvent.elapsedTime}`,
    );
  };

  const render = (opacity: number) => {
    Fantom.runTask(() => {
      root.render(
        <View
          onTransitionRun={record}
          onTransitionStart={record}
          onTransitionEnd={record}
          onTransitionCancel={record}
          style={{
            opacity,
            transitionProperty: 'opacity',
            transitionDuration: '1000ms',
            transitionDelay: '100ms',
            transitionTimingFunction: 'linear',
          }}
        />,
      );
    });
  };

  render(1);
  render(0);
  // The events wait in the native event queue until it is flushed
  const advance = (milliseconds: number) => {
    Fantom.unstable_produceFramesForDuration(milliseconds);
    Fantom.flushAllNativeEvents();
  };
  advance(50);
  expect(events).toEqual(['transitionrun opacity 0']);

  advance(100);
  expect(events).toEqual([
    'transitionrun opacity 0',
    'transitionstart opacity 0',
  ]);

  advance(1100);
  expect(events.slice(2)).toEqual(['transitionend opacity 1']);

  events.length = 0;
  render(0.5);
  advance(400);
  render(1);
  Fantom.flushAllNativeEvents();
  expect(events.slice(0, 1)).toEqual(['transitionrun opacity 0']);
  expect(events).toContain('transitioncancel opacity 0.3');
  expect(
    events.filter(event => event.startsWith('transitionrun')),
  ).toHaveLength(2);
});
