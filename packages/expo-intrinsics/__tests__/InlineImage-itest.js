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
 * `<img>` is an inline replaced element.
 *
 * That is the whole claim, and it is the one thing about the element that can
 * regress silently: an `<img>` that has lost its `InlineReplaced` trait still
 * draws the right picture at the right size, and only the *line* is wrong — the
 * text before it and the text after it end up on separate lines, which reads as
 * a styling problem rather than a broken element.
 *
 * So these assert position rather than existence. Two runs of text with an
 * image between them share a line when the image is inline; they do not when it
 * is a block.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const SRC = {uri: 'https://reactnative.dev/img/tiny_logo.png'};

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

test('<img> shares a line with the text around it', () => {
  const before = createRef<HostInstance>();
  const image = createRef<HostInstance>();
  const after = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <span ref={before}>before</span>
        <img ref={image} source={SRC} style={{width: 24, height: 24}} />
        <span ref={after}>after</span>
      </div>,
    );
  });

  const beforeRect = rectOf(before);
  const imageRect = rectOf(image);
  const afterRect = rectOf(after);

  // The image starts after the first run ends, on the same line rather than
  // below it. A block-level image would start at x = 0 on a line of its own.
  expect(imageRect.x).toBeGreaterThanOrEqual(beforeRect.x + beforeRect.width);
  // And the trailing run continues after the image, not beneath it.
  expect(afterRect.x).toBeGreaterThanOrEqual(imageRect.x + imageRect.width);

  // All three overlap vertically, which is what "one line" means. Comparing
  // spans rather than exact tops, because a 24pt image and a 16pt run sit on a
  // shared baseline at different offsets — the boxes overlap, they do not align.
  const lineTop = Math.max(beforeRect.y, imageRect.y, afterRect.y);
  const lineBottom = Math.min(
    beforeRect.y + beforeRect.height,
    imageRect.y + imageRect.height,
    afterRect.y + afterRect.height,
  );
  expect(lineBottom).toBeGreaterThan(lineTop);
});

test('<img> does not stretch to the width of its container', () => {
  const image = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <img ref={image} source={SRC} style={{width: 24, height: 24}} />
      </div>,
    );
  });

  // A block child fills its containing block; a replaced element takes its own
  // size. This is the cheapest signal that the element is not block-level.
  expect(rectOf(image).width).toBe(24);
});

test('the line grows to fit a tall <img>', () => {
  const short = createRef<HostInstance>();
  const tall = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400}}>
        <div ref={short} style={{fontSize: 16}}>
          <span>text</span>
          <img source={SRC} style={{width: 8, height: 8}} />
        </div>
        <div ref={tall} style={{fontSize: 16}}>
          <span>text</span>
          <img source={SRC} style={{width: 64, height: 64}} />
        </div>
      </div>,
    );
  });

  // An inline replaced element participates in the line box, so a taller image
  // makes a taller line. If it were drawn without joining the line, both
  // paragraphs would be the same height.
  expect(rectOf(tall).height).toBeGreaterThan(rectOf(short).height);
});

test('several differently-sized <img> in one run are placed in order', () => {
  const small = createRef<HostInstance>();
  const medium = createRef<HostInstance>();
  const large = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 400, fontSize: 16}}>
        <span>small</span>
        <img ref={small} source={SRC} style={{width: 16, height: 16}} />
        <span> medium </span>
        <img ref={medium} source={SRC} style={{width: 32, height: 32}} />
        <span> large </span>
        <img ref={large} source={SRC} style={{width: 56, height: 56}} />
      </div>,
    );
  });

  const s = rectOf(small);
  const m = rectOf(medium);
  const l = rectOf(large);

  // Each image keeps its own size...
  expect(s.width).toBe(16);
  expect(m.width).toBe(32);
  expect(l.width).toBe(56);

  // ...and, all three being on one line, each sits to the right of the one
  // before it. A mismatch between an attachment and its placement shows up
  // exactly here: the sizes stay right while the positions swap.
  expect(m.x).toBeGreaterThan(s.x);
  expect(l.x).toBeGreaterThan(m.x);
});
