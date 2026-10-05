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

import '@react-native/expo-intrinsics-poc';

// A `<template>` is not rendered (HTML §15.3.1), so it is not a flex item:
// `space-between` over a 50-point box and a 20-point box in a row of 300 puts
// the second at 280 however many templates sit between and after them.
test('a template takes no share of justify-content', () => {
  const end = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div
        style={{
          width: 300,
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 50, height: 10}} />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <template />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={end} style={{width: 20, height: 10}} />
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <template />
      </div>,
    );
  });
  expect(end.current?.getBoundingClientRect().x).toBe(280);
});
