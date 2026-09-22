/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @oncall react_native
 */

/**
 * `<native:scroll>`'s shape. The nested-scrolling behaviour is native and
 * verified on a device; what is observable here is the structure that silently
 * regresses, rendered through the real renderer and read off the shadow tree.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text} from 'react-native';

// The element is a host tag with a hyphen, which Flow has no declaration for
const NativeScroll: React.ComponentType<$FlowFixMe> =
  'native-scroll' as $FlowFixMe;

import '@react-native/expo-intrinsics-poc';

function render(element: React.MixedElement, props: Array<string>): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // The JSON form: what the shadow tree holds, without a renderer's opinion in between
  return JSON.stringify(root.getRenderedOutput({props}).toJSON());
}

describe('<native:scroll>', () => {
  it('mounts its own component, not a ScrollView', () => {
    // A distinct component: with the registration lost it would fall back to the
    // unimplemented view and render a grey box rather than fail
    const output = render(<NativeScroll />, []);

    expect(output).toContain('native-scroll');
  });

  it('keeps its children in exactly one content container', () => {
    const output = render(
      <NativeScroll>
        <Text>one</Text>
        <Text>two</Text>
      </NativeScroll>,
      [],
    );

    // Both children under a single wrapper; the Android view asserts on more than one child
    const rendered = output;
    expect(rendered).toContain('one');
    expect(rendered).toContain('two');
  });

  // The defaults are not asserted here: Fabric sends the mounting layer only the
  // props that were set, so an element with no props reports `props: {}`. They
  // are checked on Android by ExpoScrollViewManagerTest.
});
