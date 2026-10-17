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

import {jsx} from '../../rn-tester/js/astryx/jsx-runtime';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

const SURFACE = {top: 47, right: 62, bottom: 34, left: 62};
const DOCUMENT = {top: 0, right: 0, bottom: 34, left: 0};
type Insets = Readonly<{
  top: number,
  right: number,
  bottom: number,
  left: number,
}>;

it('scopes native env() lengths to a document and restores inheritance when removed', () => {
  const root = Fantom.createRoot({safeAreaInsets: SURFACE});
  const inside = React.createRef<React.ElementRef<typeof View>>();
  const outside = React.createRef<React.ElementRef<typeof View>>();
  const child = (
    <View style={{paddingLeft: 'env(safe-area-inset-left, 99px)'}}>
      <View ref={inside} style={{height: 10}} />
    </View>
  );
  function render(insets: ?Insets) {
    Fantom.runTask(() => {
      root.render(
        <View>
          <View experimental_environmentSafeAreaInsets={insets}>{child}</View>
          <View style={{paddingLeft: 'env(safe-area-inset-left)'}}>
            <View ref={outside} style={{height: 10}} />
          </View>
        </View>,
      );
    });
  }
  render(DOCUMENT);
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(0);
  expect(nullthrows(outside.current).getBoundingClientRect().x).toBe(62);
  render({...DOCUMENT, left: 11});
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(11);
  render(null);
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(62);
});

it('gives CSS env() calculations the same document environment as native layout', () => {
  const root = Fantom.createRoot({safeAreaInsets: SURFACE});
  const inside = React.createRef<$FlowFixMe>();
  const outside = React.createRef<$FlowFixMe>();
  const cssChild = (ref: $FlowFixMe) =>
    jsx('div', {
      style: {paddingLeft: 'max(16px, env(safe-area-inset-left))'},
      children: jsx('div', {ref, style: {height: 10}}),
    });
  const child = cssChild(inside);
  function render(insets: ?Insets) {
    Fantom.runTask(() => {
      root.render(
        <View>
          <View experimental_environmentSafeAreaInsets={insets}>{child}</View>
          {cssChild(outside)}
        </View>,
      );
    });
  }
  render(DOCUMENT);
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(16);
  expect(nullthrows(outside.current).getBoundingClientRect().x).toBe(62);
  Fantom.runTask(() => {
    root.setSafeAreaInsets({...SURFACE, left: 84});
  });
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(16);
  expect(nullthrows(outside.current).getBoundingClientRect().x).toBe(84);
  render({...DOCUMENT, left: 24});
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(24);
  render(null);
  expect(nullthrows(inside.current).getBoundingClientRect().x).toBe(84);
});

it('accepts the declaration on the CSS document root itself', () => {
  const root = Fantom.createRoot({safeAreaInsets: SURFACE});
  const marker = React.createRef<$FlowFixMe>();
  Fantom.runTask(() => {
    root.render(
      <>
        {jsx('div', {
          experimental_environmentSafeAreaInsets: DOCUMENT,
          children: jsx('div', {
            style: {paddingLeft: 'max(16px, env(safe-area-inset-left))'},
            children: jsx('div', {ref: marker, style: {height: 10}}),
          }),
        })}
      </>,
    );
  });
  expect(nullthrows(marker.current).getBoundingClientRect().x).toBe(16);
});
