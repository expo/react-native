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

function height(ref: {current: HostInstance | null}): number {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return r.height;
}

// Forty words of one glyph in a 100-point box: the deterministic measurer is
// 10 points a glyph, so a wrapping paragraph is eight lines of "a a a a a".
const words = Array(40).fill('a').join(' ');

function paragraphHeight(style: {
  lineClamp?: number,
  overflow?: 'hidden',
  textOverflow?: 'ellipsis',
}): number {
  const paragraph = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 100}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <p ref={paragraph} style={{margin: 0, lineHeight: 20, ...style}}>
          {words}
        </p>
      </div>,
    );
  });
  return height(paragraph);
}

test('a wrapping paragraph is as tall as its lines', () => {
  expect(paragraphHeight({})).toBe(160);
});

test('line-clamp keeps that many lines (css-overflow-4 §5)', () => {
  expect(paragraphHeight({lineClamp: 2})).toBe(40);
});

test('line-clamp is not inherited: a nested block keeps its own lines', () => {
  const inner = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 100, lineClamp: 2}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <p ref={inner} style={{margin: 0, lineHeight: 20}}>
          {words}
        </p>
      </div>,
    );
  });
  expect(height(inner)).toBe(160);
});

test('text-overflow leaves a wrapping paragraph alone', () => {
  expect(paragraphHeight({overflow: 'hidden', textOverflow: 'ellipsis'})).toBe(
    160,
  );
});
