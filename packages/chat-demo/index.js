/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

// Before App, and for its side effects: this is where the elements register
// their view configs, and a host element whose config has not been registered
// yet fails at render with "View config getter callback ... must be a function".
import '../expo-intrinsics/src/index';

import App from './App';
import {AppRegistry, LogBox} from 'react-native';

/*
 * The toast only, not the logging: warnings still reach the console and logcat.
 *
 * LogBox's "Open debugger to view warnings" container reaches from y=2008 to the
 * bottom of a 2400-tall window — far above the visible toast — and swallows every
 * tap in it. This app's controls live in exactly that band, because a bar that
 * rides the keyboard has to. Two separate tap-driven checks here read as "the
 * button does nothing" when the button was fine and the toast was on top of it.
 */
LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent('ChatDemo', () => App);
