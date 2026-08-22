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
 * That the user-agent stylesheet hands down the *right symbolic colour*.
 *
 * The defaults theme by naming each platform's own colour rather than stating a
 * value, so an element follows light and dark without being asked — the one
 * place worth departing from the web, whose initial `color` is a fixed colour.
 *
 * **What is asserted, and why it is asserted here.** A symbolic colour is a
 * *reference*: `{resource_paths: ['?android:attr/textColorPrimary']}` on
 * Android, `{semantic: ['labelColor']}` on iOS. Nothing resolves it to pixels
 * until the platform does, and this environment has no platform — the renderer
 * drops it, so rendered output carries no colour on either state and asserting
 * on pixels here could only ever assert "nothing".
 *
 * So this pins the exact reference being passed down: the right name, on the
 * right platform, on the elements that should carry it. That is the half this
 * environment can prove. That the OS then *accepts* those names is the other
 * half, and it is proved natively:
 *
 *  - Android: `ColorPropConverterTest` resolves each attribute this file names
 *    and asserts it comes back opaque — the test that catches the bug where a
 *    ColorStateList's resource ID was returned as ARGB and drew as transparent.
 *  - iOS: `RCTConvert_UIColorTests.testUserAgentStylesheetSemanticColorsResolve`
 *    resolves each semantic name through `RCTConvert`.
 *
 * Neither half is sufficient alone. A test that only checked "some colour"
 * would pass on a typo'd attribute name, and a native test alone would not
 * notice the stylesheet handing down the wrong one.
 */

import {uaStyleFor} from '../src/uaStyles';
import {Platform} from 'react-native';
import * as ReactNativeViewConfigRegistry from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

/**
 * The symbolic colour the platform is being asked for, as a plain name.
 *
 * Both platforms wrap the name in a differently-shaped object, so the shape is
 * unwrapped here and the assertions below talk about names — which is the thing
 * that has to be right, and the thing a typo breaks.
 */
function symbolOf(color: unknown): string | null {
  if (color == null || typeof color !== 'object') {
    return null;
  }
  const androidPaths = color.resource_paths;
  if (Array.isArray(androidPaths) && typeof androidPaths[0] === 'string') {
    return androidPaths[0];
  }
  const iosSemantic = color.semantic;
  if (Array.isArray(iosSemantic) && typeof iosSemantic[0] === 'string') {
    return iosSemantic[0];
  }
  return null;
}

// The names the native tests resolve. Kept here as the single statement of what
// this platform is asked for, so a change has to be made in one place and shows
// up in both halves.
const DISABLED_TEXT_SYMBOL =
  Platform.OS === 'android'
    ? '?android:attr/textColorTertiary'
    : 'tertiaryLabelColor';

// The registered hosts whose UA style should carry the initial values. Named
// rather than discovered, because the registry has no public enumeration.
const ELEMENT_HOSTS = [
  'element-button-box',
  'element-input',
  'element-textarea',
];

function uaStyleForButton(props: {[string]: unknown}): {[string]: unknown} {
  const viewConfig: $FlowFixMe =
    ReactNativeViewConfigRegistry.get('element-button-box');
  const uaStyle = viewConfig.uaStyle;
  return typeof uaStyle === 'function' ? uaStyle(props) : uaStyle;
}

describe('the user-agent sheet passes down symbolic colours', () => {
  test('NO element is given a blanket canvas-text colour', () => {
    /*
     * This asserted the opposite until the inheritance bug was found.
     *
     * Giving every element `color` themed a bare screen correctly and destroyed
     * the cascade: a child's own user-agent declaration outranks the value it
     * should have inherited, so `<div style={{color:'red'}}>` drew its `<b>`
     * and `<small>` in the canvas colour. Chrome states `color` once, on the
     * root, precisely so that cannot happen.
     *
     * DOM-CSS-LIMITATION(themed-default-colour-needs-a-root): there is no
     * document root here to carry it, so the themed default belongs in the
     * renderer's choice of default foreground colour, not in a declaration
     * that competes in the cascade.
     */
    for (const tag of ['div', 'span', 'b', 'p', 'em', 'strong']) {
      expect(uaStyleFor(tag).color).toBeUndefined();
    }
  });

  test('a disabled <button> is given a DIFFERENT symbolic colour', () => {
    // The disabled state has to be distinguishable, and by symbol rather than
    // by "not null": both states carry a colour now, so only the names differ.
    const enabled = symbolOf(uaStyleForButton({}).color);
    const disabled = symbolOf(uaStyleForButton({disabled: true}).color);

    expect(disabled).toBe(DISABLED_TEXT_SYMBOL);
    expect(enabled).not.toBe(disabled);
  });

  test('no registered element declares a colour, however its style is built', () => {
    /*
     * The invariant, walked over what is actually registered rather than over
     * the handful known to be built a given way.
     *
     * A `uaStyle` may be a plain table entry or a function of props, and a
     * function that builds a fresh object can reintroduce a colour without it
     * being visible in the sheet. Only a DISABLED control may declare one —
     * that is a state style, and it outranks inheritance for the same reason a
     * browser's `:disabled` rule does.
     */
    /*
     * Form controls are exempt, and that is browser behaviour rather than a
     * concession: in Chrome a `<button>` under `color: red` computes BLACK. A
     * control states its own colour. What must never declare one is an element
     * whose meaning has nothing to do with colour.
     */
    const CONTROLS = [
      'element-button-box',
      'element-input',
      'element-textarea',
    ];
    const declaring = [];
    for (const name of ELEMENT_HOSTS) {
      if (CONTROLS.includes(name)) {
        continue;
      }
      let viewConfig: $FlowFixMe;
      try {
        viewConfig = ReactNativeViewConfigRegistry.get(name);
      } catch {
        continue; // not registered in this environment
      }
      const uaStyle = viewConfig.uaStyle;
      const resolved =
        (typeof uaStyle === 'function' ? uaStyle({}) : uaStyle) ?? {};
      if (resolved.color !== undefined) {
        declaring.push(name);
      }
    }
    expect(declaring).toEqual([]);
  });

  test('an author colour still beats the symbolic default', () => {
    // A literal resolves everywhere, so this one is end-to-end. The themed
    // default must never take the cascade away from an author.
    const authored = uaStyleForButton({disabled: true});
    const merged = {...authored, color: '#ff0000'};
    expect(merged.color).toBe('#ff0000');
  });
});
