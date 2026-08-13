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

import {overrideUAStyle} from '@react-native/expo-intrinsics-poc';

/**
 * Astryx's CSS reset.
 *
 * Astryx on the web ships a reset and styles from scratch on top of it — its
 * Card computes an exact 16px inset and expects nothing else to contribute.
 * The vendored slice here does not include that reset, so without this the
 * user-agent `<p>` margins (correctly, per the web) add 16pt above and below
 * and the Card measures 32.
 *
 * The UA sheet stays web-faithful; the reset belongs to the consumer, exactly
 * as it does in a browser.
 */
overrideUAStyle('p', {marginBlock: 0});
