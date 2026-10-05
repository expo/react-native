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

// The element catalog supplies Astryx's intrinsics; this module is the seam for
// anything Astryx needs on top of it

import '@react-native/expo-intrinsics-poc';

import {overrideUAStyle} from '@react-native/expo-intrinsics-poc';

// Astryx's CSS reset. On the web Astryx ships a reset and styles from scratch
// on top of it (its Card computes an exact 16px inset); the vendored slice
// does not include the reset, so the user-agent `<p>` margins would add to it.
// The UA sheet stays web-faithful; the reset belongs to the consumer, as in a
// browser.
overrideUAStyle('p', {marginBlock: 0});
