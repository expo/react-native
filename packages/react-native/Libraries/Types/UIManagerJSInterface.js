/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {Spec} from '../ReactNative/NativeUIManager';

export interface UIManagerJSInterface extends Spec {
  readonly getViewManagerConfig: (viewManagerName: string) => Object;
  readonly hasViewManagerConfig: (viewManagerName: string) => boolean;
  /**
   * Whether `getViewManagerConfig` can answer at all.
   *
   * Not "does this component have one" — `hasViewManagerConfig` answers that.
   * This asks whether native view configs are obtainable in this runtime at
   * all: on the new architecture they are only reachable through the legacy
   * ViewConfig interop layer, and with it off there is no answer for ANY
   * component.
   *
   * The distinction matters because it separates two very different
   * situations that otherwise look identical at the call site — "this
   * component isn't registered natively", which is usually a real problem, and
   * "nothing can be asked here", which is a property of the runtime and should
   * change what the caller attempts rather than produce an error per
   * component.
   */
  readonly unstable_hasNativeViewConfigInterop: () => boolean;
}
