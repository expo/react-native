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

export type ScrollSafeArea = Readonly<{left: number, right: number}>;

/**
 * Space outside a document's safe column that an edge-to-edge horizontal
 * scroller may draw into. The native scroll view reserves it with content
 * insets, keeping its content layout and both resting edges inside the column.
 * A sidebar is a separate document and must not be included here.
 */
const ScrollSafeAreaContext: React.Context<ScrollSafeArea> =
  React.createContext({left: 0, right: 0});

export default ScrollSafeAreaContext;
