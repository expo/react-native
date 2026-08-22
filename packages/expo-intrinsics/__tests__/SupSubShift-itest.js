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
 * `<sup>` and `<sub>` are raised and lowered by the PLATFORM's text engine.
 *
 * Not by an offset computed here. CoreText's superscript attribute and
 * Android's `SuperscriptSpan`/`SubscriptSpan` both read the font's own
 * superscript metrics, so the shift follows the typeface instead of a shared
 * guess at an em fraction — which is wrong for any font whose designer chose
 * otherwise, and would need its own size change on top.
 *
 * Before this the elements were registered, inherited from, and completely
 * inert: they rendered as ordinary text, which is the hardest kind of missing
 * feature to notice because nothing errors.
 *
 * `vertical-align` is ONE property with two homes: `super`/`sub` shift glyphs
 * inside a run (a text attribute), while `top`/`bottom`/`middle` place a whole
 * atomic inline on a line (a Yoga box value). Both are read from the same prop
 * name, which is what keeps it one property to an author, as CSS has it.
 */

import {uaStyleFor} from '../src/uaStyles';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

// `MixedElement`, not `React.Node`: `root.render` takes an element, and
// `React.Node` also admits arrays and strings, which it does not.
function renderedWith(
  props: Array<string>,
  element: React.MixedElement,
): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return JSON.stringify(root.getRenderedOutput({props}).toJSX()) ?? '';
}

test('the user-agent sheet asks for super and sub', () => {
  // Chrome computes `vertical-align: super` at `font-size: 13.3333px` on a
  // 16px root — the same 0.83 ratio `<small>` uses.
  expect(uaStyleFor('sup').verticalAlign).toBe('super');
  expect(uaStyleFor('sub').verticalAlign).toBe('sub');
});

test('the shift reaches the rendered text run', () => {
  /*
   * The half that proves the plumbing rather than the stylesheet: the value has
   * to survive the prop parser, the text attributes, and the fragment merge to
   * arrive at the run. A user-agent entry nothing reads is exactly the state
   * these elements were already in.
   */
  const rendered = renderedWith(
    ['verticalAlign'],
    // $FlowExpectedError[not-a-component] intrinsic tags
    <div>
      {'x'}
      {/* $FlowExpectedError[not-a-component] */}
      <sup>up</sup>
      {/* $FlowExpectedError[not-a-component] */}
      <sub>down</sub>
    </div>,
  );
  expect(rendered).toContain('super');
  expect(rendered).toContain('sub');
});

test('ordinary text is not shifted', () => {
  const rendered = renderedWith(
    ['verticalAlign'],
    // $FlowExpectedError[not-a-component]
    <div>{'plain'}</div>,
  );
  expect(rendered).not.toContain('super');
});
