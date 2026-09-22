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
 * The scroll edge effect under the navigation bar, which is not the same thing
 * on a phone lying down.
 *
 * `soft` is the progressive fade that lets a large title and the content under
 * it share an edge. iOS 27 changed the bar's default from soft to hard, so a
 * screen that wants the fade has to say so — but a bar that has gone COMPACT
 * has no large title, and there is nothing for a fade to belong to.
 *
 * The platform's own chat agrees. Sampled down a column through a balloon
 * sitting behind its bar on an 874-point screen, the reading is flat and then
 * steps:
 *
 *     y 0..75   (180, 240, 255)   a uniform band
 *     y 78      (83, 194, 250)    the balloon, at full strength
 *
 * A fade ramps; that does not. Ours ramped, and the ramp carried on past the
 * bar's own bottom edge, washing out the sender name below it.
 *
 * So landscape gives the choice back to the platform rather than asserting a
 * different one — `automatic` is the effect the bar would have had if this app
 * had never asked.
 */
const PORTRAIT = Object.freeze({top: 'soft'});
const LANDSCAPE = Object.freeze({top: 'automatic'});

/**
 * Stated as two frozen objects rather than built per call: the value crosses to
 * the renderer as a raw prop and is parsed there, and a fresh object every
 * render is a fresh parse of a decision that changes twice a day at most.
 */
export default function useHeaderEdgeEffects() {
  const {width, height} = useWindowDimensions();
  return width > height ? LANDSCAPE : PORTRAIT;
}
