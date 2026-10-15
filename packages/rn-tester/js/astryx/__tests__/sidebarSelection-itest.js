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

import {SELECTED_TEMPLATE_STYLE} from '../../../../astryx-demo/src/sidebarSelection';
import {jsx} from '../jsx-runtime';
// $FlowExpectedError[cannot-resolve-module] Metro compiles the vendor TypeScript.
import {ListItem} from '../vendor/List';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

it('paints the selected sidebar row after selection changes', () => {
  const root = Fantom.createRoot();
  const rows: Array<{current: $FlowFixMe}> = [
    React.createRef(),
    React.createRef(),
  ];
  for (const selected of [0, 1]) {
    Fantom.runTask(() =>
      root.render(
        <>
          {jsx('div', {
            style: {
              '--color-overlay-pressed': 'rgb(0, 128, 255)',
              '--color-accent-muted': 'rgb(255, 0, 0)',
              width: 320,
            },
            children: rows.map((ref, index) => (
              <ListItem
                key={index}
                ref={ref}
                label={`Demo ${index}`}
                isSelected={index === selected}
                style={index === selected ? SELECTED_TEMPLATE_STYLE : undefined}
                onClick={() => {}}
              />
            )),
          })}
        </>,
      ),
    );
    expect(
      globalThis.getComputedStyle(rows[selected].current).backgroundColor,
    ).toBe('rgba(0, 128, 255, 1)');
    expect(
      globalThis.getComputedStyle(rows[1 - selected].current).backgroundColor,
    ).not.toBe('rgba(0, 128, 255, 1)');
  }
});
