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

/**
 * The checkedness of the checkbox and radio inputs (HTML §4.10.5.1.15–16),
 * which `CheckableInput` keeps and the DOM methods read: `input.checked`, and
 * `click()`, which fires a click whose activation behavior toggles it.
 */
const checkables: WeakMap<interface {}, () => boolean> = new WeakMap();

export function setCheckedness(
  instance: interface {},
  read: () => boolean,
): void {
  checkables.set(instance, read);
}

// The element's checkedness, or null for an element that has none
export function checkednessOf(instance: interface {}): ?boolean {
  const read = checkables.get(instance);
  return read != null ? read() : null;
}
