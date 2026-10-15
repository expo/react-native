/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

import {setEnvironmentResolver} from '../../rn-tester/js/astryx/stylex-rn';
import {initialWindowMetrics} from 'react-native-safe-area-context';

/**
 * What `env()` means in a template's styles: the safe-area insets, which
 * Astryx's layers subtract from the viewport when sizing a popover or a
 * dialog. The insets at launch; a rotation would change them, which no
 * template here survives in any case.
 */
const insets = initialWindowMetrics?.insets;

setEnvironmentResolver(name => {
  switch (name) {
    case 'safe-area-inset-top':
      return insets?.top ?? null;
    case 'safe-area-inset-bottom':
      return insets?.bottom ?? null;
    case 'safe-area-inset-left':
      return insets?.left ?? null;
    case 'safe-area-inset-right':
      return insets?.right ?? null;
    default:
      return null;
  }
});
