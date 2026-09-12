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
 * `<native:button>`: a button whose whole action is to open a menu, or, with no
 * commands, a press for the app to answer (`onPress`). Everything about it is
 * the platform's: one of UIKit's button configurations by UIKit's name (`glass`
 * is an interactive `UIGlassEffect` view around the button on iOS 26), the
 * button's own press tracking, and a `UIMenu` UIKit presents in the space above
 * the keys, since no window the app owns lies over the keyboard (see
 * `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`). The platform therefore
 * owns the menu's placement and styling; an app that needs either wants a panel.
 *
 * Prefer `<button>` with a `<menu>` child, which says the same thing in HTML's
 * words and works on both platforms. This element is for an app that wants the
 * platform's control and nothing of its own.
 *
 * DOM-CSS-LIMITATION(ios-only-native-button): iOS only, because it is a
 * `UIButtonConfiguration` and a `UIMenu`; on Android it renders nothing rather
 * than red-boxing, so it can be written unconditionally.
 *
 * @param title the label, given to the configuration so it is drawn inside the
 *   chrome rather than on top of it.
 * @param systemImage an SF Symbol name, used instead of `title` when both are
 *   given.
 * @param titleSize the title's point size; omitted means the platform's own. A
 *   prop rather than `font-size` because the title never becomes a text node.
 * @param configuration `plain` (default), `gray`, `tinted`, `filled`, `glass`
 *   or `prominentGlass`; before iOS 26 `glass` is `tinted` and `prominentGlass`
 *   is `filled`.
 * @param commands `[{id, label, disabled, destructive}]`, in order.
 * @param onCommand called with the chosen command's `id`.
 * @param onPress called on a tap when there are no commands.
 */
function NativeButton(
  {
    title = '',
    systemImage = '',
    titleSize = 0,
    configuration = 'plain',
    commands,
    onCommand,
    onPress,
    ...rest
  }: $FlowFixMe,
  ref: $FlowFixMe,
): React.Node {
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-component] a registered host element is a string tag
    <native-button
      {...rest}
      ref={ref}
      title={title}
      systemImage={systemImage}
      titleSize={titleSize}
      configuration={configuration}
      commands={commands ?? []}
      onCommand={
        onCommand == null
          ? undefined
          : (event: $FlowFixMe) => onCommand(event.nativeEvent.id)
      }
      onPress={onPress}
      collapsable={false}
    />
  );
}

// A ref reaches the host element, so a panel can measure the button it opens from
export default React.forwardRef(NativeButton) as $FlowFixMe;
