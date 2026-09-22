/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

export const READABLE_WIDTH = 700;

// Inside the locally safe content, never around a native screen controller.
export const READABLE_COLUMN = {
  width: '100%',
  maxWidth: READABLE_WIDTH,
  alignSelf: 'center',
};
