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

// The framework's catalog: bare tags, the unknown fallback, and the registry.
import {defineReactElement} from '@react-native/expo-intrinsics-poc';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import {createViewConfig} from 'react-native/Libraries/NativeComponent/ViewConfig';

/*
 * The precedence ruleset for element providers: the framework owns the bare
 * tags; a library owns its namespace, and can only ever define namespaced
 * tags.
 *
 * The colon tags render through React.createElement here because literal
 * <me:chip> JSX needs `throwIfNamespace: false` in the Babel transform — an
 * integration this repo's test transform does not carry. The element itself is
 * namespace-agnostic: a tag is a string.
 */

function inlineElementConfig(display: 'inline' | 'block') {
  return () =>
    createViewConfig({
      validAttributes: {nodeName: true},
      recordNodeName: true,
      uiViewClassName: display === 'inline' ? 'inline-text' : 'element-box',
      uaStyle: {display},
    });
}

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

test('a library element registers under its namespace and flows inline', () => {
  const tag = defineReactElement('me', 'chip', inlineElementConfig('inline'));
  expect(tag).toBe('me:chip');

  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{display: 'block', width: 400}}>
        {'before '}
        {/* $FlowFixMe[not-a-function] a dynamic intrinsic tag is a string */}
        {React.createElement(tag, {ref}, 'library content')}
        {' after'}
      </View>,
    );
  });

  // Inline, mid-line — the same layout any catalog inline element gets…
  expect(rectOf(ref).x).toBeGreaterThan(0);
  // …and DOM identity reports the namespaced tag the library declared.
  // $FlowFixMe[prop-missing] DOM tagName on the element
  expect(ref.current?.tagName).toBe('RN:me:chip');
});

test('a namespace collision throws instead of picking a winner', () => {
  defineReactElement('me', 'twice', inlineElementConfig('inline'));
  expect(() =>
    defineReactElement('me', 'twice', inlineElementConfig('inline')),
  ).toThrow(
    "<me:twice> is already registered. Two libraries sharing the 'me' " +
      'namespace must coordinate; the registry will not pick.',
  );
});

test('a library cannot mint a bare tag — the API has no way to say it', () => {
  // The nearest it could get is an invalid namespace or name, which throw.
  expect(() =>
    defineReactElement('', 'button', inlineElementConfig('inline')),
  ).toThrow("Invalid element namespace '': lowercase, and 'rn' is reserved.");
  expect(() =>
    defineReactElement('rn', 'button', inlineElementConfig('inline')),
  ).toThrow("Invalid element namespace 'rn': lowercase, and 'rn' is reserved.");
  expect(() =>
    defineReactElement('me', 'button:x', inlineElementConfig('inline')),
  ).toThrow("Invalid element name 'button:x'.");
});
