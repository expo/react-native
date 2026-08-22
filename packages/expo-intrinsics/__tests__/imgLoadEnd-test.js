/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {LoadLifecycleHandlers} from '../src/Img';

import {withSynthesizedLoadEnd} from '../src/Img';

/*
 * `loadend` is HTML's "the fetch is over, however it went": it fires after
 * `load` AND after `error`. The framework image backing emits it natively;
 * expo-image's native view does not (its own JS component synthesises it),
 * and `<img onLoadEnd>` silently never fired on iOS while Android reported
 * the full lifecycle. These pin the synthesis rule.
 */
describe('withSynthesizedLoadEnd', () => {
  test('loadend follows load on a backing that lacks it', () => {
    const calls: Array<string> = [];
    const out = withSynthesizedLoadEnd(
      {
        onLoad: () => calls.push('load'),
        onLoadEnd: () => calls.push('loadend'),
      },
      true,
    );
    // $FlowFixMe[not-a-function]
    out.onLoad({});
    expect(calls).toEqual(['load', 'loadend']);
    expect(out.onLoadEnd).toBeUndefined();
  });

  test('loadend follows error too — the fetch is over either way', () => {
    const calls: Array<string> = [];
    const out = withSynthesizedLoadEnd(
      {
        onError: () => calls.push('error'),
        onLoadEnd: () => calls.push('loadend'),
      },
      true,
    );
    // $FlowFixMe[not-a-function]
    out.onError({});
    expect(calls).toEqual(['error', 'loadend']);
  });

  test('a backing with its own loadend gets untouched handlers — no double fire', () => {
    const handlers: LoadLifecycleHandlers = {onLoad: () => {}, onLoadEnd: () => {}};
    expect(withSynthesizedLoadEnd(handlers, false)).toBe(handlers);
  });

  test('no loadend listener means nothing to synthesise', () => {
    const handlers: LoadLifecycleHandlers = {onLoad: () => {}};
    expect(withSynthesizedLoadEnd(handlers, true)).toBe(handlers);
  });
});
