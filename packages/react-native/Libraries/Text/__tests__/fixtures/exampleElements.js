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
 * Example elements for react-native's own tests: `<inline>` and `<block>`.
 *
 * The inline formatting context, box decorations on an inline element, baseline
 * alignment — none of that is about HTML. It is machinery react-native owns,
 * and it needs *an* inline element and *a* block element to exercise it, not
 * specifically a `<span>` or a `<div>`.
 *
 * Reaching for the HTML tags was convenient while react-native shipped them.
 * Now that the catalog is moving to a provider, borrowing `<span>` would mean
 * react-native's tests depended on a package outside it to test its own
 * layout — so they define what they need instead.
 *
 * These are also the smallest possible statement of what an element is: a tag
 * name, a user-agent style, and a backing component derived from display.
 */

import {createViewConfig} from '../../../NativeComponent/ViewConfig';
import createReactNativeComponentClass from '../../../Renderer/shims/createReactNativeComponentClass';

const uaStyles: {[string]: {[string]: unknown}} = {
  inline: {display: 'inline'},
  block: {display: 'block'},
};

/**
 * Displays whose box establishes a formatting context, so the element cannot
 * fold into the surrounding inline flow and needs a box of its own.
 */
const BOX_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'block',
  'inline-block',
  'grid',
  'inline-grid',
]);

function backingFor(tag: string, textBacked: string) {
  return (props: {[string]: unknown}): string => {
    const style = props?.style;
    const uaDisplay = uaStyles[tag].display;
    if (style == null) {
      return typeof uaDisplay === 'string' && BOX_DISPLAYS.has(uaDisplay)
        ? 'element-box'
        : textBacked;
    }
    // Required lazily: importing StyleSheet at module scope pulls this module
    // into a require cycle that re-runs the registrations below.
    // $FlowFixMe[unclear-type] a lazily-required module has no static type
    const styleSheetModule: any = require('../../../StyleSheet/StyleSheet');
    const flatten =
      styleSheetModule.default?.flatten ?? styleSheetModule.flatten;
    const display = flatten(style)?.display ?? uaDisplay;
    return typeof display === 'string' && BOX_DISPLAYS.has(display)
      ? 'element-box'
      : textBacked;
  };
}

// Backed by react-native's two generic components — `inline-text` for the one
// that folds into a text run, `element-box` for the one that generates a box.
// Neither borrows an element from the DOM catalog, and neither needs C++.
createReactNativeComponentClass('inline', () =>
  createViewConfig({
    validAttributes: {
      isHighlighted: true,
      isPressable: true,
      maxFontSizeMultiplier: true,
      nodeName: true,
    },
    recordNodeName: true,
    uiViewClassName: 'inline-text',
    resolveUIViewClassName: backingFor('inline', 'inline-text'),
    uaStyle: uaStyles.inline,
  }),
);

createReactNativeComponentClass('block', () =>
  createViewConfig({
    validAttributes: {nodeName: true},
    recordNodeName: true,
    // `element-box` is react-native's GENERIC box: a View that honours whatever
    // display it is given and reports the authored tag. The block-ness comes
    // from this element's user-agent style below, not from a bespoke C++ class
    // — which is what makes a block element definable without one.
    uiViewClassName: 'element-box',
    uaStyle: uaStyles.block,
  }),
);

export default uaStyles;
