/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * Defines `process.env.EXPO_OS`, which `babel-preset-expo` normally inlines at
 * build time. The tester transforms with React Native's own preset instead, so
 * nothing defines it and expo-modules-core's `Platform` module warns on import:
 *
 *   The global process.env.EXPO_OS is not defined. This should be inlined by
 *   babel-preset-expo during transformation.
 *
 * It is not only a warning: Expo's `Platform.select` reads the same value and
 * returns `undefined` for every branch without it.
 *
 * This must be imported *first* by the entry point. expo-modules-core reads the
 * value while its `Platform` module is being evaluated, so setting it from
 * anything that Expo code has already pulled in would be too late.
 */

import {Platform} from 'react-native';

if (process.env.EXPO_OS == null) {
  process.env.EXPO_OS = Platform.OS;
}
