/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */

/**
 * `order` places a flex or grid item in its container's order-modified
 * document order (css-display-3 §3): ascending, equal values in document
 * order. A block container ignores it, as on the web.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {ViewStyleProp} from '../../../StyleSheet/StyleSheet';
import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rectOf(ref: {current: HostInstance | null}): {x: number, y: number} {
  const rect = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  return {x: rect.x, y: rect.y};
}

function renderItems(
  container: ViewStyleProp,
  orders: Array<number | void>,
): Array<{x: number, y: number}> {
  const refs = orders.map(() => createRef<HostInstance>());
  const root = Fantom.createRoot({viewportWidth: 400});
  Fantom.runTask(() => {
    root.render(
      <View style={container}>
        {orders.map((order, i) => (
          <View
            key={i}
            ref={refs[i]}
            style={{width: 100, height: 10 * (i + 1), order}}
          />
        ))}
      </View>,
    );
  });
  return refs.map(rectOf);
}

describe('order', () => {
  it('lays a flex column out by ascending order', () => {
    const [first, second, third] = renderItems(
      {display: 'flex', flexDirection: 'column'},
      [undefined, -1, undefined],
    );
    // The second (20 tall) comes first, then the first (10), then the third
    expect(second.y).toBe(0);
    expect(first.y).toBe(20);
    expect(third.y).toBe(30);
  });

  it('keeps document order among equal values', () => {
    const [first, second, third] = renderItems(
      {display: 'flex', flexDirection: 'row'},
      [1, 1, 0],
    );
    expect(third.x).toBe(0);
    expect(first.x).toBe(100);
    expect(second.x).toBe(200);
  });

  it('auto-places grid items in order', () => {
    const [first, second] = renderItems(
      {display: 'grid', gridTemplateColumns: '100px 100px'},
      [undefined, -1],
    );
    expect(second.x).toBe(0);
    expect(first.x).toBe(100);
  });

  it('does not reorder a block container', () => {
    const [first, second] = renderItems({display: 'block'}, [undefined, -1]);
    expect(first.y).toBe(0);
    expect(second.y).toBe(10);
  });
});
