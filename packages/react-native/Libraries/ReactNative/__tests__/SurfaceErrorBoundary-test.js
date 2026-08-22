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
 * That the boundary is actually mounted at the root of a surface.
 *
 * This exists because the obvious test does not work. Asserting the real
 * guarantee — that a render error is survivable — needs an environment where an
 * unguarded render error is fatal, and Fantom is not one: it swallows the throw
 * with or without a boundary, so a test written that way passes even with the
 * boundary removed from `AppContainer`.
 *
 * A component nobody renders protects nothing, so the wiring is what gets
 * pinned, structurally: `AppContainer` is asked what it renders and the
 * returned element tree is searched for the boundary. That fails the moment
 * someone deletes it or moves it out of the children's path — which is the
 * regression worth catching, since removing it is silent everywhere else.
 */

import * as React from 'react';

// The `-prod` container is a plain function, so it can be called directly and
// its output inspected. `-dev` is a hook-using component and cannot; the two
// are wired identically and the dev path additionally has LogBox showing the
// error, so this is the one worth pinning.
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
    // Placement is the whole point: a boundary that does not have the app's
    // tree beneath it catches nothing.
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
    // The app's own element is the boundary's child, not a sibling of it.
    expect(boundary?.props?.children).toBe(marker);
  });
});
