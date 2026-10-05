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
 * `<ol start>` is an HTML attribute, and ONLY an attribute.
 *
 * The name collides with Yoga's inline-start inset: forwarded verbatim,
 * `<ol start={98}>` seeded the counter and ALSO shifted the entire list 98px
 * to the right — the demo's "98, 99, 100" items rendered indented a third of
 * the way across the screen. The component translates the attribute to a
 * private native name (`listStart`, List.js) the way `<img>` translates
 * `src`, and this pins the geometry half: a started list's content sits
 * exactly where an unstarted one's does.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

test('a started list is not displaced by its start value', () => {
  const root = Fantom.createRoot();
  const one = createRef<HostInstance>();
  const ninetyEight = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ol>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={one}>First</span>
          </li>
        </ol>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <ol start={98}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <li>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={ninetyEight}>Starts at ninety-eight</span>
          </li>
        </ol>
      </div>,
    );
  });
  const first = nullthrows(one.current).getBoundingClientRect();
  const started = nullthrows(ninetyEight.current).getBoundingClientRect();
  // Both sit at the list's 40px gutter; the start value must not leak into
  // geometry.
  expect(first.left).toBe(40);
  expect(started.left).toBe(first.left);
});
