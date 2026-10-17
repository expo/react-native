/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx, jsxs} from '../jsx-runtime';
import {ChatTokenizedText} from '../vendor/Chat/ChatTokenizedText';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

for (const fontSize of [16, 24]) {
  it(`aligns a mention label with the surrounding text baseline at ${fontSize} points`, () => {
    const root = Fantom.createRoot();
    const innerBaseline = React.createRef<$FlowFixMe>();
    const reference = React.createRef<$FlowFixMe>();
    Fantom.runTask(() =>
      root.render(
        jsxs('div', {
          style: {width: 600, fontSize, lineHeight: `${fontSize * 1.5}px`},
          children: [
            <ChatTokenizedText
              tokens={[
                {
                  value: '@Agent',
                  label: jsxs('span', {
                    children: [
                      'Hg',
                      jsx('span', {
                        ref: innerBaseline,
                        style: {
                          display: 'inline-block',
                          width: 1,
                          height: 1,
                          verticalAlign: 'baseline',
                        },
                      }),
                    ],
                  }),
                },
              ]}>
              {'@Agent after '}
            </ChatTokenizedText>,
            jsx('span', {
              ref: reference,
              style: {
                display: 'inline-block',
                width: 1,
                height: 1,
                verticalAlign: 'baseline',
              },
            }),
          ],
        }) as $FlowFixMe,
      ),
    );
    const label = innerBaseline.current.getBoundingClientRect();
    const surrounding = reference.current.getBoundingClientRect();
    // The bottom of an empty baseline-aligned box marks the text baseline. Use
    // separate font sizes and line heights; the label is a clipped flex item.
    expect(label.bottom).toBeCloseTo(surrounding.bottom, 4);
  });
}
