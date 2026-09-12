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
 * `<native:menubutton>` — a button whose whole action is to open a menu.
 *
 * Everything about it is the platform's. The glass is a
 * `UIButtonConfiguration`; the press is the button's own tracking, so it gets
 * the system's growth and brightening rather than a reproduction of them; and
 * the menu is a `UIMenu` that UIKit presents, positions and composites.
 *
 * It does NOT lie over the keyboard, and nothing does. Measured by enumerating
 * the windows with a menu open: the menu is drawn in a `UITextEffectsWindow` at
 * window level 1, and the keyboard's `UIRemoteKeyboardWindow` is at level
 * 10000001. UIKit places the menu in the space above the keys — which is what
 * the native chat's `+` menu does too, and why it opens upward. See
 * `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`.
 *
 * The cost is that the platform owns the menu's placement and its styling. An
 * app that needs to decide either of those wants a panel instead.
 *
 * **Prefer `<button>` with a `<menu>` child.** It says the same thing in HTML's
 * own words, it carries the semantics, and it works on both platforms — a
 * `UIMenu` on iOS and a `PopupMenu` on Android. This element is here as the
 * control group for that one, and for an app that wants the platform's control
 * and nothing of its own: the label inside the chrome rather than as a child,
 * and the button's own touch tracking rather than the element's.
 *
 * DOM-CSS-LIMITATION(ios-only-menu-button): iOS only, because it is a
 * `UIButtonConfiguration` and a `UIMenu` — being the platform's control is what
 * the element is for, so there is nothing here to port. On Android it renders
 * nothing rather than red-boxing, so an app can write it unconditionally; the
 * portable spelling is `<button>` with a `<menu>`.
 *
 * @param title the button's label, given to the button's configuration so it is
 *   drawn INSIDE the chrome rather than on top of it.
 * @param systemImage an SF Symbol name, used instead of `title` when both are
 *   given.
 * @param titleSize the title's point size; omitted means the platform's own. A
 *   prop rather than `font-size` because the title never becomes a text node,
 *   so the style cascade has nothing to reach.
 * @param prominent the filled, tinted glass rather than the plain one.
 * @param commands `[{id, label, disabled, destructive}]`, in order.
 * @param onCommand called with the chosen command's `id`.
 */
export default function NativeMenuButton({
  title = '',
  systemImage = '',
  titleSize = 0,
  prominent = false,
  commands,
  onCommand,
  ...rest
}: $FlowFixMe): React.Node {
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-component] a registered host element is a string tag
    <native-menubutton
      {...rest}
      title={title}
      systemImage={systemImage}
      titleSize={titleSize}
      prominent={prominent}
      commands={commands ?? []}
      onCommand={
        onCommand == null
          ? undefined
          : (event: $FlowFixMe) => onCommand(event.nativeEvent.id)
      }
      collapsable={false}
    />
  );
}
