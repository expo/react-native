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

import * as ReactNativeFeatureFlags from '../../src/private/featureflags/ReactNativeFeatureFlags';
import {polyfillGlobal} from '../Utilities/PolyfillFunctions';

// `CSS.supports` and `matchMedia`, installed lazily
if (ReactNativeFeatureFlags.enableColorSpaces()) {
  polyfillGlobal('CSS', () => require('../StyleSheet/CSS').default);
  polyfillGlobal(
    'matchMedia',
    () => require('../Utilities/matchMedia').default,
  );
}
