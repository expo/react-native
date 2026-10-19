/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

// Two shrinking items in a row of 30 whose bases add to far more: both are
// frozen at their `min-width` (css-flexbox-1 §9.7), so no item is left to
// take a share and each stays at its minimum. The bases are not round, so
// subtracting their shrink factors from the line's running total leaves a
// rounding residue rather than zero; dividing by it sent the first item to
// 946,339,904 points (a toolbar heading in Astryx's Kanban Board).
test('an item frozen at its minimum stays there when every item is frozen', () => {
  const first = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 30, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={first}
          style={{flexBasis: 120.33333, minWidth: 40, height: 10}}
        />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={second}
          style={{flexBasis: 13.3333, minWidth: 5, height: 10}}
        />
      </div>,
    );
  });
  expect(first.current?.getBoundingClientRect().width).toBe(40);
  expect(second.current?.getBoundingClientRect().width).toBe(5);
});

// Three shrinking items in a row of 120 whose bases add to 700, each with a
// `min-width` of 30. The overflow is shared by every item's scaled shrink
// factor (css-flexbox-1 §9.7): the first item's share takes it below its
// minimum, so it freezes at 30 and the other two split the rest, as Safari
// lays them out. Shared by what was left of the total as items froze, the
// first item's freeze gave the second a share that froze it too, then the
// third; the line had room to spare, and every item went back to its basis
// (a settings dialog's row of section buttons in Astryx).
test('an item frozen at its minimum leaves the others their share', () => {
  const first = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  const third = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 120, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={first} style={{flexBasis: 100, minWidth: 30, height: 10}} />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={second} style={{flexBasis: 300, minWidth: 30, height: 10}} />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={third} style={{flexBasis: 300, minWidth: 30, height: 10}} />
      </div>,
    );
  });
  expect(first.current?.getBoundingClientRect().width).toBe(30);
  expect(second.current?.getBoundingClientRect().width).toBe(45);
  expect(third.current?.getBoundingClientRect().width).toBe(45);
});
