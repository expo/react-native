/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

// CSSOM View §6.1, in one axis. An oversized target already covering the
// viewport must stay where it is for `nearest`.
export default function scrollAlignment(
  start: number,
  end: number,
  viewportStart: number,
  viewportEnd: number,
  alignment: string,
): number {
  if (alignment === 'start') {
    return start - viewportStart;
  }
  if (alignment === 'end') {
    return end - viewportEnd;
  }
  if (alignment === 'center') {
    return (start + end - viewportStart - viewportEnd) / 2;
  }
  if (start < viewportStart && end > viewportEnd) {
    return 0;
  }
  const smaller = end - start <= viewportEnd - viewportStart;
  if (start < viewportStart) {
    return smaller ? start - viewportStart : end - viewportEnd;
  }
  if (end > viewportEnd) {
    return smaller ? end - viewportEnd : start - viewportStart;
  }
  return 0;
}
