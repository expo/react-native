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
 * `react` as the vendored Astryx sources see it: the same React, with
 * `createElement` routing an intrinsic element through the Astryx JSX runtime.
 *
 * The runtime (jsx-runtime.js) is where an element becomes what the renderer's
 * style engine styles, and Babel sends every JSX expression in the layer
 * through it. A component that builds
 * its element by hand instead — `Stack`, `StackItem`, `VisuallyHidden`,
 * `EmptyState`, for a polymorphic `as` prop — would otherwise hand the host
 * element raw props, and `<VStack style={{paddingInline: 'var(--spacing-6)'}}>`
 * rendered with no padding at all. Metro resolves `react` to this module for
 * the vendored sources and the templates (see each app's metro.config.js); the
 * module object is React's own, so hooks and context run on one React.
 *
 * Composite types pass straight through, as they do in the runtime.
 */

const runtime = require('./jsx-runtime');
const React = require('react');

function createElement(
  type: $FlowFixMe,
  props: ?{[string]: unknown},
  ...children: Array<unknown>
): React.Node {
  if (typeof type !== 'string') {
    return (React.createElement as $FlowFixMe)(type, props, ...children);
  }
  const {key, ...rest} = props ?? {};
  const withChildren =
    children.length === 0
      ? rest
      : children.length === 1
        ? {...rest, children: children[0]}
        : {...rest, children};
  return children.length > 1
    ? runtime.jsxs(type, withChildren, key)
    : runtime.jsx(type, withChildren, key);
}

module.exports = {...React, createElement};
