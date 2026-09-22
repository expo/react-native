/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

import {useWindowDimensions} from 'react-native';

/**
 * The navigation bar's top scroll edge effect (iOS). Portrait asks for `soft`,
 * the fade under a large title, because iOS 27 defaults to a hard edge.
 * Landscape uses the system default: the bar is compact there, native Messages
 * has a hard edge under a compact bar, and a soft edge would fade out content
 * below the bar. See ui-metrics.md, "Compact bar scroll edge".
 */
const PORTRAIT = Object.freeze({top: 'soft'});
const LANDSCAPE = Object.freeze({top: 'automatic'});

/**
 * Always returns one of the two objects above: `edgeEffects` is a raw prop
 * parsed natively, so a new object each render would be parsed each render.
 */
export default function useHeaderEdgeEffects() {
  const {width, height} = useWindowDimensions();
  return width > height ? LANDSCAPE : PORTRAIT;
}
