/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * That the boundary is mounted at the root of a surface. Fantom swallows an
 * unguarded render throw, so the real guarantee cannot be asserted there; the
 * wiring is pinned structurally instead, by searching what `AppContainer`
 * renders for the boundary.
 */

import * as React from 'react';

// The `-prod` container is a plain function, so it can be called directly and
// its output inspected; `-dev` uses hooks and is wired identically
const AppContainerProd = require('../AppContainer-prod').default;
const SurfaceErrorBoundary = require('../SurfaceErrorBoundary').default;

function findInTree(
  node: unknown,
  predicate: (element: $FlowFixMe) => boolean,
): boolean {
  if (node == null || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child: unknown) => findInTree(child, predicate));
  }
  const element: $FlowFixMe = node;
  if (element.type != null && predicate(element)) {
    return true;
  }
  return findInTree(element.props?.children, predicate);
}

describe('AppContainer wiring', () => {
  test('renders the children inside a SurfaceErrorBoundary', () => {
    const marker = <div key="app" />;
    const tree = AppContainerProd({rootTag: 1, children: marker});

    expect(
      findInTree(tree, element => element.type === SurfaceErrorBoundary),
    ).toBe(true);
  });

  test('the app itself is inside the boundary, not beside it', () => {
    // A boundary that does not have the app's tree beneath it catches nothing
    const marker = <div key="app" />;
    const tree = AppContainerProd({rootTag: 1, children: marker});

    let boundary: $FlowFixMe = null;
    findInTree(tree, element => {
      if (element.type === SurfaceErrorBoundary) {
        boundary = element;
        return true;
      }
      return false;
    });

    expect(boundary).not.toBe(null);
    // The app's own element is the boundary's child, not a sibling of it
    expect(boundary?.props?.children).toBe(marker);
  });
});
