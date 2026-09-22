/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';
import {Platform} from 'react-native';

/**
 * `<native:keyboardpanel>` — a panel that takes the keyboard's place.
 *
 * The native chat's `+` opens one: the keys go away, a panel appears where they
 * were,
 * and the composer stays exactly where it is. That is not a view drawn over the
 * keyboard — it is the responder's `inputView`, which is UIKit's own primitive
 * for "show this instead of a keyboard".
 *
 * Using the primitive rather than imitating it is the whole point. The system
 * owns the transition, the height, the safe area under it, and what happens
 * when the field is dismissed — four behaviours that a panel positioned over
 * the keyboard would each have to reproduce, and would each get slightly wrong.
 *
 * It is a SIBLING of `<native:keyboardaccessory>`, not a child: the accessory
 * rides above the keyboard, the panel stands in for it. Two different slots on
 * the same responder, and an app can use either or both.
 *
 * DOM-CSS-LIMITATION(ios-only-keyboard-panel): iOS only. `inputView` has no
 * Android equivalent — an IME belongs to another process there, so nothing an
 * app owns can stand in its place. An Android panel would be a view positioned
 * where the keyboard was, animated by the machinery
 * `<native:keyboardaccessory>` already uses for its bar; the element would keep
 * its name and its meaning, and only the construction would differ.
 *
 * @param visible whether the panel is currently standing in for the keyboard.
 *   It opens with nothing focused too: with no other first responder the panel
 *   becomes one itself and is raised exactly as focusing a field raises a
 *   keyboard, so a `+` button never silently does nothing.
 * @param presentation `inputView` (default) replaces the keyboard; `overlay`
 *   covers it, anchored to a button and growing out of it. A panel that is an
 *   alternative INPUT wants the first; a list of COMMANDS wants the second,
 *   which is what the native chat's `+` does.
 * @param anchor `{x, y, width, height}` in window coordinates — the button an
 *   `overlay` grows out of, usually straight from `measureInWindow`.
 * @param onClose called when an overlay dismissed itself, which is the app's
 *   cue to set `visible` back to false.
 */
export default function NativeKeyboardPanel({
  visible = false,
  presentation = 'inputView',
  anchor,
  style,
  ...rest
}: $FlowFixMe): React.Node {
  /*
   * NOTHING on Android, rather than a red box.
   *
   * There is no Android view behind this element, so mounting it fails with
   * "Can't find ViewManager" and takes the whole surface down — a worse outcome
   * than the panel not opening. Rendering null means an app can write the
   * element unconditionally and lose only the feature, which is what
   * `DOM-CSS-LIMITATION(ios-only-keyboard-panel)` says happens.
   */
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-function] a registered host element is a string tag
    <native-keyboardpanel
      {...rest}
      visible={visible}
      presentation={presentation}
      /*
       * Spread as four numbers, not passed as the rect it is.
       *
       * A prop whose value is an object needs a converter on the C++ side, and
       * this one is measured in JavaScript with `measureInWindow` — which hands
       * back four numbers in the first place.
       */
      anchorX={anchor?.x ?? 0}
      anchorY={anchor?.y ?? 0}
      anchorWidth={anchor?.width ?? 0}
      anchorHeight={anchor?.height ?? 0}
      style={[styles.panel, style]}
      collapsable={false}
    />
  );
}

const styles = {
  /*
   * OUT OF THE FLOW, like the accessory and for the same reason.
   *
   * The host view is hidden and its children are drawn in the keyboard's own
   * window, so this box is read for its SIZE and never for its position. Left
   * in the flow it lays out as an ordinary child — written inside a composer
   * row it took a share of the row's width, and the field collapsed to make
   * room for a box that is never on screen.
   */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
