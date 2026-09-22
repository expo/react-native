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
 * The bar must survive as a real view with its children inside it: it is
 * positioned by a translation, and a flattened view would leave its content
 * behind as siblings. The element is its own component type and
 * `ConcreteViewShadowNode` forms a view unconditionally; if either stopped being
 * true the node would vanish from the output here.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import '@react-native/expo-intrinsics-poc';

import NativeKeyboardAccessory from '../src/NativeKeyboardAccessory';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';

function render(element: React.MixedElement): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // The JSON form: what the shadow tree holds, without a renderer's opinion in between
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
    // Nothing to draw, so the renderer removes it: the outcome the bar has to
    // avoid, stated so the test above cannot pass for the wrong reason
    const output = render(
      <View>
        <Text>Send</Text>
      </View>,
    );

    expect(output).not.toContain('rn-view');
    expect(output).toContain('Send');
  });
});
