/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/**
 * Gives the elements' instances back `addEventListener`, `removeEventListener`
 * and `dispatchEvent`.
 *
 * React Native's DOM nodes are event targets (`ReadOnlyNode` extends
 * `EventTarget` under `enableNativeEventTargetEventDispatching`, on by
 * default) and native events are dispatched to them, but `ReactNativeElement`
 * shadows the three public methods with `undefined` on its own prototype at
 * module load unless imperative events are enabled, the API not being final
 * upstream. The vendored Astryx sources subscribe to their elements that way
 * at sixty-odd sites (`el.addEventListener('scroll', …)` in
 * `useScrollOverflow`, for one). Removing the shadows restores the inherited
 * methods; it needs no feature-flag override, which React Native accepts only
 * before any flag has been read.
 */
const prototype: {[string]: unknown} =
  ReactNativeElement.prototype as $FlowFixMe;
for (const method of [
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
]) {
  const own = Object.getOwnPropertyDescriptor(prototype, method);
  if (own != null && own.value === undefined) {
    delete prototype[method];
  }
}
