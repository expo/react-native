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
 * An element's stated min/max dimensions hold in INLINE flow.
 *
 * `LayoutableShadowNode::measure` lays an atomic inline out as a measurement
 * root, and the root's min/max come from the CONSTRAINTS, not from the node's
 * own style — so the bare `{0,0}` minimum the attachment paths passed erased
 * every element-stated minimum. Found as "the Disabled/Enabled buttons are
 * too short": `<button>`'s user-agent `minHeight` is the platform's minimum
 * touch target (HIG 44 / Material 48), and the one pair of buttons the forms
 * demo lays out in a real inline flow measured 20pt shorter than every
 * blockified button around them.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function heights(): {block: number, inline: number} {
  const root = Fantom.createRoot();
  const block = createRef<HostInstance>();
  const inline = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button
          ref={block}
          type="button"
          style={{display: 'block', alignSelf: 'flex-start'}}>
          Block
        </button>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <button ref={inline} type="button">
            Inline
          </button>{' '}
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <button type="button">Second</button>
        </div>
      </div>,
    );
  });
  return {
    block: nullthrows(block.current).getBoundingClientRect().height,
    inline: nullthrows(inline.current).getBoundingClientRect().height,
  };
}

test("a button's touch-target floor holds in inline flow", () => {
  const {block, inline} = heights();
  // The floor itself (Material 48 — Fantom resolves the android table), and
  // agreement between the two layout paths for the SAME element.
  expect(block).toBe(48);
  expect(inline).toBe(block);
});

test('an author max caps an atomic inline the same way', () => {
  const root = Fantom.createRoot();
  const capped = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <div
            ref={capped}
            style={{
              display: 'inline-block',
              width: 100,
              maxWidth: 40,
              height: 10,
            }}
          />{' '}
          after
        </div>
      </div>,
    );
  });
  // width 100 capped by the element's own maxWidth — CSS2 §10.4 applies in
  // inline flow exactly as it does anywhere else.
  expect(nullthrows(capped.current).getBoundingClientRect().width).toBe(40);
});
