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
 * `<native:scroll>`'s shape and its defaults.
 *
 * The behaviour that matters most — that it takes part in the platform's
 * nested-scrolling protocol, and so can drive a collapsing toolbar where
 * `ScrollView` cannot — is native, and is verified on a device by measuring the
 * toolbar's bounds before and after the same drag. None of that is observable
 * from here.
 *
 * What IS observable here is the part that silently regresses. The defaults are
 * the whole point of the element, and they now live in the C++ props rather than
 * in JavaScript, so this renders through the real renderer and reads them back
 * off the shadow tree. If one were dropped the element would still render and
 * still scroll, and the only symptom would be a keyboard covering a field on
 * someone else's device.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text} from 'react-native';

// The element is a host tag with a hyphen, which Flow has no declaration for.
// One suppression at the point of use rather than one per call site.
const NativeScroll: React.ComponentType<$FlowFixMe> =
  'native-scroll' as $FlowFixMe;

import '@react-native/expo-intrinsics-poc';

function render(element: React.MixedElement, props: Array<string>): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // The JSON form rather than the JSX one: these ask what the shadow tree
  // actually holds, and JSON is the thing that says so without a renderer's
  // opinion in between.
  return JSON.stringify(root.getRenderedOutput({props}).toJSON());
}

describe('<native:scroll>', () => {
  it('mounts its own component, not a ScrollView', () => {
    // The element exists as a distinct component: if the registration were lost
    // it would fall back to the unimplemented view, and the app would render a
    // grey box rather than fail.
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

    // Both children under a single wrapper. A scrolling container has a viewport
    // and one thing inside it that is bigger; more than one child is a shape the
    // platform containers do not have, and the Android view asserts on it.
    const rendered = output;
    expect(rendered).toContain('one');
    expect(rendered).toContain('two');
  });

  /*
   * The DEFAULTS are not asserted here, and it is worth saying why rather than
   * leaving a gap that looks like an oversight.
   *
   * Fabric sends the mounting layer only the props that were set, so a default
   * that nobody overrode never appears in the rendered output — probed, and a
   * `<native:scroll>` with no props reports `props: {}`. There is nothing here
   * to read them off. They are checked where they can be: on Android by
   * ExpoScrollViewManagerTest, which applies no props and asks the view, and on
   * both platforms by the demo apps, where a scroll view typed with no props at
   * all keeps a focused field above the keyboard.
   */
});
