/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags useSharedAnimatedBackend:true
 * @fantom_flags enableFabricCommitBranching:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

/*
 * The replay problem, pinned with commit branching ON — the configuration the
 * device runs.
 *
 * React's commits land on their own revision and merge into the main one, and
 * the engine's REWIND lives only on the revision that carried it. React's
 * branch therefore keeps the pre-transition value as its base, and every
 * later render that re-clones the transitioning node presents the same
 * change again, looking exactly like a fresh author edit. Without memory of
 * where the transition was aimed, the engine restarted it on every render —
 * measured on a device as the transcript's content size flapping between the
 * two layouts on alternate frames for as long as scroll events kept React
 * rendering.
 */

function mountedHeight(
  root: ReturnType<typeof Fantom.createRoot>,
  nativeID: string,
): number {
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
  return parseFloat(
    nullthrows(
      String(nullthrows(found)['layoutMetrics-frame']).match(
        /height:(-?[\d.]+)\}/,
      ),
    )[1],
  );
}

function renderBox(
  root: ReturnType<typeof Fantom.createRoot>,
  height: number,
  label: string,
) {
  Fantom.runTask(() => {
    root.render(
      <View
        nativeID="box"
        collapsable={false}
        // The changing label forces React to re-clone THIS node, which is
        // what makes the branch's stale base visible to the diff. A render
        // that leaves the node untouched never reaches the hook at all.
        accessibilityLabel={label}
        style={{
          width: 200,
          height,
          transitionProperty: 'height',
          transitionDuration: '500ms',
          transitionTimingFunction: 'linear',
        }}
      />,
    );
  });
}

test('a render that repeats the target does not restart the flight', () => {
  const root = Fantom.createRoot();

  renderBox(root, 20, 'a');
  renderBox(root, 120, 'b');
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(250);
  Fantom.runWorkLoop();
  const midway = mountedHeight(root, 'box');
  expect(midway).toBeGreaterThan(40);
  expect(midway).toBeLessThan(100);

  // The replay: same height, re-cloned node. Through the react branch's
  // rewound base this diffs as 20 -> 120 all over again.
  renderBox(root, 120, 'c');
  Fantom.runWorkLoop();
  const after = mountedHeight(root, 'box');
  // A restart would snap back toward 20; the flight must simply carry on.
  expect(after).toBeGreaterThanOrEqual(midway - 0.001);

  Fantom.unstable_produceFramesForDuration(150);
  Fantom.runWorkLoop();
  const later = mountedHeight(root, 'box');
  expect(later).toBeGreaterThan(after);

  Fantom.unstable_produceFramesForDuration(200);
  Fantom.runWorkLoop();
  expect(mountedHeight(root, 'box')).toBeCloseTo(120, 1);

  // And a repeat AFTER landing moves nothing: the value is already on
  // screen, remembered, and must commit untouched.
  renderBox(root, 120, 'd');
  Fantom.runWorkLoop();
  expect(mountedHeight(root, 'box')).toBeCloseTo(120, 1);
  Fantom.unstable_produceFramesForDuration(100);
  Fantom.runWorkLoop();
  expect(mountedHeight(root, 'box')).toBeCloseTo(120, 1);
});

test('a render that reverses the target re-aims from the current value', () => {
  const root = Fantom.createRoot();

  renderBox(root, 20, 'a');
  renderBox(root, 120, 'b');
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(250);
  Fantom.runWorkLoop();
  const midway = mountedHeight(root, 'box');
  expect(midway).toBeGreaterThan(40);

  /*
   * Back to the very value the branch's base holds. Compared against the
   * committed old alone this reads as "no change" and would snap; compared
   * against the remembered target it is a re-aim, which css-transitions-1 §3
   * says continues from the current value.
   */
  renderBox(root, 20, 'c');
  Fantom.runWorkLoop();
  let prev = mountedHeight(root, 'box');
  expect(prev).toBeLessThanOrEqual(midway + 0.001);
  for (let i = 0; i < 10; i++) {
    Fantom.unstable_produceFramesForDuration(50);
    Fantom.runWorkLoop();
    const y = mountedHeight(root, 'box');
    expect(y).toBeLessThanOrEqual(prev + 0.001);
    prev = y;
  }
  expect(prev).toBeCloseTo(20, 1);
});
