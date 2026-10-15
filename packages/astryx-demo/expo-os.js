/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

// babel-preset-expo inlines `process.env.EXPO_OS` at build time; this app
// compiles with React Native's preset, and Expo Router reads the variable both
// at module load (a warning when it is missing) and at call time, so it is set
// here, in a module index.js imports before any Expo one. Imports are hoisted,
// so an assignment in index.js itself would run after Expo Router had loaded.
// Without it the router takes its non-iOS paths: no link previews, and an
// `asChild` link whose trigger never receives the press.
import {Platform} from 'react-native';

process.env.EXPO_OS = Platform.OS;
