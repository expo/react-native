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

import {RelativeTimeFormat} from '../intl-shim';

describe('Intl.RelativeTimeFormat stand-in', () => {
  it('says a number of units ago or in, singular and plural', () => {
    const format = new RelativeTimeFormat('en');
    expect(format.format(-1, 'day')).toBe('1 day ago');
    expect(format.format(3, 'days')).toBe('in 3 days');
    expect(format.format(0, 'second')).toBe('in 0 seconds');
    expect(format.format(-0, 'second')).toBe('0 seconds ago');
    expect(format.format(-1200, 'year')).toBe('1,200 years ago');
    expect(format.format(1.0001, 'day')).toBe('in 1 day');
  });

  it('names -1, 0 and 1 with numeric: auto', () => {
    const format = new RelativeTimeFormat('en', {numeric: 'auto'});
    expect(format.format(-1, 'day')).toBe('yesterday');
    expect(format.format(0, 'day')).toBe('today');
    expect(format.format(1, 'week')).toBe('next week');
    expect(format.format(0, 'second')).toBe('now');
    expect(format.format(2, 'day')).toBe('in 2 days');
  });

  it('abbreviates the short and narrow styles, and parts the number out', () => {
    const format = new RelativeTimeFormat('en', {style: 'short'});
    expect(format.format(-2, 'hour')).toBe('2 hr. ago');
    expect(format.format(3, 'quarter')).toBe('in 3 qtrs.');
    expect(format.formatToParts(5, 'minute')).toEqual([
      {type: 'literal', value: 'in '},
      {type: 'integer', value: '5', unit: 'minute'},
      {type: 'literal', value: ' min.'},
    ]);
  });

  it('refuses a unit or a value it cannot format', () => {
    const format = new RelativeTimeFormat('en');
    expect(() => format.format(1, 'fortnight')).toThrow(RangeError);
    expect(() => format.format(Number.NaN, 'day')).toThrow(RangeError);
  });
});
