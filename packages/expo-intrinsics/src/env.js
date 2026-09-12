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
 * The environment values `env()` can name.
 *
 * The safe area, for now — css-env-1's original four. Everything here is
 * published by the surface, which is why an `env()` can be resolved during
 * layout instead of being read in JavaScript and rendered a frame later.
 */
export type EnvironmentVariable =
  | 'safe-area-inset-top'
  | 'safe-area-inset-right'
  | 'safe-area-inset-bottom'
  | 'safe-area-inset-left';

/**
 * A length the RENDERER resolves, spelled the way CSS spells it.
 *
 * ```jsx
 * <View style={{paddingTop: env('safe-area-inset-top')}} />
 * <View style={{paddingBottom: env('safe-area-inset-bottom', 12)}} />
 * ```
 *
 * The point of this rather than `useSafeAreaInsets()` is *when* the number
 * arrives. Read in JavaScript, a safe area can only reach layout through a
 * render: the first frame is laid out against a value nobody knew yet and the
 * second one corrects it, which is the shift you can see on any launch. Written
 * this way it travels to the renderer as an unresolved symbol and is resolved
 * during the layout pass itself, against a value the pass is already holding.
 * There is no frame in between to be wrong, and a rotation re-lays out without
 * React being involved at all.
 *
 * The value is a string because that is what CSS calls it and because React
 * Native style lengths already accept strings — there is no wrapper object to
 * unwrap, and `'env(safe-area-inset-top)'` written out by hand means exactly the
 * same thing as calling this.
 *
 * The `fallback` is css-values-4's second argument: what the length computes to
 * where the value is UNKNOWN. Not a minimum — a surface that publishes a smaller
 * value wins, and one that publishes zero gives you zero, exactly as a browser
 * does on a device with no notch. What it covers is the case where nothing has
 * been published at all: a platform that does not report a safe area, and the
 * moment before a brand-new surface has been told its own.
 *
 * Supported on the length-valued layout properties: padding, margin, the four
 * inset offsets, border widths, gaps, and the width/height family. Not inside
 * `calc()`, and not on the logical `*Block`/`*Inline` aliases — see
 * `EnvironmentDependency.h` for why.
 */
export default function env(
  variable: EnvironmentVariable,
  fallback?: number,
): string {
  return fallback == null
    ? `env(${variable})`
    : `env(${variable}, ${fallback}px)`;
}
