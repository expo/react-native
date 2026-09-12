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

function yOf(root: ReturnType<typeof Fantom.createRoot>, id: string): number {
  const json = root.getRenderedOutput({includeLayoutMetrics: true}).toJSON();
  let found: ?{[string]: string} = null;
  const visit = (node: unknown) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    // Untyped JSON from the harness: prop values are all strings.
    const props: ?{[string]: string} = (node as $FlowFixMe).props;
    if (props != null && props.nativeID === id) {
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
  return parseFloat(
    nullthrows(String(nullthrows(found)['layoutMetrics-frame']).match(/y:(-?[\d.]+),/))[1],
  );
}

/*
 * The compound event that found the last two engine bugs: a receipt handing
 * over from one message to the next. One commit closes a row, opens another,
 * and shrinks a balloon's tail reserve — three flights plus their knock-ons,
 * all on one clock. What this pins is that the composition is ONE movement:
 * every follower's mounted position is monotonic frame over frame, and lands
 * exactly. The first engine moved the column twice at two speeds here
 * ("the bubbles jitter"), and the split's first build left React's revision
 * describing the pre-transition world, which re-asserted it on alternate
 * frames forever.
 */
test('a receipt-style handover never reverses a follower', () => {
  const root = Fantom.createRoot();
  const layoutEase = {
    transitionProperty: 'height',
    transitionDuration: '250ms',
    transitionTimingFunction: 'ease-in-out',
  };
  const render = (swapped: boolean) => {
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 200}}>
          <View collapsable={false} style={{width: 200, height: 40}} />
          <View
            collapsable={false}
            style={{width: 200, height: swapped ? 0 : 13.3, ...layoutEase}}
          />
          <View nativeID="mid" collapsable={false} style={{width: 200, height: 40}} />
          <View
            collapsable={false}
            style={{width: 200, height: swapped ? 13.3 : 0, ...layoutEase}}
          />
          <View
            nativeID="tailrow"
            collapsable={false}
            style={{
              width: 200,
              paddingBottom: swapped ? 0 : 6.65,
              transitionProperty: 'padding-bottom',
              transitionDuration: '250ms',
              transitionTimingFunction: 'ease-in-out',
            }}>
            <View collapsable={false} style={{width: 200, height: 30}} />
          </View>
          <View nativeID="last" collapsable={false} style={{width: 200, height: 20}} />
        </View>,
      );
    });
  };

  render(false);
  const start = yOf(root, 'last');
  render(true);

  let prevLast = yOf(root, 'last');
  let prevMid = yOf(root, 'mid');
  const seenLast = [prevLast];
  const seenMid = [prevMid];
  for (let i = 0; i < 25; i++) {
    Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(17);
    const last = yOf(root, 'last');
    const mid = yOf(root, 'mid');
    seenLast.push(last);
    seenMid.push(mid);
    expect(last).toBeLessThanOrEqual(prevLast + 0.001);
    expect(mid).toBeLessThanOrEqual(prevMid + 0.001);
    prevLast = last;
    prevMid = mid;
  }
  expect(prevMid).toBeCloseTo(40, 1);
  expect(prevLast).toBeCloseTo(start - 6.65, 1);
});
