/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import '../document-shim';

/**
 * `window.matchMedia`, which the shim takes from React Native when the app
 * has none (its grammar is tested in MediaQueries-test.js). Astryx's
 * `useMediaQuery` calls `window.matchMedia(query).matches` while rendering,
 * which threw in the app (Settings, Order Detail and every Selector).
 */
describe('window.matchMedia', () => {
  it('answers with a MediaQueryList', () => {
    const list = global.matchMedia('(max-width: 99999px)');
    expect(list.media).toBe('(max-width: 99999px)');
    expect(list.matches).toBe(true);
    expect(global.matchMedia('(min-width: 99999px)').matches).toBe(false);
    expect(
      global.matchMedia('(max-width: 768px) and (pointer: coarse)').matches,
    ).toBe(true);
  });

  it('takes change listeners and lets them go', () => {
    const list = global.matchMedia('(max-width: 768px)');
    const listener = jest.fn();
    list.addEventListener('change', listener);
    list.removeEventListener('change', listener);
    list.addListener(listener);
    list.removeListener(listener);
    list.onchange = listener;
    list.onchange = null;
    expect(listener).not.toHaveBeenCalled();
  });
});
