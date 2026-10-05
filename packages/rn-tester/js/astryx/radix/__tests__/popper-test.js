/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import {PopperAnchor, PopperContent, PopperRoot} from '../popper';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

/*
 * An anchor inside a ScrollView moves with no notification: React Native
 * broadcasts no scroll or resize event a floating box could subscribe to. So
 * the content has to keep asking where its anchor is for as long as it is
 * open — measuring only at open leaves a menu stranded exactly the scroll
 * distance away from its trigger, which is the bug this pins.
 */

// react-test-renderer hands out null for host refs unless the test supplies
// the node itself, so every host node answers measureInWindow from a rect the
// test controls.
let currentRect = {x: 10, y: 20, width: 30, height: 40};
let measureCount = 0;

const createNodeMock = () => ({
  measureInWindow: (callback: (number, number, number, number) => void) => {
    measureCount++;
    callback(
      currentRect.x,
      currentRect.y,
      currentRect.width,
      currentRect.height,
    );
  },
});

let frames: Array<() => void> = [];
const realRAF = global.requestAnimationFrame;
const realCAF = global.cancelAnimationFrame;

beforeEach(() => {
  measureCount = 0;
  frames = [];
  currentRect = {x: 10, y: 20, width: 30, height: 40};
  // $FlowFixMe[cannot-write] test double
  global.requestAnimationFrame = (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  };
  // $FlowFixMe[cannot-write] test double
  global.cancelAnimationFrame = (id: number) => {
    frames[id - 1] = () => {};
  };
});

afterEach(() => {
  // $FlowFixMe[cannot-write]
  global.requestAnimationFrame = realRAF;
  // $FlowFixMe[cannot-write]
  global.cancelAnimationFrame = realCAF;
});

function pumpFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const pending = frames;
    frames = [];
    TestRenderer.act(() => {
      for (const frame of pending) {
        frame();
      }
    });
  }
}

function render(content: React.Node): $FlowFixMe {
  let renderer: $FlowFixMe;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <PopperRoot>
        <PopperAnchor>anchor</PopperAnchor>
        {content}
      </PopperRoot>,
      {createNodeMock},
    );
  });
  return renderer;
}

test('an open popper keeps re-measuring its anchor', () => {
  render(<PopperContent>content</PopperContent>);
  const atOpen = measureCount;
  expect(atOpen).toBeGreaterThan(0);

  pumpFrames(3);
  // Still open, so it is still asking.
  expect(measureCount).toBeGreaterThan(atOpen);
});

test('a closed popper stops measuring', () => {
  const renderer = render(<PopperContent>content</PopperContent>);
  pumpFrames(2);
  const whileOpen = measureCount;

  TestRenderer.act(() => {
    renderer.update(
      <PopperRoot>
        <PopperAnchor>anchor</PopperAnchor>
      </PopperRoot>,
    );
  });
  pumpFrames(3);

  // The loop was cancelled with the content, so nothing new was measured.
  expect(measureCount).toBe(whileOpen);
});

test('updatePositionStrategy="optimized" measures only at open', () => {
  render(
    <PopperContent updatePositionStrategy="optimized">content</PopperContent>,
  );
  const atOpen = measureCount;
  pumpFrames(3);
  expect(measureCount).toBe(atOpen);
});
