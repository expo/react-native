/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * Astryx's Stepper portals the current step's label into an empty row it
 * owns under the track (`createPortal(label, summarySlot)`). The shim draws
 * portaled content in the element it lands in, after that element's own
 * children; a popover stays where it was declared, since the top layer lifts
 * it out anyway and it needs the React context it reads there.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import {createPortal} from '../react-dom-shim';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function Stepper({labelRef}: {labelRef: {current: $FlowFixMe}}): React.Node {
  const [slot, setSlot] = React.useState<$FlowFixMe>(null);
  return jsx('div', {
    style: {width: 300},
    children: [
      jsx(
        'ol',
        {
          style: {height: 10, margin: 0, padding: 0},
          children: jsx('li', {
            children:
              slot == null
                ? null
                : createPortal(
                    jsx('span', {ref: labelRef, children: 'Cart'}),
                    slot,
                  ),
          }),
        },
        'list',
      ),
      jsx(
        'div',
        {ref: setSlot, 'data-slot': 'summary', style: {height: 30}},
        'slot',
      ),
    ],
  });
}

describe('createPortal', () => {
  it('draws the content in the element it is portaled into', () => {
    const labelRef = React.createRef<$FlowFixMe>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(jsx(Stepper, {labelRef}) as $FlowFixMe);
    });
    const label = labelRef.current;
    expect(label).not.toBeNull();
    expect(label?.parentElement?.getAttribute('data-slot')).toBe('summary');
    // Under the 10-point list, in the slot
    expect(label?.getBoundingClientRect().y).toBe(10);
  });

  it('keeps a popover where it was declared', () => {
    const slotRef = React.createRef<$FlowFixMe>();
    const popover = jsx('div', {popover: 'auto', children: 'Menu'});
    const root = Fantom.createRoot();
    let portaled: unknown = null;
    Fantom.runTask(() => {
      root.render(jsx('div', {ref: slotRef}) as $FlowFixMe);
    });
    portaled = createPortal(popover, slotRef.current);
    expect(portaled).toBe(popover);
  });
});
