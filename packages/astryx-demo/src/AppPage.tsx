/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import AstryxHost from './AstryxHost';
import * as React from 'react';

/**
 * One of the app's own pages (the grid, Modifications): a scroll view with
 * the system's background, which the content scrolls under the glass bar in,
 * holding an Astryx surface that ends where the content ends. The page runs
 * to the screen's bottom edge and keeps its own last row clear of the home
 * indicator, as a web page with `viewport-fit=cover` does; the scroll view
 * reserves nothing at the bottom.
 */
export default function AppPage({
  children,
}: {
  children: React.Node;
}): React.Node {
  return (
    <native:scroll edgeEffects={EDGE_EFFECTS} automaticInsets={TOP_AND_SIDES}>
      <AstryxHost fill={false}>
        <div style={pageStyle}>{children}</div>
      </AstryxHost>
    </native:scroll>
  );
}

const pageStyle = {
  padding: 16,
  paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
};

const TOP_AND_SIDES = {top: true, bottom: false, left: true, right: true};

// The fade under the glass bar, and none at the bottom: with no bar there, the
// platform's automatic bottom effect only blurred the content under the home
// indicator
const EDGE_EFFECTS = {top: 'soft', bottom: 'hidden'};
