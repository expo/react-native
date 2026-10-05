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
 * `<a>` is a component for HTML's implicit role: an anchor with an `href` is a
 * link and one without is a placeholder. The role is a prop because it
 * travels with the text attributes into the paragraph, where every run
 * carrying `accessibilityRole: 'link'` becomes its own accessibility element.
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
