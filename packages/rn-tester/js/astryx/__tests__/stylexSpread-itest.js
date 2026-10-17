/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * Astryx merges a component's inline style into its StyleX style by
 * spreading (`{...stylex.props(…).style, ...inline}`), and the inline object
 * may give a property no value for a state the component is not in, as a
 * bottom sheet's `height: undefined` while no drag resizes it. React DOM
 * writes no inline declaration for it and the StyleX class's value applies;
 * here the spread had replaced the value with nothing, so the sheet grew to
 * its content and hung above the screen.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

test('a property spread over a StyleX style with no value keeps its value', () => {
  const box = React.createRef<$FlowFixMe>();
  const styled = stylex.props({height: 40, width: 50});
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        children: jsx('div', {
          ref: box,
          ...styled,
          style: {...styled.style, height: undefined, width: 60},
        }),
      }) as $FlowFixMe,
    );
  });
  const rect = box.current?.getBoundingClientRect();
  // The value the inline object gives wins; the one it gives none stands
  expect([rect?.width, rect?.height]).toEqual([60, 40]);
});
