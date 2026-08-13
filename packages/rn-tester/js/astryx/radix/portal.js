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
 * Portal — Radix's document-body portal over the fork's top layer.
 *
 * A Radix Portal renders its children into document.body; here they present
 * into the TopLayerHost mounted at the app root (overlay/TopLayer.js), which
 * is the fork's document level. `container` has no analog and is ignored;
 * the mode is 'manual' — dismissal belongs to DismissableLayer, not the
 * layer itself.
 */

import {useTopLayer} from '../overlay/TopLayer';
import * as React from 'react';

export function Portal({
  children,
  container: _container,
}: {
  children: React.Node,
  container?: unknown,
}): React.Node {
  const hosted = useTopLayer(true, 'manual', children);
  // Without a TopLayerHost (tests, screens outside the demo shell) the
  // children render in place — degraded stacking, correct content.
  return hosted ? null : children;
}
