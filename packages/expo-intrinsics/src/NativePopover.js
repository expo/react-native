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
 * `<native:popover>`: a card the platform presents as a popover, zoomed out of
 * the element under `anchor`, over a keyboard stood down behind a picture of
 * its keys. The card, the morph, the dimming, the tap outside and the pull to
 * dismiss are UIKit's; the element adds standing the keyboard down while the
 * composer bar holds its place, and giving it back when the card is gone.
 *
 * The children are the card's content; the first child's frame is the card, and
 * their box states no surface of its own.
 *
 * DOM-CSS-LIMITATION(ios-only-popover): iOS only, as `<native:keyboardpanel>`;
 * it renders nothing on Android so an app can write it unconditionally.
 *
 * @param visible whether the card is up. The platform can take it down on its
 *   own; `onClose` is the cue to set this back to false.
 * @param anchor `{x, y, width, height}` in window coordinates, usually from
 *   `measureInWindow`. Only its x locates the element: with a keyboard up the
 *   measured y is where the bar sits in the layout, not where it is drawn.
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
      // Four numbers rather than a rect, which would need a C++ converter
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
  // Out of the flow, like the keyboard panel: the host is a hidden handle whose
  // children are drawn in the popover, so the box is read for its size only
  box: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
};
