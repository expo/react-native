/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * Whether a read's answer is the one wanted, shared by the Safari oracle
 * (wanted: the case's spec reading) and the engine's test (wanted: Safari's
 * answer). Null when it is, else what differs.
 *
 * Lengths agree to a quarter point and colour channels to one step, alpha to
 * a hundredth: the corpus is built so a wrong cascade is off by whole pixels
 * and whole colours.
 */
function compareRead(read, wanted, answer) {
  if (answer == null) {
    return 'no answer';
  }
  if (answer.error != null) {
    return answer.error;
  }
  if (read.rect != null) {
    const want = wanted.rect;
    const got = answer.rect;
    if (
      got == null ||
      want.some((value, i) => Math.abs(value - got[i]) > 0.25)
    ) {
      return `rect ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`;
    }
    return null;
  }
  if (read.background != null) {
    const want = wanted.background;
    const got = answer.background;
    if (
      !Array.isArray(got) ||
      want.slice(0, 3).some((value, i) => Math.abs(value - got[i]) > 1) ||
      Math.abs(want[3] - got[3]) > 0.01
    ) {
      return `background ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`;
    }
    return null;
  }
  if (read.matches != null) {
    const want = wanted === read ? read.expect : wanted.matches;
    if (answer.matches !== want) {
      return `matches(${read.matches}) is ${String(answer.matches)}, wanted ${String(want)}`;
    }
    return null;
  }
  if (read.custom != null) {
    const want = wanted === read ? read.expect : wanted.custom;
    const normal = value =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (normal(answer.custom) !== normal(want)) {
      return `${read.custom} is "${String(answer.custom)}", wanted "${String(want)}"`;
    }
    return null;
  }
  return 'a read of nothing';
}

module.exports = {compareRead};
