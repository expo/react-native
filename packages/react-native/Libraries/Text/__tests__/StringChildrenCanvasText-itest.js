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

/**
 * `color`'s initial value is `CanvasText` (css-color-4 §3.1).
 *
 * Text that nothing colours draws in the platform's own text colour, which
 * follows the appearance: `labelColor` on iOS, the theme's `textColorPrimary`
 * on Android. The renderer leaves such text's colour UNSET so each platform
 * resolves it where it draws; a colour frozen here could not follow dark mode.
 *
 * `<Text>` is the compatibility boundary: it starts from React Native's own
 * defaults, and those keep black.
 *
 * Read from the fragments of the attributed string, which is where the colour
 * the platform draws lives. A fragment's props list only what differs from
 * React Native's default text attributes, so black does not appear at all and
 * an unset colour appears as the null colour, `rgba(0, 0, 0, 0)`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';

const UNSET = 'rgba(0, 0, 0, 0)';
const RED = 'rgba(255, 0, 0, 1)';
// What a fragment reports when its colour is React Native's default black
const DEFAULT = 'default';

type Node = {
  readonly type?: string,
  readonly children?: unknown,
  readonly props?: {readonly foregroundColor?: string, ...},
  ...
};

function fragmentColors(element: React.MixedElement): {[string]: string} {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  const colors: {[string]: string} = {};
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node == null || typeof node !== 'object') {
      return;
    }
    // $FlowFixMe[incompatible-type] the rendered output is untyped JSON
    const n: Node = node;
    if (n.type === 'Text' && typeof n.children === 'string') {
      colors[n.children] = n.props?.foregroundColor ?? DEFAULT;
    }
    walk(n.children);
  };
  walk(root.getRenderedOutput({props: ['foregroundColor']}).toJSON());
  return colors;
}

test('text nothing colours leaves its colour to the platform', () => {
  expect(
    fragmentColors(
      <View>
        plain <View style={{display: 'inline'}}>inline</View>
      </View>,
    ),
  ).toEqual({plain: UNSET, inline: UNSET});
});

test('text inside an explicit <Text> keeps React Native black', () => {
  expect(
    fragmentColors(
      <Text>
        plain <Text>nested</Text>
      </Text>,
    ),
  ).toEqual({nested: DEFAULT});
});

test('an author colour still reaches the text', () => {
  expect(
    fragmentColors(
      <View style={{color: 'red'}}>
        plain <View style={{display: 'inline'}}>inline</View>
      </View>,
    ),
  ).toEqual({plain: RED, inline: RED});
});

test("`all: 'initial'` in an element restarts at CanvasText, not black", () => {
  expect(
    fragmentColors(
      <View style={{color: 'red'}}>
        plain{' '}
        {/* $FlowExpectedError[incompatible-type] `all` is a cascade key */}
        <View style={{display: 'inline', all: 'initial'}}>reset</View>
      </View>,
    ),
  ).toEqual({plain: RED, reset: UNSET});
});
