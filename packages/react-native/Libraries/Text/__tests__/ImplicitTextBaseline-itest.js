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
 * Baseline guards for the implicit-text project (implicit-text-plan.md).
 *
 * Runs WITHOUT enableStringChildren. Two jobs:
 * 1. Document today's behavior for bare strings (silently dropped).
 * 2. Pin the back-compat exception: explicit <Text> rendering must never
 *    change. These assertions must stay green with and without the flag —
 *    the flagged twin lives in ImplicitText-itest.js (§compat).
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

describe('implicit text: baseline (flag off)', () => {
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

  it('bare string children are dropped silently today', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<View collapsable={false}>hello</View>);
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(<rn-view />);
  });

  it('a View with only bare text has zero height today', () => {
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
        // color is not a View style key today; apps have these inert keys in
        // the wild, which is exactly what this guard is about.
        // $FlowExpectedError[incompatible-type]
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
