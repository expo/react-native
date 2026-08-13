/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * Defining a BLOCK element without writing a C++ class for it.
 *
 * The obvious way to add one is to specialize AbstractViewShadowNode the way
 * <div> does — and that cannot be done outside react-native, because the
 * template's members are explicitly instantiated in ViewShadowNode.cpp for
 * exactly three types and a fourth fails to link.
 *
 * It also turns out to be unnecessary. react-native already ships a generic
 * box — `element-box`, a View that honours whatever display it is given and
 * reports the authored tag — so a block element is a tag name plus a
 * user-agent style that says `display: block`, pointed at it. That is the whole
 * definition: no shadow node, no descriptor, no registration beyond the view
 * config. <div> below is defined exactly that way, in the catalog, outside
 * react-native.
 *
 * These tests pin that the result is a REAL block container and not merely a
 * column of flex items, because the difference is invisible until you look for
 * something only block layout does.
 */

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

test('adjacent children collapse their margins (CSS2 §8.3.1)', () => {
  const first = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <div ref={first} style={{height: 20, marginBottom: 30}} />
        {/* $FlowFixMe[prop-missing] */}
        <div ref={second} style={{height: 20, marginTop: 10}} />
      </div>,
    );
  });

  // Collapsed: the gap is max(30, 10) = 30, not 30 + 10. Flex would sum them,
  // so this is the assertion that says "Yoga block display", not "column".
  expect(rectOf(second).y - (rectOf(first).y + rectOf(first).height)).toBe(30);
});

test('children fill the block container inline axis', () => {
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] */}
        <div ref={child} style={{height: 10}} />
      </div>,
    );
  });

  // A block-level box fills its containing block rather than shrink-wrapping.
  expect(rectOf(child).width).toBe(200);
});

test('it reports the tag it declared, not the component backing it', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] element from the catalog
      <div ref={ref} style={{width: 100, height: 10}} />,
    );
  });

  // `element-box` backs several elements, so identity has to travel with the
  // instance. Without this a provider's <div> would introduce itself as
  // whatever component it happened to be pointed at.
  // $FlowFixMe[prop-missing] DOM tagName on the element
  expect(ref.current?.tagName).toBe('RN:div');
});
