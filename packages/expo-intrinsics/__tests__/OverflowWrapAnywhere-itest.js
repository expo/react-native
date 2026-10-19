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

function width(ref: {current: HostInstance | null}): number {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return r.width;
}

// A paragraph beside a fixed box in a row of 300: its automatic minimum is its
// text's min-content size (css-flexbox-1 §4.5), which `overflow-wrap`
// decides (css-text-3 §5.5): the longest word by default, the widest
// grapheme under `anywhere`. The deterministic measurer is 10 points a glyph.
function paragraphBesideABox(overflowWrap: ?string): number {
  const paragraph = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 300, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <p
          ref={paragraph}
          style={{
            margin: 0,
            flexShrink: 1,
            ...(overflowWrap != null ? {overflowWrap} : null),
          }}>
          {'I' + 'i'.repeat(25)}
        </p>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 100, height: 10, flexShrink: 0}} />
      </div>,
    );
  });
  return width(paragraph);
}

test('an unbreakable word holds a paragraph at its width by default', () => {
  expect(paragraphBesideABox(null)).toBe(260);
});

test('overflow-wrap: anywhere lets the paragraph shrink to the room it has', () => {
  expect(paragraphBesideABox('anywhere')).toBe(200);
});

test('overflow-wrap: break-word keeps the longest word as the minimum', () => {
  expect(paragraphBesideABox('break-word')).toBe(260);
});
