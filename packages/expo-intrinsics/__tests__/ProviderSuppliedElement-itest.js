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
// The provider, and DELIBERATELY NOT react-native's own element catalog.
//
// That omission is the whole experiment. react-native's catalog installs the
// HTMLUnknownElement fallback — every unregistered lowercase tag resolves to an
// inline, unstyled element — and <span> is inline and unstyled, so a <span>
// backed by the fallback is indistinguishable from a real one. With the catalog
// absent there is no fallback to hide behind: if <span> resolves at all, the
// provider is what resolved it.
import '@react-native/expo-intrinsics-poc';

/*
 * <span> supplied from outside react-native.
 *
 * react-native names no `span`: not in its element catalog, not in
 * InlineTextTagShadowNodes, not in the eager descriptor registry. It supplies
 * the inline text element class the provider derives from, the lazy descriptor
 * seam the provider registers through, and the inline formatting context the
 * element flows in — machinery, not elements.
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
  // unregistered tag has nothing to resolve to.
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

  // An inline element sits on the same line as the text around it, so its box
  // starts partway across rather than at the container's edge. A block would
  // start at 0 and own the full width. `display: inline` here comes from the
  // PROVIDER's user-agent style — react-native has no entry for this tag.
  const rect = inline.current?.getBoundingClientRect();
  expect(rect).toBeTruthy();
  expect(rect?.x).toBeGreaterThan(0);
  expect(rect?.width).toBeLessThan(400);
});
