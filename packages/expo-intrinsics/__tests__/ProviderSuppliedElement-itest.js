/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
// The provider without the catalog: the catalog installs the unknown-element
// fallback, and a <span> backed by that fallback is indistinguishable from a
// real one. With it absent, if <span> resolves at all the provider resolved it.
import '@react-native/expo-intrinsics-poc';

/*
 * <span> supplied from outside react-native, which names no `span` and supplies
 * only the inline text element class, the descriptor seam and the inline
 * formatting context the element flows in.
 */

test('a provider-supplied <span> resolves and renders its text', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <Text>
        {/* $FlowFixMe[prop-missing] intrinsic supplied by the provider */}
        <span>from a provider</span>
      </Text>,
    );
  });

  // Rendering at all is the assertion: with no fallback installed, an
  // unregistered tag has nothing to resolve to
  expect(root.getRenderedOutput().toJSX()).toBeTruthy();
});

test('it identifies as a span', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{display: 'block'}}>
        {/* $FlowFixMe[prop-missing] intrinsic supplied by the provider */}
        <span ref={ref}>tagged</span>
      </View>,
    );
  });

  // $FlowFixMe[prop-missing] DOM tagName on the element
  expect(ref.current?.tagName).toBe('RN:span');
});

test('it folds into the surrounding text run instead of taking a line', () => {
  const inline = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{display: 'block', width: 400}}>
        {'before '}
        {/* $FlowFixMe[prop-missing] intrinsic supplied by the provider */}
        <span ref={inline}>middle</span>
        {' after'}
      </View>,
    );
  });

  // An inline element starts partway across its line; a block would start at 0
  // and own the full width. The `display: inline` is the provider's user-agent
  // style.
  const rect = inline.current?.getBoundingClientRect();
  expect(rect).toBeTruthy();
  expect(rect?.x).toBeGreaterThan(0);
  expect(rect?.width).toBeLessThan(400);
});
