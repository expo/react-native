/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/* eslint no-bitwise: 0 */

import type {ProcessedColorValue} from './processColor';
import type {ColorValue} from './StyleSheet';

import * as ReactNativeFeatureFlags from '../../src/private/featureflags/ReactNativeFeatureFlags';
import _normalizeColor from '@react-native/normalize-colors';
import normalizeColorSpace from '@react-native/normalize-colors/colorSpaces';

function normalizeColor(
  color: ?(ColorValue | ProcessedColorValue),
): ?ProcessedColorValue {
  if (typeof color === 'object' && color != null) {
    const {normalizeColorObject} = require('./PlatformColorValueTypes');
    const normalizedColor = normalizeColorObject(color);
    if (normalizedColor != null) {
      return normalizedColor;
    }
  }

  if (typeof color === 'string' || typeof color === 'number') {
    const normalized = _normalizeColor(color);
    // A color in its own space can't be an 8-bit integer
    if (
      normalized == null &&
      typeof color === 'string' &&
      ReactNativeFeatureFlags.enableColorSpaces()
    ) {
      // $FlowFixMe[incompatible-type] the object is a NativeColorValue on the wire
      return normalizeColorSpace(color);
    }
    return normalized;
  }
}

export default normalizeColor;
