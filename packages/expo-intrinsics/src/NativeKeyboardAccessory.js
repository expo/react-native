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

/**
 * `<native:keyboardaccessory>`: a bar that is part of the keyboard. It sits
 * against the keyboard when there is one and against the bottom of the screen
 * when there is not, which is one requirement, so there is no `behavior` prop.
 *
 * Part of the keyboard rather than next to it: a drag that begins on the bar
 * dismisses the keyboard, as `UIKeyboardLayoutGuide`'s dismiss padding allows
 * on iOS and as offering the bar's own drags to the keyboard's controller does
 * on Android, where the IME is another window.
 *
 * Out of the flow: it occupies no box in the column it is written in. Room for
 * it is made by what it covers, since `<native:scroll>` reserves the bottom
 * obstruction and the bar is part of that obstruction.
 *
 * @param scope `"screen"` (default) belongs to the screen it is written in and
 *   stands down while another screen is on top; `"app"` stays up across
 *   navigation, for an app whose composer is the app.
 * @param onDockChange called with `{docked, reserve}` whenever the bar's
 *   relationship to the bottom of the screen changes: `docked` is 1 while the
 *   bar rests on the screen, 0 while the keys are under it, and every value
 *   between during the transition, so an author can animate with it as the
 *   platform's composer animates its padding; `reserve` is the same answer in
 *   points of the home indicator's strip. The bar has to say, since the
 *   keyboard notifications and the safe area cannot.
 * @param automaticInsets whether the bar reserves the strip of the home
 *   indicator's band the keys do not cover; `true` by default. `false` is for an
 *   app that draws into that strip, as the platform's composer does: no padding
 *   lands below the safe area while the element also reserves, because the two
 *   add. The bar measures the strip either way, and `onDockChange` publishes it.
 */
export default function NativeKeyboardAccessory({
  scope = 'screen',
  style,
  ...rest
}: $FlowFixMe): React.Node {
  return (
    // $FlowFixMe[not-a-function] a registered host element is a string tag
    <native-keyboardaccessory
      {...rest}
      scope={scope}
      style={[styles.bar, style]}
      collapsable={false}
    />
  );
}

const styles = {
  // Stated here rather than in the component descriptor, so the layout an author
  // reads back is the layout that ran. On iOS the host is hidden and the box is
  // read for its size only; on Android the box is where the bar is.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
