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

// The seam for any element Astryx needs that the catalog does not provide

import '@react-native/expo-intrinsics-poc';

// Astryx's CSS reset is `ASTRYX_RESET` in `jsx-runtime.js`, scoped to its
// elements; `overrideUAStyle` would mutate the shared user-agent sheet
