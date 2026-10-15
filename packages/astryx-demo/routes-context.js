/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

// Expo Router's `_ctx` module, written out by hand: babel-preset-expo would
// inline EXPO_ROUTER_APP_ROOT into `require.context`, but this app compiles
// with React Native's preset. Metro resolves `expo-router/_ctx*` here (see
// metro.config.js). The pattern is Expo Router's own, minus the `+api`,
// `+html` and `+middleware` files this app does not have.
export const ctx = require.context('./app', true, /\.[tj]sx?$/);
