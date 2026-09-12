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
 * The bar must survive as a real view with its children inside it.
 *
 * This is the bug that cost the most to find. The bar is positioned by a
 * translation, and a view that flattens is hoisted into a childless backdrop
 * with its children promoted to siblings — so the translation moved an empty
 * rectangle and left the content behind. Every layer-level signal said it was
 * working: the offset applied, the matrix was right, the view's own frame
 * moved. Only the pixels disagreed.
 *
 * Two things hold it up now, and this test does not care which: the element is
 * its own component type, and `ConcreteViewShadowNode` forms a view
 * unconditionally, so only a plain `<View>` is ever a candidate for flattening.
 * If either ever stopped being true the node would vanish from the output here.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

import NativeKeyboardAccessory from '../src/NativeKeyboardAccessory';

function render(element: React.MixedElement): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // The JSON form rather than the JSX one: this asks what the shadow tree
  // actually holds, and JSON is the thing that says so without a renderer's
  // opinion in between.
  return JSON.stringify(root.getRenderedOutput({props: []}).toJSON());
}

describe('<native:keyboardaccessory>', () => {
  it('keeps its own node, with its children inside it', () => {
    const output = render(
      <NativeKeyboardAccessory>
        <Text>Send</Text>
      </NativeKeyboardAccessory>,
    );

    expect(output).toContain('native-keyboardaccessory');
    expect(output).toContain('Send');
  });

  it('and a plain view in the same shape flattens away, so the check above means something', () => {
    // No background, no handlers, nothing to draw: the renderer removes it and
    // the text is mounted directly. That is the outcome the bar has to avoid,
    // and stating it here stops the test above passing for the wrong reason.
    const output = render(
      <View>
        <Text>Send</Text>
      </View>,
    );

    expect(output).not.toContain('rn-view');
    expect(output).toContain('Send');
  });
});
