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
 * A superscript's ink is RESERVED in its run's box.
 *
 * The keep-the-rhythm deviation shifts <sup> ink past the LINE box without
 * growing it; the ink still paints, and at the run's TOP edge it would escape
 * the box and draw over whatever sits above. The box grows by the shift-ink
 * extents (half the shifted fragment's font size per side), so the ink lands
 * inside the element's own box and the sibling above is never touched.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function heightOf(children: React.MixedElement): number {
  const root = Fantom.createRoot();
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 300}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div ref={ref}>{children}</div>
      </div>,
    );
  });
  return nullthrows(ref.current).getBoundingClientRect().height;
}

test('a run with a superscript reserves the shifted ink in its own box', () => {
  const plain = heightOf(<>{'x2 and nothing shifted'}</>);
  const shifted = heightOf(
    <>
      {'x'}
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <sup>2</sup>
      {' and a shifted run'}
    </>,
  );
  // The sup runs at the sheet's 0.8333em of the 16px root ≈ 13.3; the
  // reserve is half that ≈ 6.7 above (and nothing below for a sup).
  expect(shifted).toBeGreaterThan(plain + 5);
  expect(shifted).toBeLessThan(plain + 10);
});
