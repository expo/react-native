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
 * The shared internals of the Radix shim layer.
 *
 * These modules implement the PUBLIC API of @radix-ui/react-* packages over
 * the fork's own machinery (top layer, anchor positioning, focus trap,
 * stylesheet engine) — Metro aliases the package ids here, so vendored
 * shadcn component sources import Radix and get these. Only the surface
 * shadcn actually uses is implemented; that is the contract, not Radix's
 * whole feature matrix.
 *
 * Radix communicates ALL state to styling as data attributes
 * (`data-state="open"`, `data-disabled`); the stylesheet engine matches
 * them, so a shim's job is state machines and attributes, never styles.
 */

import * as React from 'react';

/**
 * `useControllableState` — Radix's controlled/uncontrolled dance, verbatim
 * semantics: controlled when `prop` is defined, else internal state seeded
 * by `defaultProp`; `onChange` fires for every user-driven change.
 */
export function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop?: T | void,
  defaultProp: T,
  onChange?: (value: T) => void,
}): [T, ((T => T) | T) => void] {
  const [internal, setInternal] = React.useState<T>(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? (prop as $FlowFixMe) : internal;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = React.useCallback(
    (next: (T => T) | T) => {
      const resolve = (base: T): T =>
        typeof next === 'function' ? (next as $FlowFixMe)(base) : next;
      if (isControlled) {
        const resolved = resolve(prop as $FlowFixMe);
        if (resolved !== prop) {
          onChangeRef.current?.(resolved);
        }
      } else {
        setInternal(base => {
          const resolved = resolve(base);
          if (resolved !== base) {
            onChangeRef.current?.(resolved);
          }
          return resolved;
        });
      }
    },
    [isControlled, prop],
  );

  return [value, setValue];
}

export function composeRefs<T>(
  ...refs: Array<?(React.Ref<$FlowFixMe> | ((T | null) => unknown))>
): (T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (ref == null) {
        continue;
      }
      if (typeof ref === 'function') {
        ref(node);
      } else if (typeof ref === 'object') {
        (ref as $FlowFixMe).current = node;
      }
    }
  };
}

/**
 * Compose two event handlers: theirs first; ours skipped when they called
 * preventDefault (Radix's composeEventHandlers contract).
 */
export function composeEventHandlers<E extends {defaultPrevented?: boolean}>(
  theirs: ?(event: E) => unknown,
  ours: ?(event: E) => unknown,
): (event: E) => void {
  return (event: E) => {
    theirs?.(event);
    if (event == null || event.defaultPrevented !== true) {
      ours?.(event);
    }
  };
}

/**
 * The open/closed data attribute every Radix part carries.
 */
export function dataState(open: boolean): string {
  return open ? 'open' : 'closed';
}

/**
 * Merge props onto a child element for `asChild` (Slot semantics): child
 * props win one-by-one, className concatenates, style merges child-last,
 * handlers compose slot-then-child? — Radix runs the SLOT's handler after
 * the child's own; both run.
 */
export function mergeSlotProps(
  slotProps: {[string]: $FlowFixMe},
  childProps: {[string]: $FlowFixMe},
): {[string]: $FlowFixMe} {
  const merged: {[string]: $FlowFixMe} = {...slotProps, ...childProps};
  for (const name of Object.keys(slotProps)) {
    const slotValue = slotProps[name];
    const childValue = childProps[name];
    if (/^on[A-Z]/.test(name)) {
      if (typeof slotValue === 'function' && typeof childValue === 'function') {
        merged[name] = (...args: Array<$FlowFixMe>) => {
          childValue(...args);
          slotValue(...args);
        };
      } else {
        merged[name] = childValue ?? slotValue;
      }
    } else if (name === 'style') {
      if (slotValue != null && childValue != null) {
        merged.style = {...slotValue, ...childValue};
      }
    } else if (name === 'className') {
      if (
        typeof slotValue === 'string' &&
        typeof childValue === 'string' &&
        slotValue !== '' &&
        childValue !== ''
      ) {
        merged.className = slotValue + ' ' + childValue;
      }
    }
  }
  return merged;
}
