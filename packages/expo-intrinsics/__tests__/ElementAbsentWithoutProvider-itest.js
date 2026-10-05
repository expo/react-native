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
 * The control for ProviderSuppliedElement-itest: with neither the provider nor
 * the catalog imported, nothing has registered <span> and nothing has installed
 * the unknown-element fallback, so <span> must not resolve. A <span> that fell
 * back would be indistinguishable from one a provider supplied.
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

  // No registered component means no host instance
  expect(ref.current).toBeNull();
});
