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
import {View, processColor} from 'react-native';

/*
 * CSS animations (css-animations-1) run by the renderer's transitions engine:
 * a view that carries `animationKeyframes` animates from the moment it mounts,
 * frames driven by the shared animation backend and applied to the mounted
 * view as direct manipulation — committed trees never carry interpolated
 * values. These tests drive the backend clock with
 * `unstable_produceFramesForDuration` and read the direct-manipulation channel
 * back.
 */

const fadeKeyframes = JSON.stringify([
  {offset: 0, opacity: 0},
  {offset: 1, opacity: 1},
]);

function opacityOf(viewRef: {current: HostInstance | null}): number {
  const opacity = Fantom.unstable_getDirectManipulationProps(
    nullthrows(viewRef.current),
  ).opacity;
  return typeof opacity === 'number' ? opacity : NaN;
}

test('animation starts on mount and fill-mode: forwards holds the last keyframe', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      <View
        ref={viewRef}
        style={{
          width: 100,
          height: 100,
          opacity: 0.25,
          animationKeyframes: fadeKeyframes,
          animationDuration: '1000ms',
          animationTimingFunction: 'linear',
          animationFillMode: 'forwards',
        }}
      />,
    );
  });

  // Mid-flight: strictly between the keyframes, and NOT the committed 0.25 —
  // proof the animation is running rather than the style just applying.
  Fantom.unstable_produceFramesForDuration(500);
  const midway = opacityOf(viewRef);
  expect(midway).toBeGreaterThan(0.3);
  expect(midway).toBeLessThan(0.7);

  // Past the duration: `forwards` holds the final keyframe exactly.
  Fantom.unstable_produceFramesForDuration(1000);
  expect(opacityOf(viewRef)).toBe(1);

  // The committed tree still carries the author value, untouched.
  expect(root.getRenderedOutput({props: ['opacity']}).toJSX()).toEqual(
    <rn-view opacity="0.25" />,
  );
});

test('animation-fill-mode: none reverts to the committed value when done', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      <View
        ref={viewRef}
        style={{
          width: 100,
          height: 100,
          opacity: 0.25,
          animationKeyframes: fadeKeyframes,
          animationDuration: '200ms',
          animationTimingFunction: 'linear',
        }}
      />,
    );
  });

  Fantom.unstable_produceFramesForDuration(500);
  expect(opacityOf(viewRef)).toBe(0.25);
});

test('removing the animation mid-flight restores the committed value', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  function App(props: {animated: boolean}) {
    return (
      <View
        ref={viewRef}
        style={{
          width: 100,
          height: 100,
          opacity: 0.25,
          ...(props.animated
            ? {
                animationKeyframes: fadeKeyframes,
                animationDuration: '10s',
                animationTimingFunction: 'linear',
              }
            : null),
        }}
      />
    );
  }

  Fantom.runTask(() => {
    root.render(<App animated={true} />);
  });
  Fantom.unstable_produceFramesForDuration(100);
  expect(opacityOf(viewRef)).toBeLessThan(0.25);

  Fantom.runTask(() => {
    root.render(<App animated={false} />);
  });
  Fantom.unstable_produceFramesForDuration(100);
  expect(opacityOf(viewRef)).toBe(0.25);
});

test('unmounting the animated view drops the animation without writes', () => {
  const root = Fantom.createRoot();

  function App(props: {mounted: boolean}) {
    return props.mounted ? (
      <View
        style={{
          width: 100,
          height: 100,
          animationKeyframes: fadeKeyframes,
          animationDuration: '10s',
          animationIterationCount: 'infinite',
        }}
      />
    ) : (
      // opacity keeps the replacement from being view-flattened away, so the
      // rendered output stays observable.
      <View style={{width: 10, height: 10, opacity: 0.5}} />
    );
  }

  Fantom.runTask(() => {
    root.render(<App mounted={true} />);
  });
  Fantom.unstable_produceFramesForDuration(100);

  Fantom.runTask(() => {
    root.render(<App mounted={false} />);
  });
  // Frames after the unmount must not throw or resurrect the dead view.
  Fantom.unstable_produceFramesForDuration(100);
  expect(root.getRenderedOutput({props: ['opacity']}).toJSX()).toEqual(
    <rn-view opacity="0.5" />,
  );
});

test('background-color keyframes complete exactly on the final keyframe', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      <View
        ref={viewRef}
        style={{
          width: 100,
          height: 100,
          animationKeyframes: JSON.stringify([
            {offset: 0, backgroundColor: processColor('black')},
            {offset: 1, backgroundColor: processColor('red')},
          ]),
          animationDuration: '200ms',
          animationTimingFunction: 'linear',
          animationFillMode: 'forwards',
        }}
      />,
    );
  });

  Fantom.unstable_produceFramesForDuration(500);
  const backgroundColor = Fantom.unstable_getDirectManipulationProps(
    nullthrows(viewRef.current),
  ).backgroundColor;
  expect(backgroundColor).toBe(processColor('red'));
});

test('infinite iterations keep writing frames', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      <View
        ref={viewRef}
        style={{
          width: 100,
          height: 100,
          animationKeyframes: fadeKeyframes,
          animationDuration: '100ms',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }}
      />,
    );
  });

  // Well past several iterations, the value keeps moving between frames.
  Fantom.unstable_produceFramesForDuration(1030);
  const first = opacityOf(viewRef);
  Fantom.unstable_produceFramesForDuration(30);
  const second = opacityOf(viewRef);
  expect(Number.isNaN(first)).toBe(false);
  expect(first).not.toBe(second);
});
