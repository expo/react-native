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
 * `<native:keyboardaccessory>` — a bar that is part of the keyboard.
 *
 * The chat composer, the toolbar above a text field, the "Done" row: anything that belongs against
 * the keyboard when there is one and against the bottom of the screen when there is not. Those are
 * the same requirement, not two, which is why this takes no `behavior` prop and asks the author
 * nothing.
 *
 * ## Part of the keyboard, not next to it
 *
 * The distinction sounds academic and is the whole feature. A bar that merely tracks the keyboard's
 * frame looks identical while the keyboard animates and behaves differently the moment a finger
 * lands on it: `UIKeyboardLayoutGuide` documents that interactive dismissal "waits to start the
 * dismiss until it intersects with the keyboard", so dragging down from the composer does nothing
 * and you have to start the drag on the keys. That is not how the platform's own chat behaves,
 * because its composer really is the keyboard's accessory view. This one is too — on iOS literally, via
 * `inputAccessoryView`; on Android, where the IME belongs to another window and cannot be attached
 * to, by following the keyboard's own animation and offering drags on itself to the same controller
 * the keyboard uses.
 *
 * ## It is out of the flow
 *
 * It does not occupy a box in the column it is written in. Room for it is made by the thing it
 * covers — `<native:scroll>` already reserves the bottom obstruction, and the bar is part of that
 * obstruction — rather than by the bar reserving its own height twice. Put it anywhere inside the
 * screen; where it is written makes no difference to where it lands.
 */
/**
 * @param scope who the bar belongs to.
 *
 *   - `"screen"` (default) — it belongs to the screen it is written in, and
 *     stands down while another screen is on top. That is what a navigator
 *     wants: each screen brings its own bar and takes it away again.
 *   - `"app"` — it stays up across navigation, floating above every screen,
 *     which is what a real `inputAccessoryView` does if nothing stands it down.
 *     Right for an app whose composer IS the app.
 *
 * Both are things UIKit can do, so both are things this element can do.
 */
/**
 * @param onDockChange called with `{docked, reserve}` whenever the bar's
 *   relationship to the bottom of the screen changes.
 *
 *   `docked` is 1 while the bar rests on the screen, 0 while the keys are under
 *   it, and every value between during the transition; `reserve` is the same
 *   answer in points — how much of the home indicator's strip the bar is
 *   standing on.
 *
 *   The bar has to say, because nothing else can. `Keyboard`'s notifications do
 *   not: installing an `inputAccessoryView` posts `keyboardWillShow` with the
 *   ACCESSORY's frame as the end frame, so a bar that listened to them reads as
 *   permanently undocked. Nor does the view's safe area, which changes by WINDOW
 *   rather than by state and is invisible to the shadow tree either way.
 *
 *   A fraction rather than a boolean because the transition is a third of a
 *   second long and what an author does with it moves too — the platform's own
 *   composer takes its padding from 28 points to 16 across exactly this. A boolean would
 *   be a step in the middle of a slide.
 */
/**
 * @param automaticInsets whether the bar reserves the strip of the home
 *   indicator's band that the keys do not already cover. `true` by default,
 *   because a bar that ends under the indicator is a bug and an author should
 *   not have to know that to avoid it.
 *
 *   `false` is for the app that wants to draw INTO that strip, and it is a
 *   narrower request than "ignore the safe area". The platform's native composer
 *   sits **28** points off the bottom of the screen against a safe area of 34 —
 *   concentric with the display's corner — so its pill deliberately overlaps the
 *   top of the band. No padding
 *   expresses that while the element is also reserving, because the two ADD: the
 *   only way to land on a number smaller than the safe area is to own the whole
 *   strip and pay part of it.
 *
 *   The bar goes on MEASURING it either way, and `onDockChange` goes on
 *   publishing it. An author who owns an edge needs its size more than one who
 *   does not.
 *
 *   28 is not derivable from anything the platform publishes, which is why this
 *   is a prop rather than a better default: an element that guessed it would be
 *   wrong on every device whose corner differs.
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
  /*
   * Stated here rather than in the component descriptor so that the layout an
   * author reads back is the layout that ran — there is no second, invisible
   * place where position is decided.
   *
   * On iOS the host view is hidden and its children are drawn in the keyboard's
   * own window, so this box is read for its SIZE and never for its position —
   * UIKit decides where the bar goes. On Android the box is where the bar
   * actually is, and docks to the keyboard from there.
   */
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
