/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @noflow
 * @format
 */

/**
 * A replaced element is an ordinary flex item.
 *
 * css-flexbox-1 §4: a flex container blockifies its inline-level children, so
 * `<img>`s in a row honour `gap` and the container's `alignItems` exactly as
 * sized `<div>`s do. Two bugs hid here, found by measuring the sizing demo on
 * all three engines:
 *
 *  - the `InlineReplaced → inline run` branch fired in FLEX containers too, so
 *    Android's framework-backed `<img>`s fused into one text run — touching,
 *    baseline-bottom — while iOS (expo-image declares no trait) spaced them;
 *  - the shrink-to-fit `alignSelf: FlexStart` forcing applied to boxes with
 *    EXPLICIT sizes, where stretch can never happen, silently overriding
 *    `alignItems: 'flex-end'` on both platforms.
 *
 * The console noise is deliberate signal: the numbers are what the fix is
 * about.
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

test('flex-end aligns divs, imgs and inline-blocks alike', () => {
  const root = Fantom.createRoot();
  const a = createRef(); const b = createRef(); const c = createRef(); const d = createRef(); const e = createRef(); const f = createRef();
  Fantom.runTask(() => {
    root.render(
      <div style={{width: 360}}>
        <div style={{flexDirection: 'row', alignItems: 'flex-end', gap: 12, display: 'flex'}}>
          <div ref={a} style={{width: 32, height: 32}} />
          <div ref={b} style={{width: 64, height: 64}} />
        </div>
        <div style={{flexDirection: 'row', alignItems: 'flex-end', gap: 12, display: 'flex'}}>
          <img ref={c} src="https://e.com/a.png" style={{width: 32, height: 32}} />
          <img ref={d} src="https://e.com/a.png" style={{width: 64, height: 64}} />
        </div>
        <div style={{flexDirection: 'row', alignItems: 'flex-end', gap: 12, display: 'flex'}}>
          <div ref={e} style={{width: 32, height: 32, display: 'inline-block'}} />
          <div ref={f} style={{width: 64, height: 64, display: 'inline-block'}} />
        </div>
      </div>,
    );
  });
  const R = r => r.current.getBoundingClientRect();
  expect(R(a).bottom).toBe(R(b).bottom);
  expect(R(c).bottom).toBe(R(d).bottom);
  expect(R(e).bottom).toBe(R(f).bottom);
});
