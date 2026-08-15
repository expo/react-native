/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * An item naming a grid area that does not exist (css-grid-2 §8.3). Every
 * implicit line is taken to carry the name, so the item is placed against the
 * first implicit line after the explicit grid in each axis: it lands in a new
 * track outside the grid, after an empty implicit track, rather than flowing
 * into the grid. The expected values were measured in Chrome.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rectOf(ref: {current: HostInstance | null}): {
  x: number,
  y: number,
  width: number,
  height: number,
} {
  const rect = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

describe('an unknown grid area name', () => {
  it('places the item in a new track outside the explicit grid', () => {
    const container = createRef<HostInstance>();
    const named = createRef<HostInstance>();
    const unknown = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={container}
          /* $FlowExpectedError[incompatible-type] grid style keys */
          style={{
            display: 'grid',
            width: 600,
            gridTemplateColumns: '80px 80px',
            gridTemplateRows: '40px',
            gap: 10,
            gridTemplateAreas: '"a b"',
            alignItems: 'flex-start',
            justifyItems: 'flex-start',
          }}>
          <View
            collapsable={false}
            ref={named}
            /* $FlowExpectedError[incompatible-type] grid style keys */
            style={{gridArea: 'b', width: 80, height: 30}}
          />
          <View
            collapsable={false}
            ref={unknown}
            /* $FlowExpectedError[incompatible-type] grid style keys */
            style={{gridArea: 'missing', width: 50, height: 20}}
          />
        </View>,
      );
    });
    const origin = rectOf(container);
    const namedRect = rectOf(named);
    const unknownRect = rectOf(unknown);
    expect(origin.height).toBe(80);
    expect(namedRect.x - origin.x).toBe(90);
    expect(namedRect.y - origin.y).toBe(0);
    expect(unknownRect.x - origin.x).toBe(370);
    expect(unknownRect.y - origin.y).toBe(60);
  });
});
