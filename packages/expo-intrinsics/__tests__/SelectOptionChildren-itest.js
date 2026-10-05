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

import {collectOptions} from '@react-native/expo-intrinsics-poc/src/Select';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * `<select>` is an element that is NOT a box.
 *
 * Its `<option>` children are a list handed to a platform control, not boxes to
 * lay out — a native select is *given* its options and draws the menu itself.
 * So the tag resolves to a JavaScript component that reads the children and
 * passes them down as one prop, and `<option>` is never mounted at all.
 *
 * These tests pin the two halves of that. First, that a lowercase tag can
 * resolve to a component: the resolution happens in the reconciler, next to the
 * view-config fallback, which is what makes it hold however the element was
 * created rather than only for JSX. Second, that HTML's rules about `<option>`
 * are applied on the way down — an option's text is its children, and an option
 * with no `value` takes that text as its value.
 */

function renderSelect(element: React.MixedElement): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['options', 'value', 'nodeName']}).toJSX(),
    ) ?? ''
  );
}

test('<select> renders a control, and its <option> children are not mounted', () => {
  const output = renderSelect(
    // $FlowFixMe[prop-missing] intrinsic
    <select value="b">
      {/* $FlowFixMe[prop-missing] */}
      <option value="a">Apple</option>
      {/* $FlowFixMe[prop-missing] */}
      <option value="b">Banana</option>
    </select>,
  );

  // The tag resolved to a component, which rendered the control. If the
  // reconciler had treated `select` as a host component this would be
  // `rn-select` and there would be no view config for it at all.
  expect(output).toContain('element-select');
  // No option is a view of its own. Mounting them would create nodes that are
  // never on screen.
  expect(output).not.toContain('rn-option');
  expect(output).not.toContain('rn-optgroup');
});

/*
 * The option rules are asserted against the collector directly rather than
 * through the rendered tree, because the options cross as a prop the mounted
 * view does not expose for inspection. What matters here is HTML's semantics,
 * and those live in this function.
 */

test("an <option>'s text is its children", () => {
  const options = collectOptions([
    // $FlowFixMe[prop-missing] intrinsic
    <option key="a" value="a">
      Apple
    </option>,
  ]);
  expect(options).toEqual([{value: 'a', label: 'Apple', disabled: false}]);
});

test('an <option> with no value takes its text as its value, as in HTML', () => {
  const options = collectOptions([
    // $FlowFixMe[prop-missing] intrinsic
    <option key="c">Cherry</option>,
  ]);
  expect(options).toEqual([
    {value: 'Cherry', label: 'Cherry', disabled: false},
  ]);
});

test('an explicit label beats the text, as in HTML', () => {
  const options = collectOptions([
    // $FlowFixMe[prop-missing] intrinsic
    <option key="d" value="d" label="Damson">
      ignored
    </option>,
  ]);
  expect(options).toEqual([{value: 'd', label: 'Damson', disabled: false}]);
});

test('a disabled <option> is carried through, not dropped', () => {
  const options = collectOptions([
    // $FlowFixMe[prop-missing] intrinsic
    <option key="b" value="b" disabled={true}>
      Banana
    </option>,
  ]);
  // Still part of the choice on offer: the control lists it and refuses to
  // pick it.
  expect(options).toEqual([{value: 'b', label: 'Banana', disabled: true}]);
});

test('<optgroup> contributes its options, flattened', () => {
  const options = collectOptions([
    // $FlowFixMe[prop-missing] intrinsic
    <optgroup key="g" label="Stone fruit">
      {/* $FlowFixMe[prop-missing] */}
      <option value="p">Peach</option>
    </optgroup>,
  ]);
  // Neither platform's control draws group headings once it is handed a flat
  // list, so the grouping is dropped rather than the options.
  expect(options).toEqual([{value: 'p', label: 'Peach', disabled: false}]);
});

test('anything that is not an option is ignored', () => {
  const options = collectOptions([
    'stray text',
    null,
    // $FlowFixMe[prop-missing] intrinsic
    <option key="a" value="a">
      Apple
    </option>,
  ]);
  expect(options).toEqual([{value: 'a', label: 'Apple', disabled: false}]);
});
