/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

/**
 * Stands in for Astryx's `utils/pressFeedback.ts` (Metro and Jest resolve
 * that module here; see metro.config.js and jest.config.js), with the same
 * exports.
 *
 * Upstream, `installPressFeedback` puts six listeners on `window` and
 * `document` and writes `data-astryx-press` onto the nearest pressable
 * surface, which the components' CSS reads instead of `:active` under a
 * coarse pointer. There is no document-wide pointer stream here: pointer
 * events reach the element that is pressed (see `useInteractionState`), and
 * the catalog's own controls draw their press natively.
 *
 * DOM-CSS-LIMITATION(astryx-press-controller-inert): the controller installs
 * nothing, so `data-astryx-press` is never written and the press arm of
 * `interactionOverlay.stylex.ts` does not fire; a vendored component that
 * relies on it alone shows no touch press. Feeding the attribute from the
 * element's pointer state is the follow-up.
 */

export const PRESSABLE_ATTRIBUTE = 'data-astryx-pressable';
export const PRESSED_ATTRIBUTE = 'data-astryx-press';
export const pressableProps: {readonly [PRESSABLE_ATTRIBUTE]: ''} = {
  [PRESSABLE_ATTRIBUTE]: '',
};
export const PRESS_GESTURE_MEMORY_MS = 3000;

export function installPressFeedback(): () => void {
  return () => {};
}
