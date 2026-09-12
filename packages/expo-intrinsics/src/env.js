/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The environment values `env()` can name: css-env-1's four safe-area insets,
 * all published by the surface so they resolve during layout
 */
export type EnvironmentVariable =
  | 'safe-area-inset-top'
  | 'safe-area-inset-right'
  | 'safe-area-inset-bottom'
  | 'safe-area-inset-left';

/**
 * A length the renderer resolves, spelled the way CSS spells it:
 *
 * ```jsx
 * <View style={{paddingTop: env('safe-area-inset-top')}} />
 * <View style={{paddingBottom: env('safe-area-inset-bottom', 12)}} />
 * ```
 *
 * Unlike a safe area read in JavaScript, which reaches layout a render late,
 * this travels to the renderer as an unresolved symbol and is resolved during
 * the layout pass against the value the surface published, so the first frame
 * is right and a rotation re-lays out without React. The value is a string
 * because React Native style lengths accept strings and
 * `'env(safe-area-inset-top)'` written by hand means the same thing.
 *
 * `fallback` is css-values-4's second argument: what the length computes to
 * where nothing has been published, not a minimum. Supported on the
 * length-valued layout properties (padding, margin, the inset offsets, border
 * widths, gaps, width and height); not inside `calc()` and not on the logical
 * `*Block`/`*Inline` aliases, see `EnvironmentDependency.h`.
 */
export default function env(
  variable: EnvironmentVariable,
  fallback?: number,
): string {
  return fallback == null
    ? `env(${variable})`
    : `env(${variable}, ${fallback}px)`;
}
