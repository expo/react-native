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
 * `<h1>`–`<h6>` — the heading role, which is the half of a heading that is not
 * font size.
 *
 * The UA sheet already gives each level its size and margins, and that is what a
 * sighted reader gets. A screen-reader user gets nothing from it: bigger text is
 * not a heading, and without the role there is no way to jump between headings,
 * which is the primary way many people navigate a long screen. HTML's implicit
 * ARIA role for `<h1>`–`<h6>` is `heading`, so that is stated here — the same
 * reasoning as `<a href>`'s link role in Anchor.js, and the reason both are
 * components rather than rows in the stylesheet: a role is a prop.
 *
 * ## The level does not survive
 *
 * A heading also has a *level*, and it is more than decoration — "heading level
 * 2" is what lets someone build a mental outline of a screen. React Native has
 * no `aria-level`, and neither `accessibilityRole: 'header'` nor
 * `role: 'heading'` carries one, so every heading here announces simply as a
 * heading. `<h1>` and `<h4>` are indistinguishable to assistive technology.
 *
 * That is a real loss and is recorded in `__docs__/SpecDeviations.md`. The role
 * without the level is still much better than neither: it restores
 * heading-to-heading navigation, and only the outline depth is missing. Closing
 * it means an `aria-level` prop reaching `AccessibilityNodeInfo.setHeading`'s
 * collection info on Android and `UIAccessibilityTraitHeader`'s level on iOS.
 */

const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

type HeadingProps = {
  children?: React.Node,
  accessibilityRole?: ?string,
  ...
};

/**
 * Builds the component for one heading level. The host element is registered
 * separately under `element-h1`…`element-h6`; this states the DOM name.
 */
export function makeHeading(tag: string): React.ComponentType<HeadingProps> {
  const Host: $FlowFixMe = `element-${tag}`;

  function Heading({accessibilityRole, ...rest}: HeadingProps): React.Node {
    return (
      <Host
        {...rest}
        nodeName={tag}
        // An author's own role wins, as everywhere else: the implicit role is a
        // default, not an override.
        accessibilityRole={accessibilityRole ?? 'header'}
      />
    );
  }

  Heading.displayName = tag;
  return Heading;
}

export {LEVELS};
