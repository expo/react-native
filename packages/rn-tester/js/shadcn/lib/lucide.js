/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

/**
 * lucide-react, the icons the vendored shadcn components import — rendered
 * as <svg> intrinsics (the fork's svg module), with lucide's real path data
 * and the standard 24×24 stroke geometry.
 */

import * as React from 'react';

function icon(paths: Array<string>): (props: $FlowFixMe) => React.Node {
  return function LucideIcon(props: $FlowFixMe): React.Node {
    const {className, size, color = 'currentColor', ...rest} = props;
    // On the web, width/height are PRESENTATION ATTRIBUTES: any CSS class
    // outranks them, which is how `<Check className="h-4 w-4" />` renders a
    // 16px icon from a component whose default is 24. Here they are props
    // that the stylesheet cannot outrank, so a sized className must win by
    // the attributes standing aside — otherwise every shadcn icon draws at
    // 24px and spills out of the 16px control it labels.
    const sized = className != null && /(^|\s)(h|w|size)-/.test(className);
    const fallback = sized ? null : (size ?? 24);
    // lucide draws outlines; `fill-current` is how shadcn asks for a solid
    // glyph (the radio's dot). A class cannot reach the shape's paint from
    // here, so honour it where the class is stated.
    const filled = className != null && /(^|\s)fill-/.test(className);
    return (
      // $FlowFixMe[not-a-component] svg intrinsic
      <svg
        className={className}
        viewBox="0 0 24 24"
        width={fallback}
        height={fallback}
        fill={filled ? color : 'none'}
        stroke={filled ? 'none' : color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}>
        {paths.map((d, i) => (
          // $FlowFixMe[not-a-component] svg intrinsic
          <path key={i} d={d} />
        ))}
      </svg>
    );
  };
}

export const Check: (props: $FlowFixMe) => React.Node = icon([
  'M20 6 9 17l-5-5',
]);
export const ChevronDown: (props: $FlowFixMe) => React.Node = icon([
  'm6 9 6 6 6-6',
]);
export const ChevronRight: (props: $FlowFixMe) => React.Node = icon([
  'm9 18 6-6-6-6',
]);
export const ChevronUp: (props: $FlowFixMe) => React.Node = icon([
  'm18 15-6-6-6 6',
]);
export const Circle: (props: $FlowFixMe) => React.Node = icon([
  'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20z',
]);
export const X: (props: $FlowFixMe) => React.Node = icon([
  'M18 6 6 18',
  'm6 6 12 12',
]);
