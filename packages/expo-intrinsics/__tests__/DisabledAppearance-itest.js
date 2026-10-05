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
 * A disabled control looks disabled. A `<button>`'s label colour comes from
 * the user-agent sheet and is testable here; an `<input>`'s is set on the
 * platform control in the component view. The colours are `PlatformColor`s,
 * which resolve to nothing on this host, so the declaration is asserted and
 * that the two states differ; an author's literal colour still resolves, so
 * that it wins is asserted end to end.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import * as ReactNativeViewConfigRegistry from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

import '@react-native/expo-intrinsics-poc';

/**
 * What the user-agent stylesheet declares for `<button>` in a given state.
 *
 * Read from the registered view config, which is the same function the renderer
 * calls, so this cannot drift from what elements actually get.
 */
function uaStyleForButton(props: {[string]: unknown}): {[string]: unknown} {
  const viewConfig: $FlowFixMe =
    ReactNativeViewConfigRegistry.get('element-button-box');
  const uaStyle = viewConfig.uaStyle;
  return typeof uaStyle === 'function' ? uaStyle(props) : uaStyle;
}

/**
 * The resolved text colour of whatever the element rendered, or `null`. Reads
 * the one value under test rather than comparing serialised trees, which can
 * differ in key order between identical renders.
 */
function textColorOf(element: React.MixedElement): string | null {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // `JSON.stringify` answers `undefined` for an undefined input, so the
  // nothing-rendered case is handled rather than assumed away.
  const rendered = JSON.stringify(root.getRenderedOutput().toJSX()) ?? '';
  const match = rendered.match(/"foregroundColor":"([^"]*)"/);
  return match == null ? null : match[1];
}

describe('a disabled control is drawn as disabled', () => {
  test('the user-agent sheet declares a colour for a disabled <button>', () => {
    // The bug itself: it declared none, so a disabled button was drawn exactly
    // like a live one.
    expect(uaStyleForButton({disabled: true}).color).toBeDefined();
  });

  test('a disabled <button> is declared a DIFFERENT colour than an enabled one', () => {
    /*
     * Both states declare a colour, and that is correct — verified in Chrome,
     * where `<div style="color:red"><button>` computes BLACK, not red. A form
     * control states its own text colour and does not inherit; a presentational
     * inline like `<b>` does inherit, and computes red in the same test.
     *
     * So the rule is not "no element may declare a colour" — it is that an
     * element must not declare an INHERITED property it has no business
     * stating. A control's own colour is its business. See
     * ColorInheritance-itest for the elements where it is not.
     *
     * What matters here is that the two states differ: a control that looks
     * live when it is not is worse than either state alone.
     */
    const enabled = uaStyleForButton({}).color;
    const disabled = uaStyleForButton({disabled: true}).color;

    expect(disabled).toBeDefined();
    expect(enabled).toBeDefined();
    expect(disabled).not.toBe(enabled);
  });

  test('an author colour still wins over the disabled colour', () => {
    // The user-agent origin loses to the author's, as everywhere else in CSS:
    // a design system that greys its own disabled buttons must not be
    // overridden by ours.
    const authored = textColorOf(
      // $FlowFixMe[prop-missing] elements from the catalog
      <button disabled={true} style={{color: '#ff0000'}}>
        {'Submit'}
      </button>,
    );
    expect(authored).toBe('rgba(255, 0, 0, 1)');
  });
});
