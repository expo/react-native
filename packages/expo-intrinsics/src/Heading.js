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
 * `<h1>`–`<h6>` carry HTML's implicit `heading` role, which is a prop and so
 * cannot be a stylesheet row. The level does not survive: React Native has no
 * `aria-level`, so every heading announces as a heading and `<h1>` and `<h4>`
 * are indistinguishable to assistive technology. Closing that needs a level
 * reaching `AccessibilityNodeInfo.setHeading` and `UIAccessibilityTraitHeader`.
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
