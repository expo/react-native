/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * A `<p>`'s block-end margin separates it from what follows, nested inside
 * another block as much as at the top level; Safari leaves 16px between a
 * blockquote's paragraph and its `<footer>`. Measured as the gap between the
 * boxes, since the declaration is the sheet's and the effect is what matters.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * The containing block states a font size, so the paragraph's `em` has a known
 * base and this file needs no root: `p { margin-block: 1em }` resolves against
 * the paragraph's own computed size, which here is not the root's. Stating the
 * base also keeps the file off the platform's body size, which differs by
 * design (17 on iOS, 16 on Android).
 */
const FONT_SIZE = 20;

// `p { margin-block: 1em }`, and the footer has none of its own, so
// adjacent-sibling collapsing leaves max(1em, 0) = 1em = FONT_SIZE.
const EXPECTED_GAP = FONT_SIZE;

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

test('a paragraph inside a blockquote still pushes its sibling down', () => {
  const para = createRef<HostInstance>();
  const footer = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <blockquote style={{width: 300, fontSize: FONT_SIZE}}>
        {/* $FlowFixMe[prop-missing] */}
        <p ref={para}>A quotation.</p>
        {/* $FlowFixMe[prop-missing] */}
        <footer ref={footer}>— attribution</footer>
      </blockquote>,
    );
  });

  const p = rectOf(para);
  const f = rectOf(footer);
  const gap = f.y - (p.y + p.height);

  expect(gap).toBeCloseTo(EXPECTED_GAP, 0);
});

test('the same paragraph at the top level behaves identically', () => {
  /*
   * The control. If this one passes while the nested case fails, the margin is
   * being lost to the containing block rather than never applied — which is a
   * different bug in a different file, and the pair of results says which.
   */
  const para = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: FONT_SIZE}}>
        {/* $FlowFixMe[prop-missing] */}
        <p ref={para}>A paragraph.</p>
        {/* $FlowFixMe[prop-missing] */}
        <footer ref={after}>after</footer>
      </div>,
    );
  });

  const p = rectOf(para);
  const a = rectOf(after);
  expect(a.y - (p.y + p.height)).toBeCloseTo(EXPECTED_GAP, 0);
});

test('the gap follows the inherited font size', () => {
  /*
   * Move the size the paragraph inherits and the margin moves with it. A `rem`
   * or a fixed length would hold still through all three rows, so a single row
   * could not tell the three apart.
   */
  for (const size of [10, 20, 33]) {
    const para = createRef<HostInstance>();
    const after = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div style={{width: 300, fontSize: size}}>
          {/* $FlowFixMe[prop-missing] */}
          <p ref={para}>A paragraph.</p>
          {/* $FlowFixMe[prop-missing] */}
          <footer ref={after}>after</footer>
        </div>,
      );
    });

    const p = rectOf(para);
    const a = rectOf(after);
    expect(a.y - (p.y + p.height)).toBeCloseTo(size, 0);
  }
});
