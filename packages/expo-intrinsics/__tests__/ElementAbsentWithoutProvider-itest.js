/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

/*
 * The control for ProviderSuppliedElement-itest.
 *
 * Neither the provider nor react-native's element catalog is imported, so
 * nothing has registered <span> and nothing has installed the
 * HTMLUnknownElement fallback. It must not resolve.
 *
 * Without this the positive test proves very little. A <span> is inline and
 * unstyled, which is exactly what the unknown fallback renders — so a <span>
 * that quietly fell back to it would be indistinguishable from one a provider
 * supplied, and every assertion over there would pass for the wrong reason.
 * This is also the test that fails if react-native ever starts shipping the
 * element again.
 */

test('react-native does not resolve <span> on its own', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{display: 'block'}}>
        {/* $FlowFixMe[prop-missing] deliberately unregistered here */}
        <span ref={ref}>nothing supplies this</span>
      </View>,
    );
  });

  // No registered component means no host instance, and nothing mounted for it.
  expect(ref.current).toBeNull();
});
