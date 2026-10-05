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
 * `<menu>` is a list and marks its items.
 *
 * The HTML Standard renders `<menu>` exactly as `<ul>` — html.css groups them
 * for margins and the disc marker — but the native list recognition accepted
 * only `ul`/`ol`, so a menu's items rendered with no markers at all while
 * every stylesheet said `disc`. Pinned by width: an item's marker occupies
 * inline space, so a marked item's text starts to the right of an unmarked
 * box's.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {MixedElement} from 'react';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function textStartInside(
  render: (ref: {current: HostInstance | null}) => MixedElement,
): number {
  const root = Fantom.createRoot();
  const probe = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(render(probe));
  });
  return nullthrows(probe.current).getBoundingClientRect().left;
}

test('a menu item wears a marker exactly like a ul item', () => {
  const menuStart = textStartInside(ref => (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 400}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <menu>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={ref}>command</span>
        </li>
      </menu>
    </div>
  ));
  const ulStart = textStartInside(ref => (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 400}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <ul>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={ref}>command</span>
        </li>
      </ul>
    </div>
  ));
  expect(menuStart).toBe(ulStart);
});

test('the menu marker glyph is really generated', () => {
  // An `outside` marker hangs in the gutter and does not move the text, and
  // markers are layout-generated so the rendered-output tree cannot see them
  // either. `inside` positioning puts the marker IN the inline flow
  // (css-lists-3 §3.3), so its presence is a geometry fact: the item's text
  // starts a marker's width later than with `list-style-type: none`.
  const marked = textStartInside(ref => (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 400}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <menu style={{listStylePosition: 'inside'}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={ref}>command</span>
        </li>
      </menu>
    </div>
  ));
  const unmarked = textStartInside(ref => (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 400}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <menu style={{listStylePosition: 'inside', listStyleType: 'none'}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={ref}>command</span>
        </li>
      </menu>
    </div>
  ));
  expect(marked).toBeGreaterThan(unmarked);
});
