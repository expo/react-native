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

function box(ref: {current: HostInstance | null}): {
  width: number,
  height: number,
} {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return {width: r.width, height: r.height};
}

function paragraph(
  text: string,
  maxWidth: number,
): {width: number, height: number} {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 300, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <p ref={ref} style={{maxWidth, margin: 0}}>
          {text}
          {/* A block sibling keeps the text an anonymous run of its own rather than the paragraph's single content */}
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{height: 1}} />
        </p>
      </div>,
    );
  });
  return box(ref);
}

// A paragraph's text is the paragraph's own, not a flex item of it: the
// automatic minimum size (css-flexbox-1 §4.5) belongs to the paragraph in its
// row, capped by its `max-width`, and the run inside wraps at the width the
// paragraph gives it, an unbreakable word included
test('a run wraps at its paragraph width rather than standing at its longest word', () => {
  const oneLine = paragraph('Ii', 120);
  const longWord = paragraph('I' + 'i'.repeat(39), 120);
  expect(longWord.width).toBe(120);
  expect(longWord.height).toBeGreaterThan(oneLine.height);
});
