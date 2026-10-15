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

/**
 * `Intl.RelativeTimeFormat` (ECMA-402 §17) where the engine has none, as
 * Hermes does not: Astryx's Timestamp constructs one unguarded, so a page
 * with a relative time threw "undefined cannot be used as a constructor"
 * and the app terminated. The phrases are English's (CLDR `en`), whatever
 * locale is asked for, and the numbers are the engine's
 * `Intl.NumberFormat`. DOM-CSS-LIMITATION(relative-time-is-english)
 */

type Unit =
  'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

type Style = 'long' | 'short' | 'narrow';

type Options = {
  numeric?: 'always' | 'auto',
  style?: Style,
  localeMatcher?: string,
};

type Part = {type: string, value: string, unit?: Unit};

const UNITS: ReadonlyArray<Unit> = [
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

// CLDR en: the short and narrow unit names, singular and plural
const SHORT: {readonly [Unit]: [string, string]} = {
  second: ['sec.', 'sec.'],
  minute: ['min.', 'min.'],
  hour: ['hr.', 'hr.'],
  day: ['day', 'days'],
  week: ['wk.', 'wk.'],
  month: ['mo.', 'mo.'],
  quarter: ['qtr.', 'qtrs.'],
  year: ['yr.', 'yr.'],
};

// `numeric: 'auto'`: the phrases for -1, 0 and 1 that are not numbers
const AUTO: {readonly [Unit]: {readonly [string]: string}} = {
  second: {'0': 'now'},
  minute: {'0': 'this minute'},
  hour: {'0': 'this hour'},
  day: {'-1': 'yesterday', '0': 'today', '1': 'tomorrow'},
  week: {'-1': 'last week', '0': 'this week', '1': 'next week'},
  month: {'-1': 'last month', '0': 'this month', '1': 'next month'},
  quarter: {'-1': 'last quarter', '0': 'this quarter', '1': 'next quarter'},
  year: {'-1': 'last year', '0': 'this year', '1': 'next year'},
};

function unitOf(unit: unknown): Unit {
  const name = String(unit).replace(/s$/, '');
  const found = UNITS.find(candidate => candidate === name);
  if (found == null) {
    throw new RangeError(
      `Invalid unit argument for format() '${String(unit)}'. Use one of ` +
        `${UNITS.join(', ')}, singular or plural.`,
    );
  }
  return found;
}

class RelativeTimeFormat {
  #locale: string;
  #numeric: 'always' | 'auto';
  #style: Style;
  #numbers: {format(value: number): string};

  constructor(locales?: string | ReadonlyArray<string>, options?: Options) {
    const requested = Array.isArray(locales) ? locales[0] : locales;
    this.#locale = typeof requested === 'string' ? requested : 'en';
    this.#numeric = options?.numeric === 'auto' ? 'auto' : 'always';
    this.#style =
      options?.style === 'short' || options?.style === 'narrow'
        ? options.style
        : 'long';
    const NumberFormat = engineIntl()?.NumberFormat;
    this.#numbers =
      typeof NumberFormat === 'function'
        ? new NumberFormat(this.#locale)
        : {format: (value: number) => String(value)};
  }

  static supportedLocalesOf(
    locales: string | ReadonlyArray<string>,
  ): Array<string> {
    return (Array.isArray(locales) ? locales : [locales]).filter(
      locale => typeof locale === 'string',
    );
  }

  resolvedOptions(): {
    locale: string,
    numeric: 'always' | 'auto',
    style: Style,
    numberingSystem: string,
  } {
    return {
      locale: this.#locale,
      numeric: this.#numeric,
      style: this.#style,
      numberingSystem: 'latn',
    };
  }

  format(value: number, unit: string): string {
    return this.formatToParts(value, unit)
      .map(part => part.value)
      .join('');
  }

  formatToParts(value: number, unitName: string): Array<Part> {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new RangeError(
        `Invalid value argument for format() '${String(value)}': it must be a finite number.`,
      );
    }
    const unit = unitOf(unitName);
    if (this.#numeric === 'auto') {
      const phrase = AUTO[unit][String(Object.is(number, -0) ? 0 : number)];
      if (phrase != null) {
        return [{type: 'literal', value: phrase}];
      }
    }
    const past = number < 0 || Object.is(number, -0);
    const magnitude = Math.abs(number);
    const formatted = this.#numbers.format(magnitude);
    // English's plural rule on the number as shown, so 1.0001 is "1 day"
    const plural = formatted !== '1';
    const name =
      this.#style === 'long'
        ? plural
          ? `${unit}s`
          : unit
        : SHORT[unit][plural ? 1 : 0];
    const amount: Part = {
      type: 'integer',
      value: formatted,
      unit,
    };
    return past
      ? [amount, {type: 'literal', value: ` ${name} ago`}]
      : [
          {type: 'literal', value: 'in '},
          amount,
          {type: 'literal', value: ` ${name}`},
        ];
  }
}

// The engine's `Intl`, if it has one: Fantom's Hermes is built without
function engineIntl(): ?{[string]: $FlowFixMe} {
  return (globalThis as $FlowFixMe).Intl;
}

export function installIntlShim(): void {
  const intl = engineIntl();
  if (intl == null) {
    return;
  }
  if (typeof intl.RelativeTimeFormat !== 'function') {
    intl.RelativeTimeFormat = RelativeTimeFormat;
  }
}

export {RelativeTimeFormat};
