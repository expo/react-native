/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {TurboModule} from 'react-native';

import {TurboModuleRegistry} from 'react-native';

/** Commands for the Android host's native list/detail screen container. */
export interface Spec extends TurboModule {
  readonly getConstants: () => {
    twoPane: boolean,
    canToggleSidebar: boolean,
    galleryFold: boolean,
    divisionStart: number,
    divisionWidth: number,
  };
  readonly openDetail: () => void;
  readonly closeDetail: () => void;
  readonly toggleSidebar: () => void;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  'AstryxNavigation',
) as Spec;
