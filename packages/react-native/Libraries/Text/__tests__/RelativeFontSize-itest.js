/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

/*
 * `em` is a multiple of the INHERITED font size (css-values-4 5.1.1). Only
 * `rem` is relative to the root.
 *
 * The size is read through the baseline-shift reserve rather than measured
 * directly: the reserve is `fontSize / 2` for a shifted fragment, and it is
 * the one font-size-derived number this renderer exposes to a test. Fantom's
 * text advance is a fixed width per character, so glyph widths say nothing
 * about the resolved size.
 */
function resolvedSupFontSize(base: number): number {
  const root = Fantom.createRoot({viewportWidth: 400, viewportHeight: 300});
  const ref = createRef<unknown>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[incompatible-type] intrinsic + new style keys
      <div ref={ref} style={{width: 400, fontSize: base, lineHeight: 20}}>
        {'x'}
        {/* $FlowFixMe[incompatible-type] */}
        <sup>2</sup>
      </div>,
    );
  });
  // $FlowFixMe[incompatible-use]
  const height = ref.current.getBoundingClientRect().height;
  root.destroy();
  // height = lineHeight + reserve, reserve = supFontSize / 2
  return (height - 20) * 2;
}

describe('a font size in em', () => {
  it('resolves against the inherited size, not the root', () => {
    // The user-agent sheet gives <sup> `font-size: 0.8333em`.
    expect(resolvedSupFontSize(16)).toBeCloseTo(0.8333 * 16, 1);
    expect(resolvedSupFontSize(40)).toBeCloseTo(0.8333 * 40, 1);
  });

  it('scales with its parent rather than staying constant', () => {
    // The bug this pins: `em` implemented as `rem` gave the same absolute
    // size whatever the element inherited.
    expect(resolvedSupFontSize(40)).toBeGreaterThan(resolvedSupFontSize(16));
  });
});
