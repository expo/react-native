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
 * The handles `<native:toplayer>` renders where a popover is written. A
 * handle is the renderer's, not the document's: the popover drawn from it is
 * its parent's child in the DOM, so dom-compat.js passes over handles when it
 * answers `parentNode`, `parentElement`, `childNodes` and `children`.
 */
const handles: WeakSet<Object> = new WeakSet();

export function registerTopLayerHandle(instance: Object): void {
  handles.add(instance);
}

export function isTopLayerHandle(node: unknown): boolean {
  return node != null && typeof node === 'object' && handles.has(node);
}
