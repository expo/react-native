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
import {PluralRules, numberFormatToParts} from '../intl-shim';

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

describe('numberFormatToParts', () => {
  const english = {format: (n: number) => n.toLocaleString('en-US')};
  const german = {
    format: (n: number) =>
      n.toLocaleString('en-US').replace(/[.,]/g, c => (c === ',' ? '.' : ',')),
  };

  it('reads integer runs, the group and the decimal from the string', () => {
    expect(numberFormatToParts(english, 12345.6)).toEqual([
      {type: 'integer', value: '12'},
      {type: 'group', value: ','},
      {type: 'integer', value: '345'},
      {type: 'decimal', value: '.'},
      {type: 'fraction', value: '6'},
    ]);
  });

  it('tells a locale whose group symbol is the point', () => {
    expect(numberFormatToParts(german, 1234.5)).toEqual([
      {type: 'integer', value: '1'},
      {type: 'group', value: '.'},
      {type: 'integer', value: '234'},
      {type: 'decimal', value: ','},
      {type: 'fraction', value: '5'},
    ]);
  });

  it('exposes every grouping size of a long integer', () => {
    const sizes = numberFormatToParts(english, 11111111111)
      .filter(part => part.type === 'integer')
      .map(part => part.value.length);
    expect(sizes).toEqual([2, 3, 3, 3]);
  });

  it('keeps the sign and a percent sign apart from the digits', () => {
    const percent = {format: (n: number) => `-${n}%`};
    expect(numberFormatToParts(percent, 42)).toEqual([
      {type: 'minusSign', value: '-'},
      {type: 'integer', value: '42'},
      {type: 'percentSign', value: '%'},
    ]);
  });
});

describe('PluralRules', () => {
  it('selects one for exactly one and other for the rest, as English does', () => {
    const rules = new PluralRules('en');
    expect([0, 1, 2, 1.5, -1].map(n => rules.select(n))).toEqual([
      'other',
      'one',
      'other',
      'other',
      'one',
    ]);
  });

  it('selects the ordinal categories by the last digits', () => {
    const rules = new PluralRules('en', {type: 'ordinal'});
    expect(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(n => rules.select(n)),
    ).toEqual([
      'one',
      'two',
      'few',
      'other',
      'other',
      'other',
      'other',
      'one',
      'two',
      'few',
      'one',
    ]);
  });

  it('reports its options as the engine would', () => {
    expect(new PluralRules(['de', 'en']).resolvedOptions()).toEqual({
      locale: 'de',
      type: 'cardinal',
      pluralCategories: ['one', 'other'],
    });
  });
});
