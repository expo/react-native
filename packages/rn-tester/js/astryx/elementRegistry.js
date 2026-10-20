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

import type {ElementDescriptor} from './css';

/**
 * What the element runtime knows about a mounted intrinsic element, kept by
 * host instance for the DOM methods in `dom-compat.js`: the descriptor the
 * DOM shim's selector matching uses (tag, classes, attributes, ancestor
 * chain), the props as authored, and the style the renderer's style engine
 * resolved it to.
 */
export type ElementRecord = {
  descriptor: ElementDescriptor,
  props: {readonly [string]: unknown},
  style: unknown,
  // What `setAttribute` and `removeAttribute` wrote, by lowercased name, over
  // the authored props
  overrides: Map<string, ScriptAttribute>,
  // A popover's shown state, and how `showPopover()` changes it
  popoverOpen: boolean,
  setPopoverOpen: (open: boolean) => void,
  // A dialog's state: shown in the top layer, shown in place, or closed
  dialogMode: ?('modal' | 'non-modal'),
  setDialogMode: (mode: ?('modal' | 'non-modal')) => void,
  returnValue: string,
  // Styled by the renderer's style engine, which answers what it matches
  engine?: boolean,
  // Changed by a DOM method (a popover shown, a dialog closed) since the
  // element rendered, so the engine's committed tree does not have the change
  // yet; the record, made anew each render, does
  uncommitted?: boolean,
  // Sets what is portaled into the element (react-dom-shim's `createPortal`)
  setPortals?: (
    update: (
      previous: ?ReadonlyMap<string, React.Node>,
    ) => ?ReadonlyMap<string, React.Node>,
  ) => void,
  // The platform scroll view a scroll container lays its content out in, whose
  // offsets and sizes are the element's `scrollTop`, `scrollHeight` and kin
  scrollView?: ?Object,
};

// An attribute as script wrote it (null for one it removed), and the value
// React gave the attribute then, which React writing anew takes back
export type ScriptAttribute = {
  readonly value: string | null,
  readonly reactValue: string | null,
};

/** A holder the runtime updates every render, so readers see the latest. */
export type ElementRecordHolder = {current: ElementRecord};

const records: WeakMap<Object, ElementRecordHolder> = new WeakMap();

const registrationObservers: Array<(instance: Object) => void> = [];

/**
 * Calls `observer` with each element as it registers, which is how dom-compat
 * learns of the renderer's documents (an element's `ownerDocument`).
 */
export function observeRegistrations(
  observer: (instance: Object) => void,
): void {
  registrationObservers.push(observer);
}

export function registerElement(
  instance: Object,
  holder: ElementRecordHolder,
): void {
  records.set(instance, holder);
  for (const observer of registrationObservers) {
    observer(instance);
  }
}

export function unregisterElement(instance: Object): void {
  records.delete(instance);
}

// The record of an element no component registered: one the renderer's
// style engine styles as a bare host node, read from its props
let recordFallback: ?(instance: Object) => ElementRecord | null = null;

export function setRecordFallback(
  fallback: (instance: Object) => ElementRecord | null,
): void {
  recordFallback = fallback;
}

export function recordOf(instance: unknown): ElementRecord | null {
  if (instance == null || typeof instance !== 'object') {
    return null;
  }
  return records.get(instance)?.current ?? recordFallback?.(instance) ?? null;
}
