/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {Spec, ViewManagerConfig} from '../ReactNative/NativeUIManager';

export interface UIManagerJSInterface extends Spec {
  readonly getViewManagerConfig: (viewManagerName: string) => ViewManagerConfig;
  readonly hasViewManagerConfig: (viewManagerName: string) => boolean;
  /**
   * Whether `getViewManagerConfig` can return native view configs at all. On
   * the new architecture it can only through the legacy view config interop
   * layer.
   */
  readonly unstable_hasNativeViewConfigInterop?: () => boolean;
}
