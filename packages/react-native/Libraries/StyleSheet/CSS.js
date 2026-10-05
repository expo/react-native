/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import NativeDisplayCapabilities from '../Utilities/NativeDisplayCapabilities';
import processColor from './processColor';

/**
 * `CSS.supports` (css-conditional-3 §6) for what this renderer draws: colors,
 * in the spaces CSS defines and the platform spaces this device provides, on
 * the color properties it has, and `dynamic-range-limit`. Any other property
 * is unsupported, as the web answers for a property it doesn't implement.
 *
 *   CSS.supports('color', 'color(--dci-p3 1 0 0)')
 *   CSS.supports('(color: red) and (not (color: nonsense))')
 */
const CSS = {
  supports(propertyOrCondition: string, value?: string): boolean {
    if (value === undefined) {
      return supportsConditionText(propertyOrCondition);
    }
    return supportsDeclaration(propertyOrCondition, value);
  },
};

// The color properties this renderer draws, in CSS's names
const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'accent-color',
]);

const DYNAMIC_RANGE_LIMITS = new Set(['no-limit', 'constrained', 'standard']);

// The property is matched as written, without trimming (css-conditional-3 §6.1)
function supportsDeclaration(property: string, value: string): boolean {
  const name = property.toLowerCase();
  if (COLOR_PROPERTIES.has(name)) {
    return supportsColor(value.trim());
  }
  if (name === 'dynamic-range-limit') {
    return DYNAMIC_RANGE_LIMITS.has(value.trim().toLowerCase());
  }
  return false;
}

// The OS is asked about every space: Android before 8 has none, and a dashed
// space exists only where the OS provides it
function supportsColor(value: string): boolean {
  if (value === '') {
    return false;
  }
  const color = processColor(value);
  if (color == null) {
    return false;
  }
  if (typeof color === 'object' && typeof color.space === 'string') {
    return (
      NativeDisplayCapabilities?.isColorSpaceAvailable(color.space) === true
    );
  }
  return true;
}

// A `<supports-condition>`, else the text wrapped in parentheses, as the spec says
function supportsConditionText(text: string): boolean {
  const condition = text.trim();
  const parsed = parseCondition(condition);
  if (parsed != null) {
    return parsed;
  }
  return parseCondition(`(${condition})`) ?? false;
}

// `not <in-parens>`, or `<in-parens>` joined by all `and` or all `or`; null
// where the text isn't a condition
function parseCondition(text: string): ?boolean {
  const terms = splitTopLevel(text);
  if (terms.length === 0) {
    return null;
  }
  if (terms.length === 1) {
    return parseInParens(terms[0]);
  }
  if (terms[0].toLowerCase() === 'not' && terms.length === 2) {
    const inner = parseInParens(terms[1]);
    return inner == null ? null : !inner;
  }
  // `a and b and c`, or `a or b or c`, never mixed
  if (terms.length % 2 === 0) {
    return null;
  }
  const operator = terms[1].toLowerCase();
  if (operator !== 'and' && operator !== 'or') {
    return null;
  }
  const values = [];
  for (let i = 0; i < terms.length; i++) {
    if (i % 2 === 1) {
      if (terms[i].toLowerCase() !== operator) {
        return null;
      }
      continue;
    }
    const value = parseInParens(terms[i]);
    if (value == null) {
      return null;
    }
    values.push(value);
  }
  return operator === 'and' ? values.every(Boolean) : values.some(Boolean);
}

function parseInParens(text: string): ?boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) {
    return null;
  }
  const inner = text.slice(1, -1).trim();
  // A nested condition first, then a declaration
  const nested = parseCondition(inner);
  if (nested != null) {
    return nested;
  }
  const colon = inner.indexOf(':');
  if (colon < 0) {
    // `<general-enclosed>` is valid and false, so `not (future-feature)` is true
    return false;
  }
  return supportsDeclaration(
    inner.slice(0, colon).trim(),
    inner.slice(colon + 1),
  );
}

// The top-level terms: parenthesised groups and the words between them
function splitTopLevel(text: string): Array<string> {
  const terms = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') {
      if (depth === 0) {
        if (start >= 0) {
          terms.push(text.slice(start, i).trim());
        }
        start = i;
      }
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return [];
      }
      if (depth === 0) {
        terms.push(text.slice(start, i + 1));
        start = -1;
      }
    } else if (depth === 0) {
      if (/\s/.test(char)) {
        if (start >= 0) {
          terms.push(text.slice(start, i));
          start = -1;
        }
      } else if (start < 0) {
        start = i;
      }
    }
  }
  if (depth !== 0) {
    return [];
  }
  if (start >= 0) {
    terms.push(text.slice(start));
  }
  return terms.filter(term => term !== '');
}

export default CSS;
