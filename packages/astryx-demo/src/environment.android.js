/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {setEnvironmentResolver} from '../../rn-tester/js/astryx/stylex-rn';
import {StatusBar} from 'react-native';

// What `env(safe-area-inset-*)` resolves to on Android, where the app draws
// under the system bars (edge-to-edge) and the safe-area module is not built:
// the status bar's height at the top, nothing elsewhere (the gesture
// navigation bar is translucent and a template may draw under it)
setEnvironmentResolver(name => {
  if (name === 'safe-area-inset-top') {
    return StatusBar.currentHeight ?? 0;
  }
  if (
    name === 'safe-area-inset-bottom' ||
    name === 'safe-area-inset-left' ||
    name === 'safe-area-inset-right'
  ) {
    return 0;
  }
  return null;
});
