/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {CodegenTypes, TurboModule} from 'react-native';

import {TurboModuleRegistry} from 'react-native';

export type ScreenshotManagerOptions = CodegenTypes.UnsafeObject;

export interface Spec extends TurboModule {
  readonly getConstants: () => {};
  takeScreenshot(
    id: string,
    options: ScreenshotManagerOptions,
  ): Promise<string>;
  readonly sample?: (points: Array<Array<number>>) => Promise<ColorSamples>;
}

export type ColorSamples = {
  space: string,
  values: Array<?Array<number>>,
  // The sampled window, in points, and its pixels per point (iOS only)
  window?: {width: number, height: number, scale: number},
};

const NativeModule = TurboModuleRegistry.get<Spec>('ScreenshotManager');
export function takeScreenshot(
  id: string,
  options: ScreenshotManagerOptions,
): Promise<string> {
  if (NativeModule != null) {
    return NativeModule.takeScreenshot(id, options);
  }
  return Promise.reject(new Error('ScreenshotManager is not defined.'));
}

// The window's pixels at `points` (window points), as unclipped floats in
// the space the result names
export function sample(points: Array<Array<number>>): Promise<ColorSamples> {
  if (NativeModule?.sample != null) {
    return NativeModule.sample(points);
  }
  return Promise.reject(
    new Error('ScreenshotManager.sample is not available on this platform.'),
  );
}
