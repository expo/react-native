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
import {jsx} from '../jsx-runtime';
// $FlowExpectedError[cannot-resolve-module]
import {Layout, LayoutContent, LayoutPanel} from '../vendor/Layout';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

it('keeps document content beside an auto-sized outline panel', () => {
  const root = Fantom.createRoot({viewportWidth: 867, viewportHeight: 587});
  const content = React.createRef<$FlowFixMe>();
  const panel = React.createRef<$FlowFixMe>();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        style: {width: 867, minHeight: 587, fontSize: 16},
        children: (
          <Layout
            height="auto"
            contentWidth={960}
            content={
              <LayoutContent ref={content} isScrollable={false} padding={8}>
                {jsx('div', {style: {height: 100}, children: 'Documentation'})}
              </LayoutContent>
            }
            end={
              <LayoutPanel
                ref={panel}
                isScrollable={false}
                style={{position: 'sticky', top: 24, alignSelf: 'start'}}>
                {jsx('div', {
                  style: {width: '100%'},
                  children: jsx('div', {style: {width: 100, height: 100}}),
                })}
              </LayoutPanel>
            }
          />
        ),
      }) as $FlowFixMe,
    );
  });
  const a = content.current.getBoundingClientRect();
  const b = panel.current.getBoundingClientRect();
  expect([a.width, b.width]).toEqual([751, 132]);
  expect(b.right).toBe(867);
});
