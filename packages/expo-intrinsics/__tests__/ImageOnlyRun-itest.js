/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * A run made only of inline elements, with no text beside them, still flows.
 *
 * Read the passing result narrowly. These assert the *shared* layout, and the
 * shared layout is right — but iOS stacks such a run as blocks, and this suite
 * does not catch that, because Fantom's text layout is not CoreText. See
 * `__docs__/SpecDeviations.md`; that one has to be checked on a device.
 *
 * The tests are still worth having: they pin the behaviour every platform is
 * supposed to agree on, so a regression in the shared path fails here rather
 * than only on a screenshot.
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const SRC = {uri: 'https://reactnative.dev/img/tiny_logo.png'};
function rectOf(ref: {current: HostInstance | null}) {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('no render');
  }
  return r;
}

test('images with NO text between them still flow horizontally', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 400, fontSize: 16}}>
        <img ref={a} source={SRC} style={{width: 28, height: 28}} />
        <img ref={b} source={SRC} style={{width: 28, height: 28}} />
      </div>,
    );
  });
  const ra = rectOf(a);
  const rb = rectOf(b);
  console.log('NOTEXT a', JSON.stringify(ra), 'b', JSON.stringify(rb));
  expect(rb.x).toBeGreaterThan(ra.x);
  expect(rb.y).toBe(ra.y);
});

test('images WITH a space between them flow horizontally', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 400, fontSize: 16}}>
        <img ref={a} source={SRC} style={{width: 28, height: 28}} />{' '}
        <img ref={b} source={SRC} style={{width: 28, height: 28}} />
      </div>,
    );
  });
  const ra = rectOf(a);
  const rb = rectOf(b);
  console.log('SPACE a', JSON.stringify(ra), 'b', JSON.stringify(rb));
  expect(rb.x).toBeGreaterThan(ra.x);
  expect(rb.y).toBe(ra.y);
});
