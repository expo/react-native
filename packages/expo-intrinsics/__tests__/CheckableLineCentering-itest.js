/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * A checkable inside a wrapped label centres on its line.
 *
 * DOM-CSS-DEVIATION(checkable-line-centering): the user-agent sheet gives
 * `<input type="checkbox">` and `type="radio"` `vertical-align: middle`, not
 * CSS's initial `baseline`. The control's box is the PLATFORM's — a 48dp
 * Material touch target, a 28pt switch — and baseline-aligning that box put
 * the visible control a control-height away from the words it labels, which
 * read on device as "checkbox on one line, text on the next". Material rows
 * and iOS Settings rows centre the control against the label line.
 *
 * Each label gets its own block: labels are inline, so two in one flow share
 * a LINE BOX, and the line is the union of everything on it — the first
 * version of this test put both variants on one line and measured each
 * against a line the other had stretched.
 *
 * The numbers are the deterministic measurer's, derived in place from the
 * engine's own constants (20pt line, x-height 20 * 0.5 = 10 — see
 * kDeterministicXHeightRatio) and Fantom's Android-shaped 48x48 checkable
 * footprint. The strut's descent is read back from the geometry rather than
 * restated.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

test('the UA centres a checkable on its label line; an author baseline still wins', () => {
  const root = Fantom.createRoot();
  const uaLabel = createRef<HostInstance>();
  const uaInput = createRef<HostInstance>();
  const authorLabel = createRef<HostInstance>();
  const authorInput = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 400}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <label ref={uaLabel}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <input ref={uaInput} type="checkbox" />
            {' Subscribe'}
          </label>
        </div>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <label ref={authorLabel}>
            {/* The author restores CSS's initial value; the sheet yields. */}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <input
              ref={authorInput}
              type="checkbox"
              style={{verticalAlign: 'baseline'}}
            />
            {' Subscribe'}
          </label>
        </div>
      </div>,
    );
  });

  const uaLabelRect = nullthrows(uaLabel.current).getBoundingClientRect();
  const uaInputRect = nullthrows(uaInput.current).getBoundingClientRect();
  const authorLabelRect = nullthrows(
    authorLabel.current,
  ).getBoundingClientRect();
  const authorInputRect = nullthrows(
    authorInput.current,
  ).getBoundingClientRect();

  /*
   * `middle` (CSS2 §10.8.1): the box centres on the baseline raised by half
   * the x-height. The box spans baseline-29 … baseline+19, so the line's
   * ascent grows to 29 and its descent to 19: a 48pt line the box exactly
   * fills. The label is precisely as tall as the control, nothing pokes out,
   * and the text's own centre (baseline - 10) is 5pt above the box centre —
   * the same relation Safari draws for `vertical-align: middle`.
   */
  expect(uaLabelRect.height).toBe(48);
  expect(uaInputRect.top - uaLabelRect.top).toBe(0);
  expect(uaInputRect.bottom - uaLabelRect.bottom).toBe(0);

  /*
   * `baseline`: the box's own baseline — its bottom edge, for a box with no
   * line boxes inside — sits ON the text baseline, so the text's descent
   * hangs below the control (measured: 4.6pt with the deterministic strut)
   * and the line is control + descent tall. This is what CSS does to a 48pt
   * box and exactly the geometry that looked broken on device, kept here as
   * proof the author can still ask for it. The descent is read back rather
   * than restated so the assertion is about the RELATION — box bottom on the
   * baseline, descent below — not about the strut's private ratio.
   */
  const descent = authorLabelRect.bottom - authorInputRect.bottom;
  expect(descent).toBeGreaterThan(0);
  expect(authorInputRect.top - authorLabelRect.top).toBe(0);
  expect(authorLabelRect.height).toBe(48 + descent);
});
