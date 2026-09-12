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
 * Everything a `View` takes, plus `edges`. Extends `ViewProps` because
 * `View`'s props are exact, so spreading an inexact rest into it is a type
 * error.
 */
type NativeSafeAreaProps = {
  ...ViewProps,
  edges?: Edges,
};

/**
 * `<native:safearea>`: a box that keeps its children clear of the status bar,
 * the home indicator and a display cutout. It is a `View` padded with four
 * `env()`s, which resolve during the layout pass from the value the surface
 * hands over with its constraints, so the first layout already has the inset.
 *
 * All four edges by default; name the ones not wanted, the same rule as
 * `<native:scroll>`'s `automaticInsets`:
 *
 * ```jsx
 * <NativeSafeArea edges={{top: false}}>   // a screen under a native header
 * <NativeSafeArea edges={false}>          // reserve nothing
 * ```
 *
 * `style` is applied after, so an author's own padding wins on the edges they
 * write. A scrolling list should not be wrapped in one: `<native:scroll>`
 * reserves the safe area as content inset, so content scrolls under the bars
 * while remaining reachable, which padding cannot express.
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
