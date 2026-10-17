/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../../document-shim';
import '../../dom-compat';

import {PopperAnchor, PopperContent, PopperRoot} from '../popper';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

/*
 * An anchor inside a ScrollView moves with no notification: React Native
 * broadcasts no scroll or resize event a floating box could subscribe to. So
 * the content has to keep asking where its anchor is for as long as it is
 * open — measuring only at open leaves a menu stranded exactly the scroll
 * distance away from its trigger, which is the bug this pins.
 */

let measureCount = 0;
const countedNodes: WeakSet<interface {}> = new WeakSet();

// Counts the anchor's measureInWindow calls; installed from the anchor's ref,
// which is set before the content's effects measure at open
function countMeasures(node: $FlowFixMe): void {
  if (node == null || countedNodes.has(node)) {
    return;
  }
  countedNodes.add(node);
  const measureInWindow = node.measureInWindow;
  node.measureInWindow = (...args: Array<$FlowFixMe>) => {
    measureCount++;
    return measureInWindow.apply(node, args);
  };
}

let frames: Array<() => void> = [];
const realRAF = global.requestAnimationFrame;
const realCAF = global.cancelAnimationFrame;

beforeEach(() => {
  measureCount = 0;
  frames = [];
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

function pumpFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const pending = frames;
    frames = [];
    Fantom.runTask(() => {
      for (const frame of pending) {
        frame();
      }
    });
  }
}

function render(content: React.Node): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <PopperRoot>
        <PopperAnchor ref={countMeasures}>anchor</PopperAnchor>
        {content}
      </PopperRoot>,
    );
  });
  return root;
}

test('an open popper keeps re-measuring its anchor', () => {
  render(<PopperContent>content</PopperContent>);
  const atOpen = measureCount;
  expect(atOpen).toBeGreaterThan(0);

  pumpFrames(3);
  // Still open, so it is still asking
  expect(measureCount).toBeGreaterThan(atOpen);
});

test('a closed popper stops measuring', () => {
  const root = render(<PopperContent>content</PopperContent>);
  pumpFrames(2);
  const whileOpen = measureCount;

  Fantom.runTask(() => {
    root.render(
      <PopperRoot>
        <PopperAnchor ref={countMeasures}>anchor</PopperAnchor>
      </PopperRoot>,
    );
  });
  pumpFrames(3);

  // The loop was cancelled with the content, so nothing new was measured
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
