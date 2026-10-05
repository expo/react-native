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
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/**
 * An inline box establishes no formatting context (CSS2 §9.4.2): an <img>
 * inside <a> — or three inline elements deep — sits on the paragraph's line
 * with its advance displacing the text around it. On iOS the expo-image
 * backing declares neither InlineReplaced nor an inline display, so the
 * placement gate must take a reported placement as its own proof of
 * attachment-ness rather than discard the frame the text layout computed.
 */
test('an anchor-nested img displaces the text before it', () => {
  const root = Fantom.createRoot();
  const img = createRef<HostInstance>();
  const deep = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] */}
        <div>
          Visit {/* $FlowFixMe[prop-missing] */}
          <a href="https://reactnative.dev">
            {/* $FlowFixMe[prop-missing] */}
            <img
              ref={img}
              src="https://x/l.png"
              style={{width: 20, height: 20}}
            />{' '}
            reactnative.dev
          </a>{' '}
          for docs. Deep: {/* $FlowFixMe[prop-missing] */}
          <span>
            {/* $FlowFixMe[prop-missing] */}
            <b>
              {/* $FlowFixMe[prop-missing] */}
              <em>
                {/* $FlowFixMe[prop-missing] */}
                <img
                  ref={deep}
                  src="https://x/l.png"
                  style={{width: 20, height: 20}}
                />
              </em>
            </b>
          </span>
        </div>
      </div>,
    );
  });
  const a = nullthrows(img.current).getBoundingClientRect();
  const b = nullthrows(deep.current).getBoundingClientRect();
  // After "Visit " — never over it.
  expect(a.left).toBeGreaterThan(25);
  // The deep-nested image is placed too, on a real line of the paragraph.
  expect(b.width).toBe(20);
  expect(b.left).toBeGreaterThan(0);
});
