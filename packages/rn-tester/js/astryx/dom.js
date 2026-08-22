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
 * DOM elements for Astryx.
 *
 * This used to register <p> and <button> as view-config aliases of <div>,
 * because the fork's intrinsics stopped at <div>/<span>/<b>/<i>/<u>/<img>.
 * Both are intrinsics from the element catalog now, so the aliases are
 * gone — registering them here as well is a duplicate registration, and the
 * runtime rejects it outright ("tried to register two views with the same
 * name p").
 *
 * Core's versions are also better than the aliases were: <button> is inline
 * rather than a block container, which is what the web does, and both report
 * their own `tagName` instead of "div".
 *
 * Kept as the seam for anything Astryx needs that core does not yet provide.
 */

import '@react-native/expo-intrinsics-poc';

/*
 * Astryx's CSS reset used to live here as
 * `overrideUAStyle('p', {marginBlock: 0})`, and it has moved to `ASTRYX_RESET`
 * in `jsx-runtime.js`, where it applies to Astryx's elements only.
 *
 * `overrideUAStyle` mutates the SHARED user-agent style object, so running it
 * at module scope zeroed `<p>`'s margins for every screen in the app the moment
 * this module was imported. Since RNTester loads example modules lazily, that
 * made paragraph spacing depend on which screens had been visited — and it read
 * as a native renderer bug for a long time. Do not put it back.
 */
