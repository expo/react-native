/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true enableCppPropsIteratorSetter:*
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import {VIEWPORT_BLOCK_SIZE, VIEWPORT_INLINE_SIZE} from '../../css';
import {jsx} from '../../jsx-runtime';
import TopLayerElement, {PageViewportContext} from '../TopLayerElement';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';

it('places a fullscreen layer in its document and applies its safe gutter once', () => {
  const root = Fantom.createRoot({
    viewportWidth: 874,
    viewportHeight: 402,
    safeAreaInsets: {left: 62, right: 62, bottom: 20},
  });
  const dialog = React.createRef<$FlowFixMe>();
  const content = React.createRef<$FlowFixMe>();
  const area = {x: 62, y: 52, width: 750, height: 350};
  const environment = {top: 0, left: 0, right: 0, bottom: 20};
  const element = jsx('div', {
    ref: dialog,
    style: {
      position: 'fixed',
      width: '100dvw',
      height: '100dvh',
      paddingLeft: 'max(16px, env(safe-area-inset-left))',
      paddingRight: 'max(16px, env(safe-area-inset-right))',
    },
    children: jsx('div', {ref: content, style: {height: 10}}),
  });
  Fantom.runTask(() => {
    root.render(
      <>
        {jsx('div', {
          style: {
            marginLeft: area.x,
            marginTop: area.y,
            width: area.width,
            height: area.height,
            [VIEWPORT_INLINE_SIZE]: '750px',
            [VIEWPORT_BLOCK_SIZE]: '350px',
          },
          experimental_environmentSafeAreaInsets: environment,
          children: (
            <PageViewportContext value={area}>
              <TopLayerElement
                open
                lightDismiss={false}
                centered
                instanceRef={dialog}>
                {element}
              </TopLayerElement>
            </PageViewportContext>
          ),
        })}
      </>,
    );
  });
  const frame = nullthrows(dialog.current).getBoundingClientRect();
  expect({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  }).toEqual(area);
  const inner = nullthrows(content.current).getBoundingClientRect();
  expect(inner.x).toBe(78);
  expect(inner.width).toBe(718);
});
