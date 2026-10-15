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
 * The elements `anchor-name` names (css-anchor-position-1 §2.1), for an
 * element positioned against one with `position-anchor`.
 *
 * Astryx names a layer's trigger imperatively, `trigger.style.anchorName =
 * '--astryx-layer-…'`, which `element.style` in dom-compat.js reports here. A
 * name taken by a second element is that element's, as the later one in tree
 * order wins on the web when a layer is opened from it.
 */
const elementsByName: Map<string, Object> = new Map();
const namesByElement: WeakMap<Object, ReadonlyArray<string>> = new WeakMap();

export function setAnchorNames(element: Object, value: string): void {
  for (const name of namesByElement.get(element) ?? []) {
    if (elementsByName.get(name) === element) {
      elementsByName.delete(name);
    }
  }
  const names = value
    .split(',')
    .map(name => name.trim())
    .filter(name => name.startsWith('--'));
  namesByElement.set(element, names);
  for (const name of names) {
    elementsByName.set(name, element);
  }
}

export function anchorElement(name: string): ?Object {
  return elementsByName.get(name.trim()) ?? null;
}
