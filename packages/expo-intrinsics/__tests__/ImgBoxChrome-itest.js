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
 * A replaced element paints its own box: `<img style={{backgroundColor,
 * padding}}>` shows the background as a ring through the padding, around the
 * picture (css-backgrounds-3 §2.2). A native image view's pixels fill its
 * bounds, so the element splits into CSS's own model — an element box wearing
 * the chrome, the image filling its content box. These tests pin the split:
 * the element's border box is unchanged by it, the composite only appears
 * when chrome demands it, and the inner image is inset by exactly the
 * padding.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const SRC = 'https://example.com/logo.png';

test("box chrome does not change the element's border box", () => {
  const root = Fantom.createRoot();
  const plain = createRef<HostInstance>();
  const chromed = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 200}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <img ref={plain} src={SRC} style={{width: 56, height: 56}} />
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <img
          ref={chromed}
          src={SRC}
          style={{
            width: 56,
            height: 56,
            padding: 6,
            borderRadius: 8,
            backgroundColor: '#ffd60a',
          }}
        />
      </div>,
    );
  });
  const plainRect = nullthrows(plain.current).getBoundingClientRect();
  const chromedRect = nullthrows(chromed.current).getBoundingClientRect();
  expect(chromedRect.width).toBe(plainRect.width);
  expect(chromedRect.height).toBe(plainRect.height);
});

test('chrome mounts the element box with the image inset by the padding', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <img
        src={SRC}
        style={{
          width: 56,
          height: 56,
          padding: 6,
          backgroundColor: '#ffd60a',
        }}
      />,
    );
  });
  const out = JSON.stringify(
    root.getRenderedOutput({includeLayoutMetrics: true}).toJSX(),
  );
  // The wrapper carries the chrome…
  expect(out).toContain('"backgroundColor":"rgba(255, 214, 10, 1)"');
  expect(out).toContain('"padding":"6"');
  // …and the image's MEASURED frame is the content box: inset by the padding
  // on every side. Pinning the frame — not the styles — is what catches a
  // sizing scheme the container ignores (flex-grow on a blockified child
  // measured 44x0: the ring painted, the picture vanished).
  expect(out).toContain('"layoutMetrics-frame":"{x:6,y:6,width:44,height:44}"');
  // As an ordinary Yoga child, not as an inline attachment — an attachment
  // placeholder ("\uFFFC" in a text run) would mean the image left Yoga's
  // layout and its sizes meant nothing.
  expect(out).not.toContain('\uFFFC');
});

test('a chrome-less img keeps the single-view fast path', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <img src={SRC} style={{width: 56, height: 56, margin: 4}} />,
    );
  });
  const out = JSON.stringify(root.getRenderedOutput().toJSX()) ?? '';
  // No wrapper: margin alone works identically on the single view.
  expect(out).not.toContain('"flexGrow":"1"');
});
