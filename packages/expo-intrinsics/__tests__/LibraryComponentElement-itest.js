/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import {defineReactComponent} from '../src/ElementRegistry';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';

/**
 * A library registering a COMPONENT under its namespace.
 *
 * The registry had three of its four quadrants — the framework could register a
 * host element or a component, a library could register a host element — and the
 * missing one is what an element needs when its job is to give an existing
 * component better defaults rather than mount a new native view.
 * `<native:scroll>` is exactly that shape, so the quadrant is not hypothetical.
 */
describe('a library element backed by a component', () => {
  test('renders through its component and gets the props', () => {
    function Boxed({label}: {label: string}) {
      return (
        <View>
          <Text>{'[' + label + ']'}</Text>
        </View>
      );
    }
    const tag = defineReactComponent('lib', 'boxed', Boxed);
    expect(tag).toBe('lib:boxed');

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      // $FlowFixMe[not-a-function] a dynamic intrinsic tag is a string
      root.render(React.createElement(tag, {label: 'hi'}));
    });

    // The component ran: the brackets are its doing, not the caller's. The View
    // it wraps them in has nothing to draw and flattens away, which is the
    // renderer working normally rather than anything to do with the registry.
    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-paragraph>[hi]</rn-paragraph>,
    );
  });

  test('refuses a second registration of the same tag', () => {
    function A() {
      return null;
    }
    defineReactComponent('lib', 'once', A);

    // Same rule the rest of the registry follows: two libraries sharing a
    // namespace have to coordinate, and the registry will not pick a winner.
    expect(() => defineReactComponent('lib', 'once', A)).toThrow(
      "<lib:once> is already registered. Two libraries sharing the 'lib' " +
        'namespace must coordinate; the registry will not pick.',
    );
  });

  test('refuses the reserved namespace and malformed names', () => {
    function A() {
      return null;
    }

    expect(() => defineReactComponent('rn', 'thing', A)).toThrow(
      "Invalid element namespace 'rn': lowercase, and 'rn' is reserved.",
    );
    expect(() => defineReactComponent('lib', 'Thing', A)).toThrow(
      "Invalid element name 'Thing'.",
    );
  });
});
