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
 * The platform button chrome withdraws AS A UNIT when the author claims the
 * surface.
 *
 * The user-agent `<button>` entry carries the platform platter's metrics:
 * content insets, the minimum touch height, the label typography. A design
 * system that paints its own controls (shadcn's switch track, checkbox and
 * accordion trigger are all `<button>`) is authored against the web
 * preflight's naked button — so an author background or border must not
 * leave the platform insets standing underneath. A 16×16 checkbox that keeps
 * `paddingInline` is a pill; one that keeps `minHeight` is a slab.
 *
 * DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit), pinned here from the
 * layout side: geometry the author states is geometry the author gets.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function renderButton(style: {[string]: unknown}): HostInstance {
  const root = Fantom.createRoot();
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button ref={ref} type="button" style={{...style, alignSelf: 'flex-start'}} />
      </div>,
    );
  });
  return nullthrows(ref.current);
}

test('an author surface withdraws the chrome insets and minimum', () => {
  // A shadcn-style checkbox: 16×16, author-owned surface via background.
  const box = renderButton({
    backgroundColor: 'transparent',
    height: 16,
    width: 16,
  }).getBoundingClientRect();
  expect(box.width).toBe(16);
  expect(box.height).toBe(16);
});

test('a border claims the surface the same way a background does', () => {
  const box = renderButton({
    borderWidth: 1,
    borderColor: 'black',
    height: 16,
    width: 16,
  }).getBoundingClientRect();
  expect(box.width).toBe(16);
  expect(box.height).toBe(16);
});

test('an unstyled button keeps the platform metrics', () => {
  // The control: no author surface, so the platform floor holds (Material 48
  // in Fantom's android resolution) and the insets give it width beyond its
  // (empty) label.
  const plain = renderButton({}).getBoundingClientRect();
  expect(plain.height).toBe(48);
  expect(plain.width).toBeGreaterThan(0);
});

test('an author width alone does not strip the height floor', () => {
  // Claiming ONE axis is not claiming the surface: a width-constrained plain
  // button is still a platform button, so the touch floor stays.
  const sized = renderButton({width: 90}).getBoundingClientRect();
  expect(sized.width).toBe(90);
  expect(sized.height).toBe(48);
});
