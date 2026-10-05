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
 * A block element is a tag name and a user-agent style that says
 * `display: block`, pointed at the generic box; no shadow node of its own.
 * These tests pin that the result is a real block container, not a column of
 * flex items.
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

  // Margins collapse to max(30, 10); a flex column would sum them
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

  // A block-level box fills its containing block rather than shrink-wrapping
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

  // `element-box` backs several elements, so identity travels with the instance
  // $FlowFixMe[prop-missing] DOM tagName on the element
  expect(ref.current?.tagName).toBe('RN:div');
});
