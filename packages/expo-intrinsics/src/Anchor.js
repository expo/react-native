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
 * `<a>` — a run of text that may be a link.
 *
 * The element is a component for one reason: HTML's implicit ARIA role. An
 * anchor **with** an `href` is a link and has to say so, and an anchor without
 * one is not — the spec is explicit that `<a>` with no `href` is a placeholder,
 * not a link, which is also why the user-agent style only colours and
 * underlines the one that has an href.
 *
 * That role has to be a prop rather than a style, because it travels with the
 * text attributes into the paragraph, where the accessibility provider turns
 * every run carrying `accessibilityRole: 'link'` into its own element with its
 * own frame. That is what makes a link *inside a sentence* reachable: it is not
 * a view, it is a range of glyphs, and without the role there is nothing for
 * VoiceOver to land on. Measured before this: the anchor row had no
 * accessibility element at all, while the surrounding paragraph did.
 */

type AnchorProps = {
  href?: ?string,
  children?: React.Node,
  accessibilityRole?: ?string,
  ...
};

function Anchor({href, accessibilityRole, ...rest}: AnchorProps): React.Node {
  return (
    // $FlowFixMe[prop-missing] intrinsic
    <element-a
      {...rest}
      nodeName="a"
      href={href}
      // An author's own role wins, as everywhere else; the implicit role is
      // only a default, and only when this anchor is actually a link.
      accessibilityRole={
        accessibilityRole ?? (href != null ? 'link' : undefined)
      }
    />
  );
}

export default Anchor;
