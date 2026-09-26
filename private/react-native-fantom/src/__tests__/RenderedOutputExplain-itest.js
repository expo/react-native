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
 * `getRenderedOutput(...).explain()`.
 *
 * A `props` filter that comes back empty has three causes that produce an
 * identical result, and this is the only thing that tells them apart. Each of
 * the three is asserted here against a tree built to have exactly that cause,
 * because a diagnostic that is confidently wrong is worse than none — it sends
 * the reader to the wrong file.
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
  // `nonsenseProp` is in no `getDebugProps` anywhere, which is the case that is
  // impossible to tell from a broken feature without this.
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    ['nonsenseProp'],
  );
  expect(report).toContain('/nonsenseProp/ matched NOTHING');
  expect(report).toContain('Present anywhere in the tree: backgroundColor');
  expect(report).toContain('add it to');
  // NOT the flattening answer: the tree is there, so saying so would send the
  // reader to look for a view that exists.
  expect(report).not.toContain('NOTHING WAS RENDERED');
});

test('a prop at its default reports the same way, and lists what is present', () => {
  // `opacity` IS emitted by BaseViewProps — it is just equal to the default
  // here, so it is dropped. Indistinguishable from the case above by design;
  // the report says what IS there so the reader can see which it is.
  const report = explain(
    <View style={{width: 10, height: 10, backgroundColor: 'blue'}} />,
    ['opacity'],
  );
  expect(report).toContain('/opacity/ matched NOTHING');
  expect(report).toContain('differs from the default');
});

test('a flattened view says so rather than blaming the prop', () => {
  // Nothing to paint, so no view reaches the mounting layer at all. This is the
  // one that reads as a broken feature: every prop is absent because there is
  // nothing to hold one.
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
