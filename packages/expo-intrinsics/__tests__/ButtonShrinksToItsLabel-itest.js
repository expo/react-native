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

function box(ref: {current: HostInstance | null}): {x: number, width: number} {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return {x: r.x, width: r.width};
}

// A table header's sort button is `width: 100%` beside a 12-point filter
// button in an inline-flex row; a button is a flex item like any other and
// yields the filter's room, instead of pushing it out of the cell
test('a 100%-wide button yields room to the fixed item beside it', () => {
  const button = createRef<HostInstance>();
  const icon = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 261, display: 'block'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{display: 'inline-flex', minWidth: 0, gap: 4}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <button ref={button} style={{display: 'flex', width: '100%'}}>
            {'Description'}
          </button>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div ref={icon} style={{width: 12, height: 12, flexShrink: 0}} />
        </div>
      </div>,
    );
  });
  expect(box(button).width).toBe(245);
  expect(box(icon).x).toBe(249);
});

// The floor is the content: css-flexbox-1 §4.5's automatic minimum size,
// which Yoga computes once its legacy errata is off, so a row too tight for the
// button keeps what is in the button whole
test('a button in a row too tight for it stops at its content', () => {
  const squeezed = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 40, display: 'flex'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <button ref={squeezed} style={{padding: 0}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 90, height: 10}} />
        </button>
      </div>,
    );
  });
  expect(box(squeezed).width).toBe(90);
});
