/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ViewProps} from 'react-native';

import env from './env';
import * as React from 'react';
import {View} from 'react-native';

type Edges =
  | boolean
  | {
      readonly top?: boolean,
      readonly right?: boolean,
      readonly bottom?: boolean,
      readonly left?: boolean,
    };

/*
 * Everything a `View` takes, plus `edges`.
 *
 * Spelled by extending `ViewProps` rather than as an inexact object with a
 * `...`: `View`'s props are EXACT, so spreading an inexact rest into it is a
 * type error, and the shape of what this passes through is worth stating anyway.
 */
type NativeSafeAreaProps = {
  ...ViewProps,
  edges?: Edges,
};

/**
 * `<native:safearea>` — a box that keeps its children clear of the system's own
 * furniture.
 *
 * The status bar, the home indicator, a display cutout. Everything inside lays
 * out in what is left.
 *
 * ## It is four `env()`s and nothing else
 *
 * Which is the reason it is written in JavaScript rather than as an element with
 * a shadow node and a view on each platform, as it was to begin with. That
 * version measured its own frame in the platform view, pushed the result into
 * state, and turned the state into padding — correct, but it could only measure
 * AFTER a layout, so the first frame was laid out with no inset and the second
 * corrected it. The flash was the implementation, not the idea.
 *
 * `env()` resolves during the layout pass instead, from a value the surface
 * hands over with its constraints, so the first layout already has it. Once that
 * exists this component has no work left to do: it is a `View` with padding.
 *
 * ## Edges
 *
 * All four by default, because that is what "keep this inside the safe area"
 * means when nobody has said otherwise. Name the ones you do NOT want:
 *
 * ```jsx
 * <NativeSafeArea edges={{top: false}}>   // a screen under a native header
 * <NativeSafeArea edges={false}>          // reserve nothing
 * ```
 *
 * The same rule `<native:scroll>`'s `automaticInsets` follows, deliberately: two
 * elements answering the same question should answer it the same way.
 *
 * `style` is applied AFTER, so an author's own padding wins on the edges they
 * write and the safe area still covers the ones they do not.
 *
 * ## When NOT to use it
 *
 * A scrolling list should not be wrapped in one. `<native:scroll>` reserves the
 * safe area itself, as content inset rather than as padding, so that content
 * scrolls UNDER the bars while remaining reachable — which is what the platform
 * does and what a padded box cannot express. Wrapping one here would inset the
 * viewport instead, leaving a dead strip where the content should run past.
 */
export default function NativeSafeArea({
  edges = true,
  style,
  ...rest
}: NativeSafeAreaProps): React.Node {
  const on = (edge: 'top' | 'right' | 'bottom' | 'left') =>
    typeof edges === 'boolean' ? edges : edges[edge] !== false;

  return (
    <View
      {...rest}
      style={[
        {
          paddingTop: on('top') ? env('safe-area-inset-top') : undefined,
          paddingRight: on('right') ? env('safe-area-inset-right') : undefined,
          paddingBottom: on('bottom')
            ? env('safe-area-inset-bottom')
            : undefined,
          paddingLeft: on('left') ? env('safe-area-inset-left') : undefined,
        },
        style,
      ]}
    />
  );
}
