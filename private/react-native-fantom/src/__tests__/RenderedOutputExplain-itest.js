/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `getRenderedOutput(...).explain()`: each of the three causes of an empty
 * `props` filter, asserted against a tree built to have exactly that cause
 */

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

function explain(element: React.MixedElement, props: Array<string>): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return root.getRenderedOutput({props}).explain();
}

test('a name the renderer never emits reports as matching nothing', () => {
  // `nonsenseProp` is in no `getDebugProps` anywhere
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    ['nonsenseProp'],
  );
  expect(report).toContain('/nonsenseProp/ matched NOTHING');
  expect(report).toContain('Present anywhere in the tree: backgroundColor');
  expect(report).toContain('add it to');
  // Not the flattening answer: the tree is there
  expect(report).not.toContain('NOTHING WAS RENDERED');
});

test('a prop at its default reports the same way, and lists what is present', () => {
  // `opacity` is emitted by BaseViewProps but equals the default here, so it
  // is dropped; the report says what is there so the reader can tell which
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    ['opacity'],
  );
  expect(report).toContain('/opacity/ matched NOTHING');
  expect(report).toContain('differs from the default');
});

test('a flattened view says so rather than blaming the prop', () => {
  // Nothing to paint, so no view reaches the mounting layer and there is
  // nothing to hold a prop
  const report = explain(<View style={{width: 10, height: 10}} />, ['opacity']);
  expect(report).toContain('NOTHING WAS RENDERED');
  expect(report).toContain('view flattening');
  expect(report).not.toContain('Present anywhere in the tree');
});

test('a matching pattern names what it matched', () => {
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    ['backgroundColor', 'nonsenseProp'],
  );
  expect(report).toContain('/backgroundColor/ matched: backgroundColor');
  expect(report).toContain('/nonsenseProp/ matched NOTHING');
});

test('no filter says so rather than reporting an empty match list', () => {
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    [],
  );
  expect(report).toContain('No `props` filter was given');
});
