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

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

/*
 * `padding-bottom` is the second LAYOUT property the engine animates, and it
 * exists for a shape drawn from the space it reserves.
 *
 * A chat balloon's tail hangs below its body, so a tailed balloon reserves
 * `padding-bottom` for it. Losing the tail is two changes at once — an
 * outline and a box — and they have to move together or the box snaps while
 * the tail morphs. One animated quantity is the fix: the reserve transitions
 * and the tail is drawn as a function of it. See `NativeChatBubble` and
 * `EXPChatBubblePath`.
 *
 * Which is why these tests read the mounted CONTENT INSETS as well as the
 * frame. Layout transitions are mounted metrics gliding between two real
 * layouts — the committed tree holds the target throughout — and the tail is
 * drawn from each frame's insets, so the insets interpolating is not an
 * implementation detail here; it is the feature.
 */

type MountedMetrics = {height: number, paddingBottom: number};

function mountedMetrics(
  root: ReturnType<typeof Fantom.createRoot>,
  nativeID: string,
): MountedMetrics {
  const json = root.getRenderedOutput({includeLayoutMetrics: true}).toJSON();
  let found: ?{[string]: string} = null;
  const visit = (node: unknown) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    // Untyped JSON from the harness: prop values are all strings.
    const props: ?{[string]: string} = (node as $FlowFixMe).props;
    if (props != null && props.nativeID === nativeID) {
      found = props;
    }
    const children = (node as $FlowFixMe).children;
    if (Array.isArray(children)) {
      children.forEach(visit);
    }
  };
  if (Array.isArray(json)) {
    json.forEach(visit);
  } else {
    visit(json);
  }
  const props = nullthrows(found);
  const height = nullthrows(
    String(props['layoutMetrics-frame']).match(/height:(-?[\d.]+)\}/),
  )[1];
  const paddingBottom = nullthrows(
    String(props['layoutMetrics-contentInsets']).match(/bottom:(-?[\d.]+),/),
  )[1];
  return {
    height: parseFloat(height),
    paddingBottom: parseFloat(paddingBottom),
  };
}

/* A content-sized box: its height IS its content plus its padding. */
function renderPadded(
  root: ReturnType<typeof Fantom.createRoot>,
  paddingBottom: number,
) {
  Fantom.runTask(() => {
    root.render(
      <View
        nativeID="box"
        collapsable={false}
        style={{
          width: 200,
          paddingBottom,
          transitionProperty: 'padding-bottom',
          transitionDuration: '1000ms',
          transitionTimingFunction: 'linear',
        }}>
        <View style={{width: 10, height: 40}} />
      </View>,
    );
  });
}

test('a padding-bottom transition interpolates and lands on the target', () => {
  const root = Fantom.createRoot();

  renderPadded(root, 0);
  expect(mountedMetrics(root, 'box').height).toBe(40);

  renderPadded(root, 20);
  /*
   * Read before any frame is produced: the mounted box must not have moved.
   * This pins the mistake a transition is likeliest to make — arriving on the
   * commit and animating from the target to itself.
   */
  expect(mountedMetrics(root, 'box').height).toBe(40);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  Fantom.runWorkLoop();
  const midway = mountedMetrics(root, 'box');
  expect(midway.height).toBeGreaterThan(40);
  expect(midway.height).toBeLessThan(60);
  /*
   * The insets travel WITH the frame — same clock, same interpolation. This
   * is the line the balloon tail hangs off: the shape is derived from the
   * mounted padding every frame, so padding that snapped while the frame
   * glided would detach the tail from its reserve.
   */
  expect(midway.paddingBottom).toBeCloseTo(midway.height - 40, 3);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(600);
  Fantom.runWorkLoop();
  const landed = mountedMetrics(root, 'box');
  expect(landed.height).toBe(60);
  expect(landed.paddingBottom).toBe(20);
});

test('a padding-bottom transition leaves the content it reserves for alone', () => {
  const root = Fantom.createRoot();

  const render = (paddingBottom: number) => {
    Fantom.runTask(() => {
      root.render(
        <View
          nativeID="box"
          collapsable={false}
          style={{
            width: 200,
            paddingBottom,
            transitionProperty: 'padding-bottom',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}>
          <View
            nativeID="content"
            collapsable={false}
            style={{width: 10, height: 40}}
          />
        </View>,
      );
    });
  };

  render(0);
  render(30);
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  Fantom.runWorkLoop();

  /*
   * The reserve opens BELOW the content, so the content must not move while
   * it does. That is the balloon's requirement stated as a test: its text
   * stays put while its tail grows.
   */
  expect(mountedMetrics(root, 'content').height).toBe(40);
  expect(mountedMetrics(root, 'box').height).toBeGreaterThan(40);
});

test('an undeclared padding is a discrete change, not an interpolation', () => {
  const root = Fantom.createRoot();

  /*
   * Nothing declared is not zero: `Style::Length` has an undefined state, and
   * interpolating out of it would read as a zero the author never wrote. The
   * spec makes an uninterpolable pair discrete — it applies at once — so the
   * box is at its target on the first read, mounted and committed alike.
   */
  Fantom.runTask(() => {
    root.render(
      <View
        nativeID="box"
        collapsable={false}
        style={{
          width: 200,
          transitionProperty: 'padding-bottom',
          transitionDuration: '1000ms',
          transitionTimingFunction: 'linear',
        }}>
        <View style={{width: 10, height: 40}} />
      </View>,
    );
  });
  expect(mountedMetrics(root, 'box').height).toBe(40);

  renderPadded(root, 25);
  expect(mountedMetrics(root, 'box').height).toBe(65);
});
