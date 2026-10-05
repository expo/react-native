/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

import type {TurboModule} from '../../../../Libraries/TurboModule/RCTExport';

import * as TurboModuleRegistry from '../../../../Libraries/TurboModule/TurboModuleRegistry';

/**
 * What the display can show, as Media Queries 5 names it, asked of the OS at
 * run time
 */
export type DisplayCapabilities = {
  colorGamut: 'srgb' | 'p3' | 'rec2020',
  dynamicRange: 'standard' | 'high',
};

export interface Spec extends TurboModule {
  // Synchronous, because `matchMedia` answers synchronously
  readonly getCapabilities: () => DisplayCapabilities;
  // Whether this device draws the named space; a space CSS defines always is
  readonly isColorSpaceAvailable: (name: string) => boolean;

  // RCTEventEmitter
  readonly addListener: (eventName: string) => void;
  readonly removeListeners: (count: number) => void;
}

export default TurboModuleRegistry.get<Spec>('DisplayCapabilities') as ?Spec;
