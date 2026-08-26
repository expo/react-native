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
import {useCallback} from 'react';
import {Linking} from 'react-native';

/**
 * `<a>` — a run of text, or a box, that may be a link.
 *
 * The element is a component for two reasons.
 *
 * ## HTML's implicit ARIA role
 *
 * An anchor **with** an `href` is a link and has to say so, and an anchor
 * without one is not — the spec is explicit that `<a>` with no `href` is a
 * placeholder, not a link, which is also why the user-agent style only colours
 * the one that has an href.
 *
 * That role has to be a prop rather than a style, because it travels with the
 * text attributes into the paragraph, where the accessibility provider turns
 * every run carrying `accessibilityRole: 'link'` into its own element with its
 * own frame. That is what makes a link *inside a sentence* reachable: it is not
 * a view, it is a range of glyphs, and without the role there is nothing for
 * VoiceOver to land on. Measured before this: the anchor row had no
 * accessibility element at all, while the surrounding paragraph did.
 *
 * ## Following the link
 *
 * The user-agent's default action for a click on an anchor is to navigate, and
 * nothing was performing it: `href` was carried for accessibility and read by
 * nobody, so a link was correctly coloured, correctly announced, and completely
 * inert.
 *
 * It is done HERE, in the component, rather than natively, and that is the
 * point of doing it at all in this file: an anchor is not one shape. It can be
 * a run of glyphs inside a paragraph, a box wrapping an `<img>`, or a block
 * container if an author writes `display: 'block'` — and `click` arrives the
 * same way for all three, because the pointer handler dispatches to whatever
 * the hit-test resolved, glyph range or view alike. A native implementation
 * would have to be written once per shape and would still miss the next one.
 *
 * Cancelable, like the web's. An author's `onClick` runs first and can call
 * `preventDefault()`; the navigation is what happens when nobody objects. That
 * ordering is what makes `<a href>` usable as a router link rather than
 * something to be worked around.
 */

type AnchorProps = {
  href?: ?string,
  children?: React.Node,
  accessibilityRole?: ?string,
  onClick?: ?(event: $FlowFixMe) => unknown,
  ...
};

function Anchor({href, accessibilityRole, onClick, ...rest}: AnchorProps): React.Node {
  const handleClick = useCallback(
    (event: $FlowFixMe) => {
      // The author's handler first, so it can cancel what follows.
      if (onClick != null) {
        onClick(event);
      }
      if (href == null || event?.defaultPrevented === true) {
        return;
      }
      // Swallowed rather than thrown: a URL the platform will not open — a
      // scheme with no handler, a malformed href — is bad *content*, and taking
      // the surface down over it would be a far worse failure than a tap that
      // does nothing. The warning is where an author looks.
      Linking.openURL(href).catch((error: Error) => {
        console.warn(`<a href="${href}"> could not be opened: ${error.message}`);
      });
    },
    [href, onClick],
  );

  return (
    // $FlowFixMe[prop-missing] intrinsic
    <element-a
      {...rest}
      nodeName="a"
      href={href}
      // Attached only when it would do something. An element with a click
      // handler is a pointer target, and a bare `<a>` used as a jump target
      // should not become one for nothing.
      onClick={href != null || onClick != null ? handleClick : undefined}
      // An author's own role wins, as everywhere else; the implicit role is
      // only a default, and only when this anchor is actually a link.
      accessibilityRole={
        accessibilityRole ?? (href != null ? 'link' : undefined)
      }
    />
  );
}

export default Anchor;
