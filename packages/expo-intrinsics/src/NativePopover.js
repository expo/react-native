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
 * `<native:popover>` — a card the platform presents as a popover, zoomed out
 * of the element under `anchor`, over a keyboard stood down behind a picture
 * of its keys.
 *
 * The native chat's `+` opens one. Everything visible is the platform's: the
 * card is the popover's own glass platter, the morph in and out of the anchor
 * and the dimming behind are UIKit's zoom transition, the tap outside and the
 * pull to dismiss are the popover's, and it is placed with its vertical centre
 * on the anchor and moved only as far as the screen's edges require. What the
 * element adds is standing the keyboard down for it: the keys are pictured
 * where they were while the composer bar holds its place, so the card can lie
 * over them, and the field takes the keyboard back when the card is gone.
 *
 * The children are the card's content, laid out by React inside the platter;
 * the first child's frame is the card. Their box states no surface of its own.
 *
 * DOM-CSS-LIMITATION(ios-only-popover): iOS only, for the same reason as
 * `<native:keyboardpanel>`: it renders nothing on Android rather than
 * red-boxing, so an app can write it unconditionally.
 *
 * @param visible whether the card is up. The platform can take it down on its
 *   own (a tap outside, a pull, a rotation); `onClose` is the cue to set this
 *   back to false.
 * @param anchor `{x, y, width, height}` in window coordinates — the element the
 *   card grows out of, usually straight from `measureInWindow`. Only its x is
 *   used to find the element: with a keyboard up the measured y is where the
 *   bar sits docked, not where it is drawn.
 * @param onClose called when the card dismissed itself.
 */
export default function NativePopover({
  visible = false,
  anchor,
  style,
  ...rest
}: $FlowFixMe): React.Node {
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-function] a registered host element is a string tag
    <native-popover
      {...rest}
      visible={visible}
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
      style={[styles.box, style]}
      collapsable={false}
    />
  );
}

const styles = {
  /*
   * OUT OF THE FLOW, like the keyboard panel and for the same reason: the host
   * view is a hidden handle whose children are drawn in the popover, so this
   * box is read for its SIZE and never for its position.
   */
  box: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
