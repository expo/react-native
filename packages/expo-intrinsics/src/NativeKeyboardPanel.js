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
 * `<native:keyboardpanel>`: a panel that takes the keyboard's place, as the
 * responder's `inputView`, so the system owns the transition, the height, the
 * safe area under it and the dismissal. A sibling of
 * `<native:keyboardaccessory>`, which rides above the keyboard where this stands
 * in for it; a card over the keys growing out of a button is `<native:popover>`.
 *
 * DOM-CSS-LIMITATION(ios-only-keyboard-panel): iOS only. `inputView` has no
 * Android equivalent, since an IME belongs to another process there; an Android
 * panel would be a view positioned where the keyboard was, animated by the
 * machinery the accessory uses for its bar.
 *
 * @param visible whether the panel is standing in for the keyboard. With nothing
 *   focused the panel becomes first responder itself and is raised as a keyboard
 *   would be.
 */
export default function NativeKeyboardPanel({
  visible = false,
  style,
  ...rest
}: $FlowFixMe): React.Node {
  // Nothing on Android rather than a red box: there is no view behind the
  // element there, and mounting it would take the surface down, see
  // `DOM-CSS-LIMITATION(ios-only-keyboard-panel)`
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-function] a registered host element is a string tag
    <native-keyboardpanel
      {...rest}
      visible={visible}
      style={[styles.panel, style]}
      collapsable={false}
    />
  );
}

const styles = {
  // Out of the flow, like the accessory: the host is hidden and its children
  // are drawn in the keyboard's window, so the box is read for its size only
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
