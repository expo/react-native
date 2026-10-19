/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type Cell = {
  readonly width?: number,
  readonly gridRowStart?: number,
  readonly gridColumnStart?: number,
  readonly gridColumnEnd?: number,
};

// A shrinking flex item stops at its min-content size (css-flexbox-1 §4.5),
// which a container finds by its own layout, whatever its `flex-direction`:
// for a grid container the sum of its tracks sized under a min-content
// constraint (css-grid-2 §12.3), for a block container its widest child.
// Squeezed by a 180-point sibling in a row of 200; Safari measures the same.
function squeezed(
  style: {readonly [string]: string | number},
  cells: ReadonlyArray<Cell>,
): number {
  const item = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 200, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={item} style={style}>
          {cells.map((cell, index) => (
            // $FlowExpectedError[prop-missing] intrinsic
            <div key={index} style={{width: 50, height: 10, ...cell}} />
          ))}
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 180, height: 10, flexShrink: 0}} />
      </div>,
    );
  });
  return item.current?.getBoundingClientRect().width ?? -1;
}

test('items sharing a cell count once', () => {
  const cell = {gridRowStart: 1, gridColumnStart: 1};
  expect(
    squeezed({display: 'grid', flexDirection: 'row'}, [
      cell,
      {...cell, width: 60},
    ]),
  ).toBe(60);
});

test('items in one column are as wide as the widest', () => {
  expect(squeezed({display: 'grid', flexDirection: 'row'}, [{}, {}])).toBe(50);
});

test('columns add up with the gaps between them', () => {
  expect(
    squeezed(
      {display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 10},
      [{}, {}],
    ),
  ).toBe(110);
});

test('a column with a zero minimum shrinks to the space left', () => {
  expect(
    squeezed({display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)'}, [{}]),
  ).toBe(20);
});

test('a fixed column counts its length', () => {
  expect(
    squeezed({display: 'grid', gridTemplateColumns: '30px auto'}, [{}, {}]),
  ).toBe(80);
});

test('an item spanning two columns widens them only by what they lack', () => {
  expect(
    squeezed({display: 'grid', gridTemplateColumns: 'auto auto'}, [
      {width: 20},
      {width: 20},
      {gridColumnStart: 1, gridColumnEnd: 3, width: 70},
    ]),
  ).toBe(70);
});

test('equal fractions keep their own minimums', () => {
  expect(
    squeezed({display: 'grid', gridTemplateColumns: '1fr 1fr'}, [
      {},
      {width: 30},
    ]),
  ).toBe(80);
});

test('a block container is as wide as its widest child', () => {
  expect(
    squeezed({display: 'block', flexDirection: 'row'}, [{}, {width: 60}]),
  ).toBe(60);
});
