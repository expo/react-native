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
 * @radix-ui/react-slot.
 *
 * `<Slot {...props}>{child}</Slot>` renders the CHILD with the slot's props
 * merged in — the mechanism behind every `asChild`. Slottable marks which
 * child receives them when a component renders siblings around it.
 */

import {composeRefs, mergeSlotProps} from './internals';
import * as React from 'react';

const SLOTTABLE: symbol = Symbol('radix.slottable');

export function Slottable({children}: {children: React.Node}): React.Node {
  return children;
}
// $FlowFixMe[prop-missing] marker for Slot's child scan
Slottable.__radixSlottable = SLOTTABLE;

function isSlottable(child: React.Node): boolean {
  if (!React.isValidElement(child)) {
    return false;
  }
  const type = (child as $FlowFixMe).type;
  return (
    typeof type === 'function' &&
    (type as $FlowFixMe).__radixSlottable === SLOTTABLE
  );
}

export function Slot({
  children,
  ...slotProps
}: {
  children?: React.Node,
  [string]: $FlowFixMe,
}): React.Node {
  const childArray = React.Children.toArray(children);
  const slottable = childArray.find(isSlottable);

  if (slottable != null) {
    // Merge into the slottable's own single child; render the rest as-is.
    const target = (slottable as $FlowFixMe).props.children;
    const newChildren = childArray.map(child => {
      if (child !== slottable) {
        return child;
      }
      if (React.Children.count(target) > 1) {
        return React.Children.only(null);
      }
      return React.isValidElement(target)
        ? (target as $FlowFixMe).props.children
        : null;
    });
    if (!React.isValidElement(target)) {
      return null;
    }
    return React.cloneElement(
      target as $FlowFixMe,
      mergeSlotPropsWithRef(slotProps, target as $FlowFixMe),
      ...newChildren,
    );
  }

  const only = childArray.length === 1 ? childArray[0] : null;
  if (only == null || !React.isValidElement(only)) {
    return null;
  }
  return React.cloneElement(
    only as $FlowFixMe,
    mergeSlotPropsWithRef(slotProps, only as $FlowFixMe),
  );
}

function mergeSlotPropsWithRef(
  slotProps: {[string]: $FlowFixMe},
  child: $FlowFixMe,
): {[string]: $FlowFixMe} {
  const merged = mergeSlotProps(slotProps, child.props);
  const slotRef = slotProps.ref;
  const childRef = child.ref ?? child.props.ref;
  if (slotRef != null || childRef != null) {
    merged.ref = composeRefs(slotRef, childRef);
  }
  return merged;
}

export default {Slot, Slottable};
