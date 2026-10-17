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
// The `document` the vendored sources reach for; see the file
import './document-shim';
// The DOM methods the sources call on their element refs; see the file
import './dom-compat';

// Astryx's CSS reset is its own `reset.css`, which a host installs as a sheet
// (astryx-demo's AstryxHost does); `overrideUAStyle` would mutate the shared
// user-agent sheet
