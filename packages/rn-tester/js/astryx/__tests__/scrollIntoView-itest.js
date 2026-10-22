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
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import NativeScroll from '../../../../expo-intrinsics/src/NativeScroll';
import {jsx} from '../jsx-runtime';
import scrollAlignment from '../scrollAlignment';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

it('aligns nearest edges without moving a visible or spanning target', () => {
  expect(scrollAlignment(20, 40, 0, 100, 'nearest')).toBe(0);
  expect(scrollAlignment(-20, 120, 0, 100, 'nearest')).toBe(0);
  expect(scrollAlignment(120, 140, 0, 100, 'nearest')).toBe(40);
  expect(scrollAlignment(-40, -20, 0, 100, 'nearest')).toBe(-40);
  expect(scrollAlignment(-120, 60, 0, 100, 'nearest')).toBe(-40);
  expect(scrollAlignment(40, 200, 0, 100, 'nearest')).toBe(40);
});

it('scrolls the Fabric viewport to a heading below its native top inset', () => {
  const root = Fantom.createRoot();
  const viewport = React.createRef<$FlowFixMe>();
  const heading = React.createRef<$FlowFixMe>();
  Fantom.runTask(() =>
    root.render(
      <NativeScroll ref={viewport} contentContainerStyle={{height: 1500}}>
        {jsx('div', {
          ref: heading,
          id: 'chosen-section',
          style: {marginTop: 200, height: 20},
          children: 'Section',
        })}
      </NativeScroll>,
    ),
  );
  Fantom.dispatchNativeEvent(viewport.current, 'insetChange', {
    inset: {top: 20, bottom: 0, left: 0, right: 0},
    contentShift: {x: 0, y: 0},
  });
  root.takeMountingManagerLogs();
  expect(document.getElementById('chosen-section')).toBe(heading.current);
  Fantom.runTask(() =>
    document
      .getElementById('chosen-section')
      .scrollIntoView({behavior: 'smooth', block: 'start'}),
  );
  expect(root.takeMountingManagerLogs().join('\n')).toContain(
    'name: "scrollTo, args: [0,180,true]',
  );
});
