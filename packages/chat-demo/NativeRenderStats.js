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

/**
 * What the renderer spent, for a screen that wants to say so.
 *
 * The numbers are React Native's — `RCTRenderStats.h`, which the mounting
 * manager and the virtualized container both write into — and they already had
 * a reader: one line a second to `os_log`. That reader needs a Mac and a cable,
 * and the question this app is asked is "why is scrolling slow on my phone".
 * So the app needs its own, and a module is the only channel a running app has
 * to a number that is not in the render tree.
 *
 * Every field is a RUNNING TOTAL. A caller reads before and after and
 * subtracts, which is what lets this reader and the log coexist without either
 * resetting anything under the other. Two fields do not survive that —
 * `biggestMutations` and `worstSweepUs` are high-water marks — and are named so
 * that a subtraction of them looks as wrong as it is.
 */
export type RenderStats = {[key: string]: number};

export interface Spec extends TurboModule {
  /**
   * Whether the counters are kept at all.
   *
   * Off by default, and this is the only way to say otherwise on a device: the
   * environment variables the simulator uses do not exist for an app started
   * from the home screen. The timing around each mutation is what costs, so
   * an app that is not measuring should not pay for it.
   */
  +setEnabled: (enabled: boolean) => void;

  /** Every counter, as one object. Synchronous: it is a struct copy. */
  +read: () => RenderStats;
}

export default (TurboModuleRegistry.get<Spec>('RenderStats'): ?Spec);
