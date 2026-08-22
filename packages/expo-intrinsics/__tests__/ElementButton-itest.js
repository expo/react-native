/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @oncall react_native
 */

/**
 * `<button>`'s move onto its own native component.
 *
 * The behaviour that matters — press state from a real gesture recognizer, and a
 * scroll cancelling a press — is native and is verified on device; none of it is
 * observable from here. What these tests protect is the part that silently
 * regresses: that `<button>` still resolves to a *box*, still reports its own
 * tag, and still accepts the props it grew, so that swapping its backing
 * component out from under it does not change what it is.
 *
 * The failure this is really guarding against: if the element stopped resolving
 * to a box it would fall back to the inline text backing, where padding has
 * nowhere to apply — a styling bug that looks like a CSS mistake rather than a
 * registration one.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function rectOf(ref: {current: HostInstance | null}) {
  const instance = ref.current;
  if (instance == null) {
    throw new Error('expected the element to be mounted');
  }
  return instance.getBoundingClientRect();
}

test('<button> reports its own tag', () => {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();

  Fantom.runTask(() => {
    // $FlowFixMe[prop-missing] intrinsic
    root.render(<button ref={button}>Save</button>);
  });

  // Not `RN:element-button`: the element must identify as the tag the author
  // wrote, whichever component ends up backing it.
  // $FlowFixMe[incompatible-use] nodeName is on the host instance
  expect(button.current?.nodeName).toBe('RN:button');
});

test('<button> generates a box, so padding applies', () => {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 300}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button
          ref={button}
          style={{paddingHorizontal: 20, paddingVertical: 10}}>
          Save
        </button>
      </div>,
    );
  });

  const rect = rectOf(button);
  // Its UA `display: inline-block` makes it a box: it is shrink-to-fit rather
  // than filling the 300pt line, and its padding contributes to its size. On
  // the inline text backing neither would be true.
  expect(rect.width).toBeGreaterThan(40);
  expect(rect.width).toBeLessThan(300);
  expect(rect.height).toBeGreaterThan(20);
});

test('<button disabled> still lays out', () => {
  const root = Fantom.createRoot();
  const enabled = createRef<HostInstance>();
  const disabled = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 300}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button ref={enabled} style={{padding: 10}}>
          Save
        </button>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button ref={disabled} disabled={true} style={{padding: 10}}>
          Save
        </button>
      </div>,
    );
  });

  // `disabled` changes interaction, never layout — identical strings so the two
  // are genuinely comparable. Within float noise, not exactly: the Material
  // label tracking (`letterSpacing: 0.1`) is not binary-representable, and the
  // two boxes measure their text under different layout constraints, which
  // surfaces a two-ULP disagreement (~7e-6px) that exact equality reads as a
  // layout change. Seven MICRO-pixels is measurement jitter, not layout.
  expect(rectOf(disabled).width).toBeCloseTo(rectOf(enabled).width, 3);
  expect(rectOf(disabled).height).toBeCloseTo(rectOf(enabled).height, 3);
});

test('a <button> whose display is block fills its container', () => {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 300}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button ref={button} style={{display: 'block'}}>
          Save
        </button>
      </div>,
    );
  });

  // An author display still decides the box, exactly as for any other element:
  // the interactive backing is not a display of its own.
  expect(rectOf(button).width).toBe(300);
});
