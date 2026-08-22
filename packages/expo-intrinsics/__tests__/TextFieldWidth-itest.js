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
 * A text field's width is intrinsic, not declared.
 *
 * `<input>` is about twenty characters wide by default, and that is the size
 * it wants, not a `width` it states: in a column flex container it stretches
 * across the column like any other item, and in a block container or a row it
 * keeps its own width. An author's `width` still wins over both.
 */

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

const CONTAINER_WIDTH = 370;

function inputWidthIn(element: React.MixedElement): number {
  const root = Fantom.createRoot({
    viewportWidth: CONTAINER_WIDTH,
    viewportHeight: 800,
  });
  Fantom.runTask(() => {
    root.render(element);
  });
  const rendered = JSON.stringify(
    root
      .getRenderedOutput({
        props: ['layoutMetrics-frame'],
        includeLayoutMetrics: true,
      })
      .toJSON(),
  );
  const match = rendered.match(
    /"element-text-input","props":\{"layoutMetrics-frame":"\{x:[\d.]+,y:[\d.]+,width:([\d.]+)/,
  );
  if (match == null) {
    throw new Error('no text field in ' + rendered);
  }
  return Number(match[1]);
}

test('a text field stretches across a column flex container', () => {
  expect(
    inputWidthIn(
      // $FlowExpectedError[not-a-component] intrinsic element
      <div style={{display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[not-a-component] intrinsic element */}
        <input defaultValue="kept when the action throws" />
      </div>,
    ),
  ).toBe(CONTAINER_WIDTH);
});

test('in a block container and in a row it keeps its intrinsic width', () => {
  const inBlock = inputWidthIn(
    // $FlowExpectedError[not-a-component] intrinsic element
    <div>
      {/* $FlowExpectedError[not-a-component] intrinsic element */}
      <input defaultValue="b" />
    </div>,
  );
  const inRow = inputWidthIn(
    // $FlowExpectedError[not-a-component] intrinsic element
    <div style={{display: 'flex', flexDirection: 'row'}}>
      {/* $FlowExpectedError[not-a-component] intrinsic element */}
      <input defaultValue="c" />
    </div>,
  );
  expect(inBlock).toBeGreaterThan(0);
  expect(inBlock).toBeLessThan(CONTAINER_WIDTH);
  expect(inRow).toBe(inBlock);
});

test("an author's width wins", () => {
  expect(
    inputWidthIn(
      // $FlowExpectedError[not-a-component] intrinsic element
      <div style={{display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[not-a-component] intrinsic element */}
        <input defaultValue="a" style={{width: 120}} />
      </div>,
    ),
  ).toBe(120);
});
