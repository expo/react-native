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

// An `auto` grid column starts at its items' min-content contributions and
// grows toward their max-content ones only as far as the container has room
// (css-grid-2 §12.4-12.6), so a wrapping row of chips in a 200-point grid
// wraps inside it, as a composer's attachment drawer does on the web, and a
// grid with room for the whole row keeps it on one line. Safari measures the
// same.
function chips(
  template: ?string,
  width: number = 200,
): {width: number, height: number} {
  const row = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div
        style={{
          width,
          display: 'grid',
          gridTemplateColumns: template ?? undefined,
        }}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={row}
          style={{display: 'flex', flexDirection: 'row', flexWrap: 'wrap'}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 80, height: 20, flexShrink: 0}} />
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 80, height: 20, flexShrink: 0}} />
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 80, height: 20, flexShrink: 0}} />
        </div>
      </div>,
    );
  });
  const rect = row.current?.getBoundingClientRect();
  return {width: rect?.width ?? -1, height: rect?.height ?? -1};
}

test('an implicit auto column wraps the row at the grid width', () => {
  expect(chips(null)).toEqual({width: 200, height: 40});
});

test('a 1fr column wraps it too', () => {
  expect(chips('1fr')).toEqual({width: 200, height: 40});
});

test('a grid with room for the row keeps it on one line', () => {
  expect(chips(null, 300)).toEqual({width: 300, height: 20});
});
