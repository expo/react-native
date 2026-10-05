/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {CodegenTypes, HostComponent, ViewProps} from 'react-native';

import {codegenNativeComponent} from 'react-native';

/**
 * A view that fills itself with one vector path.
 *
 * Deliberately the smallest native surface that can draw SVG: a flat list of
 * primitives and how to paint them. `d` parsing, arc flattening, `viewBox`
 * scaling and `currentColor` resolution all happen in JavaScript, so both
 * platforms receive identical geometry and neither needs a parser.
 *
 * `commands` is opcode-then-arguments, matching `svg/pathData.js`:
 *   0 move (x y) · 1 line (x y) · 2 cubic (x1 y1 x2 y2 x y) · 3 close
 *
 * Codegen has no tuple or union type for this, and a flat `Float` array is the
 * cheapest thing to send across anyway — an icon is a few dozen numbers.
 */
type NativeProps = Readonly<{
  ...ViewProps,
  commands?: ReadonlyArray<CodegenTypes.Float>,
  fillColor?: CodegenTypes.Int32,
  strokeColor?: CodegenTypes.Int32,
  strokeWidth?: CodegenTypes.Float,
  // 'butt' | 'round' | 'square'
  strokeLinecap?: string,
  // 'miter' | 'round' | 'bevel'
  strokeLinejoin?: string,
  // 'nonzero' | 'evenodd'
  fillRule?: string,
}>;

export default codegenNativeComponent<NativeProps>(
  'AstryxVectorShape',
) as HostComponent<NativeProps>;
