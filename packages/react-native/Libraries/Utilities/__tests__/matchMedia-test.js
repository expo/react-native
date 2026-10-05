/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

const capabilities = {colorGamut: 'p3', dynamicRange: 'standard'};
const displayListeners = [];
let colorScheme = 'light';
const appearanceListeners = [];

jest.mock('../NativeDisplayCapabilities', () => ({
  __esModule: true,
  default: {
    getCapabilities: () => ({...capabilities}),
    isColorSpaceAvailable: (name: string) =>
      !name.startsWith('--') || name === '--dci-p3',
    addListener: () => {},
    removeListeners: () => {},
  },
}));

jest.mock('../../EventEmitter/NativeEventEmitter', () => {
  return class {
    addListener(name: string, listener: $FlowFixMe): {remove(): void} {
      displayListeners.push(listener);
      return {remove() {}};
    }
  };
});

jest.mock('../Appearance', () => ({
  getColorScheme: () => colorScheme,
  addChangeListener: (listener: $FlowFixMe) => {
    appearanceListeners.push(listener);
    return {remove() {}};
  },
}));

const matchMedia = require('../matchMedia').default;

function displayChanged(next: {colorGamut: string, dynamicRange: string}) {
  capabilities.colorGamut = next.colorGamut;
  capabilities.dynamicRange = next.dynamicRange;
  displayListeners.forEach(listener => listener({...capabilities}));
}

describe('matchMedia', () => {
  beforeEach(() => {
    capabilities.colorGamut = 'p3';
    capabilities.dynamicRange = 'standard';
    colorScheme = 'light';
  });

  it('answers color-gamut as a gamut the display covers or more', () => {
    expect(matchMedia('(color-gamut: srgb)').matches).toBe(true);
    expect(matchMedia('(color-gamut: p3)').matches).toBe(true);
    expect(matchMedia('(color-gamut: rec2020)').matches).toBe(false);
    expect(matchMedia('(color-gamut)').matches).toBe(true);
    displayChanged({colorGamut: 'srgb', dynamicRange: 'standard'});
    expect(matchMedia('(color-gamut: p3)').matches).toBe(false);
  });

  it('answers dynamic-range, and video-dynamic-range the same', () => {
    expect(matchMedia('(dynamic-range: standard)').matches).toBe(true);
    expect(matchMedia('(dynamic-range: high)').matches).toBe(false);
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(matchMedia('(dynamic-range: high)').matches).toBe(true);
    expect(matchMedia('(video-dynamic-range: high)').matches).toBe(true);
    expect(matchMedia('(dynamic-range: standard)').matches).toBe(true);
  });

  it('answers prefers-color-scheme from Appearance', () => {
    expect(matchMedia('(prefers-color-scheme: light)').matches).toBe(true);
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
    colorScheme = 'dark';
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
  });

  it('combines features with and, lists with commas, and negates with not', () => {
    expect(
      matchMedia('(color-gamut: p3) and (dynamic-range: high)').matches,
    ).toBe(false);
    expect(
      matchMedia('(color-gamut: p3) and (dynamic-range: standard)').matches,
    ).toBe(true);
    expect(matchMedia('(dynamic-range: high), (color-gamut: p3)').matches).toBe(
      true,
    );
    expect(matchMedia('not all and (color-gamut: p3)').matches).toBe(false);
    expect(matchMedia('screen and (color-gamut: srgb)').matches).toBe(true);
    expect(matchMedia('only screen and (color-gamut: p3)').matches).toBe(true);
  });

  it("is false for a feature or a value it doesn't know, under not too, and keeps the text", () => {
    expect(matchMedia('(min-width: 600px)').matches).toBe(false);
    expect(matchMedia('not (min-width: 600px)').matches).toBe(false);
    expect(matchMedia('(color-gamut: wide)').matches).toBe(false);
    expect(matchMedia('not (color-gamut: wide)').matches).toBe(false);
    expect(matchMedia('  (color-gamut: p3)  ').media).toBe('(color-gamut: p3)');
  });

  it('treats a media type it does not describe as valid and false', () => {
    expect(matchMedia('print').matches).toBe(false);
    expect(matchMedia('not print').matches).toBe(true);
    expect(matchMedia('nonsense').matches).toBe(false);
    expect(matchMedia('not nonsense').matches).toBe(true);
    expect(matchMedia('not screen').matches).toBe(false);
    expect(matchMedia('print and (color-gamut: srgb)').matches).toBe(false);
  });

  it('counts a listener once, drops it once, and ignores a stranger', () => {
    const list = matchMedia('(dynamic-range: high)');
    const listener = jest.fn();
    list.addEventListener('change', listener);
    list.addEventListener('change', listener);
    const stranger = jest.fn();
    list.removeEventListener('change', stranger);
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(listener).toHaveBeenCalledTimes(1);
    list.removeEventListener('change', listener);
    displayChanged({colorGamut: 'p3', dynamicRange: 'standard'});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires a change that was read before it was announced', () => {
    const list = matchMedia('(dynamic-range: high)');
    const listener = jest.fn();
    list.addEventListener('change', listener);
    capabilities.dynamicRange = 'high';
    expect(list.matches).toBe(true);
    displayListeners.forEach(cb => cb({...capabilities}));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('runs onchange in listener order, and keeps going when it throws', () => {
    const list = matchMedia('(dynamic-range: high)');
    const order = [];
    list.onchange = () => {
      order.push('onchange');
      throw new Error('handler failed');
    };
    list.addEventListener('change', () => order.push('listener'));
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(order).toEqual(['onchange', 'listener']);
  });

  it('tells a change listener when, and only when, the answer changes', () => {
    const list = matchMedia('(dynamic-range: high)');
    const seen = [];
    list.addEventListener('change', (event: $FlowFixMe) =>
      seen.push([event.matches, event.media]),
    );
    const viaProperty = jest.fn();
    list.onchange = viaProperty;

    displayChanged({colorGamut: 'p3', dynamicRange: 'standard'});
    expect(seen).toEqual([]);
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(seen).toEqual([[true, '(dynamic-range: high)']]);
    expect(viaProperty).toHaveBeenCalledTimes(1);
    expect(list.matches).toBe(true);
    displayChanged({colorGamut: 'srgb', dynamicRange: 'standard'});
    expect(seen).toEqual([
      [true, '(dynamic-range: high)'],
      [false, '(dynamic-range: high)'],
    ]);
  });

  it('lets an abort signal remove a registration, and only its own', () => {
    const list = matchMedia('(dynamic-range: high)');
    const listener = jest.fn();
    const first = new AbortController();
    list.addEventListener('change', listener, {signal: first.signal});
    list.removeEventListener('change', listener);
    const second = new AbortController();
    list.addEventListener('change', listener, {signal: second.signal});
    // The first signal's registration is gone; aborting it must not touch
    // the second registration of the same callback
    first.abort();
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(listener).toHaveBeenCalledTimes(1);
    second.abort();
    displayChanged({colorGamut: 'p3', dynamicRange: 'standard'});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a once listener registered during another once listener', () => {
    const list = matchMedia('(dynamic-range: high)');
    const later = jest.fn();
    list.addEventListener(
      'change',
      () => list.addEventListener('change', later, {once: true}),
      {once: true},
    );
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(later).toHaveBeenCalledTimes(0);
    displayChanged({colorGamut: 'p3', dynamicRange: 'standard'});
    expect(later).toHaveBeenCalledTimes(1);
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('keeps onchange in its place when replaced, and calls it on the list', () => {
    const list = matchMedia('(dynamic-range: high)');
    const order = [];
    list.onchange = () => order.push('first handler');
    list.addEventListener('change', () => order.push('listener'));
    const receivers: Array<unknown> = [];
    list.onchange = function (this: $FlowFixMe) {
      receivers.push(this);
      order.push('second handler');
    };
    displayChanged({colorGamut: 'p3', dynamicRange: 'high'});
    expect(order).toEqual(['second handler', 'listener']);
    expect(receivers.length).toBe(1);
    expect(receivers[0]).toBe(list);
    list.onchange = null;
    displayChanged({colorGamut: 'p3', dynamicRange: 'standard'});
    expect(order).toEqual(['second handler', 'listener', 'listener']);
  });

  it('takes a modifier only with a media type, and not with one term', () => {
    expect(matchMedia('only (color-gamut: srgb)').matches).toBe(false);
    expect(matchMedia('only screen and (color-gamut: srgb)').matches).toBe(
      true,
    );
    expect(matchMedia('not (dynamic-range: high)').matches).toBe(true);
    expect(
      matchMedia('not (dynamic-range: high) and (color-gamut: srgb)').matches,
    ).toBe(false);
    expect(matchMedia('not screen and (dynamic-range: high)').matches).toBe(
      true,
    );
  });

  it('follows an appearance change for prefers-color-scheme', () => {
    const list = matchMedia('(prefers-color-scheme: dark)');
    const listener = jest.fn();
    list.addListener(listener);
    colorScheme = 'dark';
    appearanceListeners.forEach(cb => cb({colorScheme}));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].matches).toBe(true);
    list.removeListener(listener);
    colorScheme = 'light';
    appearanceListeners.forEach(cb => cb({colorScheme}));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
