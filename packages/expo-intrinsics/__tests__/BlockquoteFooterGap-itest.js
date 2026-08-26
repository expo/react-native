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
 * A `<p>`'s block-end margin has to separate it from what follows it.
 *
 * Found by putting the demo's own markup in front of real Safari: the browser
 * leaves 16px between a blockquote's paragraph and its `<footer>`, and the
 * device left none — the attribution sat directly on the last line of the
 * quote. `p { margin-block: 1em }` is in the user-agent sheet, so the
 * declaration is not missing; what is in question is whether it survives to
 * layout when the `<p>` is nested inside another block.
 *
 * This matters beyond the one demo, because it is the general shape of prose:
 * a paragraph followed by anything is the most common block pair in HTML, and a
 * bottom margin that is dropped when the paragraph happens to be inside a
 * container would take the rhythm out of every nested article and section while
 * still looking fine in the flat case anyone would test first.
 *
 * Measured as the gap between the boxes rather than as a style value, because
 * the style is known to be correct — it is the *effect* that was missing.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * The containing block states a font size, so the paragraph's `em` has a known
 * base and this file needs no root at all.
 *
 * It used to expect a literal 16 — Safari's figure at a 16px root. That was
 * only ever right by coincidence: `p { margin-block: 1em }` resolves against
 * the paragraph's OWN computed size, and while the sheet was sending the root's
 * size instead, the two agreed for a paragraph that inherited nothing. They
 * stop agreeing here, which is the point. Stating the base also keeps the file
 * off the platform's body size, which differs by design — 17 on iOS, 16 on
 * Android — and would fail on iOS for the one reason that is not a bug.
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
   * `em`, stated as the thing that distinguishes it from every other unit: move
   * the size the paragraph inherits and the margin moves with it, in step.
   *
   * A `rem` — which is what the sheet used to send — would hold still through
   * all three rows, and a fixed length would too. Only one gap value can be
   * right for all of them, so a single row could not tell the three apart.
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
