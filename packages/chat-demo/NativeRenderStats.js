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
 * The counters from `RCTRenderStats.h` (iOS), so the app can show its
 * rendering cost on a device without a Mac attached. Keys are set in
 * `RenderStatsModule.mm`.
 *
 * Fields are running totals that are never reset: read before and after, and
 * subtract. `biggestMutations` and `worstSweepUs` are maximums and can't be
 * subtracted.
 */
export type RenderStats = {[key: string]: number};

export interface Spec extends TurboModule {
  /**
   * Off by default, because timing each mutation has a cost. On a device this
   * is the only switch; a simulator run can also set `EXP_MOUNTING_STATS=1` or
   * `EXP_VIRTUALVIEW_STATS=1`.
   */
  readonly setEnabled: (enabled: boolean) => void;

  /** Synchronous: copies the current counters. */
  readonly read: () => RenderStats;

  /**
   * Appends a line to the app's native trace (`EXPKeyboardTrace`), timestamped
   * on the same clock as the native events in it. `tools/gate.sh` streams that
   * trace, and a two-finger double-tap copies it (`copyTrace:` in
   * `AppDelegate.mm`).
   */
  readonly trace: (line: string) => void;
}

export default TurboModuleRegistry.get<Spec>('RenderStats') as ?Spec;
