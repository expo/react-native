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

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {TextInput} from 'react-native';

import '@react-native/expo-intrinsics-poc';

function width(ref: {current: HostInstance | null}): number {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return r.width;
}

// A field beside a send button takes the room the button leaves, whatever is
// typed into it: a text control is as wide as the user agent says, not as its
// value, so an unbreakable word does not push the button out of the row
test('a text field holding an unbreakable word keeps its share of the row', () => {
  const field = createRef<HostInstance>();
  const button = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 300, display: 'flex', flexDirection: 'row'}}>
        <TextInput
          ref={field}
          multiline={true}
          value={'I' + 'i'.repeat(66)}
          style={{flex: 1, padding: 0}}
        />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={button} style={{width: 38, height: 28}} />
      </div>,
    );
  });
  expect(width(field)).toBe(262);
  expect(width(button)).toBe(38);
});
