/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:false
 * @flow strict-local
 * @format
 */

/**
 * Baseline guards for string children.
 *
 * Runs WITHOUT enableStringChildren. Two jobs:
 * 1. Document the behavior for bare strings with the flag off: they are not
 *    rendered.
 * 2. Pin the back-compat exception: explicit <Text> rendering does not change,
 *    and a View's style does not reach the <Text> inside it.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

describe('text children: baseline (flag off)', () => {
  it('explicit <Text> in a View renders a paragraph (control anchor)', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false}>
          <Text>hello</Text>
        </View>,
      );
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>hello</rn-paragraph>
      </rn-view>,
    );
  });

  it('bare string children are not rendered', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<View collapsable={false}>hello</View>);
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(<rn-view />);
  });

  it('a View with only bare text has zero height', () => {
    const viewRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={viewRef}>
          hello
        </View>,
      );
    });

    const rect = ensureInstance(
      viewRef.current,
      ReactNativeElement,
    ).getBoundingClientRect();
    expect(rect.height).toBe(0);
  });

  it('explicit <Text> does NOT pick up text-ish keys from ancestor View styles', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // With the flag off, a View's `color` does not reach its text
        <View collapsable={false} style={{color: 'red'}}>
          <Text>hello</Text>
        </View>,
      );
    });

    expect(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ).toEqual(
      <rn-view>
        <rn-paragraph foregroundColor="rgba(0, 0, 0, 0)">hello</rn-paragraph>
      </rn-view>,
    );
  });
});
