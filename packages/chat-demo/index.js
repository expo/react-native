/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

// Must come before App: it registers the elements' view configs. Rendering an
// element before its config is registered fails with "View config getter
// callback ... must be a function".
import '../expo-intrinsics/src/index';

import App from './App';
import {AppRegistry, LogBox} from 'react-native';

/*
 * Hides LogBox's warning toast; warnings still go to the console and logcat.
 * The toast's container is much taller than the visible toast and blocks taps
 * on the buttons at the bottom of the screen. See ui-metrics.md, "LogBox toast
 * hit area".
 */
LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent('ChatDemo', () => App);
