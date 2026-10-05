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
 * A list inside a list has no block margins of its own.
 *
 * html.css, in every browser: `ul ul, ol ul, ul ol, ol ol { margin-block: 0 }`
 * — the outer list's rhythm already separates the group, and without the reset
 * a nested list floats a full 1em away from the item that introduces it, which
 * is exactly how the lists demo read on both platforms while the browser
 * column sat tight. Implemented as context in List.js because nesting is the
 * one thing a per-tag stylesheet row cannot see.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function itemHeightWithNestedStyle(nestedStyle: unknown): number {
  const root = Fantom.createRoot();
  const item = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 400}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ul>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li ref={item}>
            {'introduces:'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <ul style={nestedStyle}>
              {/* $FlowFixMe[prop-missing] intrinsic */}
              <li>inner</li>
            </ul>
          </li>
        </ul>
      </div>,
    );
  });
  return nullthrows(item.current).getBoundingClientRect().height;
}

/*
 * One relation proves both halves: the DEFAULT nested list contributes no
 * block margin to its item (the html.css reset), and an author's own margin
 * still adds exactly what it states (the reset merges below the author).
 * Stated as a height DIFFERENCE so the assertion owes nothing to line
 * heights, padding or the collapse-through of a last child's bottom margin —
 * a top margin against the preceding text line cannot collapse away.
 */
test('the nested reset is the default, and an author margin still adds', () => {
  const defaultHeight = itemHeightWithNestedStyle(undefined);
  const authored = itemHeightWithNestedStyle({marginBlockStart: 17});
  expect(authored - defaultHeight).toBe(17);
});

test('a nested list ends flush with its item — no bottom margin below it', () => {
  const root = Fantom.createRoot();
  const item = createRef<HostInstance>();
  const nested = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 400}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ul>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li ref={item}>
            {'introduces:'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <ul ref={nested}>
              {/* $FlowFixMe[prop-missing] intrinsic */}
              <li>inner</li>
            </ul>
          </li>
        </ul>
      </div>,
    );
  });
  const itemRect = nullthrows(item.current).getBoundingClientRect();
  const nestedRect = nullthrows(nested.current).getBoundingClientRect();
  expect(nestedRect.bottom).toBe(itemRect.bottom);
});

test('a top-level list keeps its user-agent margins', () => {
  const root = Fantom.createRoot();
  const first = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 400}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ul ref={first}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li>a</li>
        </ul>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ul ref={second}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li>b</li>
        </ul>
      </div>,
    );
  });
  const firstRect = nullthrows(first.current).getBoundingClientRect();
  const secondRect = nullthrows(second.current).getBoundingClientRect();
  // Two sibling top-level lists: separated by ONE collapsed 1em margin (the
  // block container collapses them), which is emphatically not zero.
  expect(secondRect.top).toBeGreaterThan(firstRect.bottom);
});
