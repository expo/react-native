/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

/**
 * Parses `color()`, `lab()`, `lch()`, `oklab()` and `oklch()` (CSS Color 4),
 * the `rec2100-*` spaces (CSS Color HDR) and dashed names for standard spaces
 * CSS doesn't predefine, into `{space, …channels, alpha}` with the channels
 * named as CSS Color 5 §4 names them. The color stays in its own space,
 * unclipped, with only CSS's parsed-value changes applied (percentages to
 * numbers, `none` to 0, `xyz` to `xyz-d65`, hues to [0, 360), lightness and
 * alpha clamped). Null for anything else, including the legacy sRGB forms.
 */
function normalizeColorSpace(color) {
  if (typeof color !== 'string') {
    return null;
  }
  if (cachedColors.has(color)) {
    // Re-inserting on a hit keeps the least-recently-used entry first
    const cached = cachedColors.get(color);
    cachedColors.delete(color);
    cachedColors.set(color, cached);
    return cached;
  }
  const normalized = parseColor(color);
  if (cachedColors.size >= 1024) {
    cachedColors.delete(cachedColors.keys().next().value);
  }
  cachedColors.set(color, normalized);
  return normalized;
}

const cachedColors = new Map();

function parseColor(color) {
  const parsed = parseFunction(color);
  if (parsed == null) {
    return null;
  }
  const {name, args} = parsed;
  switch (name) {
    case 'color':
      return parseColorFunction(args);
    case 'lab':
      return parseLabLike(args, 'lab', LAB);
    case 'oklab':
      return parseLabLike(args, 'oklab', OKLAB);
    case 'lch':
      return parseLchLike(args, 'lch', LAB);
    case 'oklch':
      return parseLchLike(args, 'oklch', OKLAB);
    default:
      return null;
  }
}

// The RGB spaces `color()` names; which ones a device shows is the platform's answer
const RGB_SPACES = new Set([
  'srgb',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'rec2100-pq',
  'rec2100-hlg',
  'rec2100-linear',
  '--dci-p3',
  '--rec709',
  '--rec2020-srgb-transfer',
  '--rec2020-linear',
  '--display-p3-pq',
  '--display-p3-hlg',
  '--rec709-pq',
  '--rec709-hlg',
  '--aces',
  '--aces-cg',
  '--ntsc-1953',
  '--smpte-c',
]);

// One-channel (gray) spaces cross as an RGB triple of that value
const GRAY_SPACES = new Set(['--gray-gamma-2.2', '--gray-linear']);

const XYZ_SPACES = new Set(['xyz', 'xyz-d50', 'xyz-d65']);

// The reference ranges percentages resolve against (CSS Color 4 §8 and §9)
const LAB = {lightness: 100, ab: 125, chroma: 150};
const OKLAB = {lightness: 1, ab: 0.4, chroma: 0.4};

/**
 * `color( <colorspace-params> [ / [ <alpha-value> | none ] ]? )`
 * https://www.w3.org/TR/css-color-4/#color-function
 */
function parseColorFunction(args) {
  const [channels, alpha] = splitAlpha(args);
  if (channels == null || channels.length === 0) {
    return null;
  }
  const [spaceToken, ...values] = channels;
  if (spaceToken.type !== 'ident') {
    return null;
  }
  const space = spaceToken.dashed
    ? spaceToken.value
    : spaceToken.value.toLowerCase();
  const parsedAlpha = parseAlpha(alpha);
  if (parsedAlpha == null) {
    return null;
  }

  if (GRAY_SPACES.has(space)) {
    if (values.length !== 1) {
      return null;
    }
    const gray = parseChannel(values[0], 1);
    if (gray == null) {
      return null;
    }
    return {space, r: gray, g: gray, b: gray, alpha: parsedAlpha};
  }

  if (values.length !== 3) {
    return null;
  }
  // In `color()` every channel is a number, or a percentage of 1
  const [c0, c1, c2] = values.map(value => parseChannel(value, 1));
  if (c0 == null || c1 == null || c2 == null) {
    return null;
  }
  if (RGB_SPACES.has(space)) {
    return {space, r: c0, g: c1, b: c2, alpha: parsedAlpha};
  }
  if (XYZ_SPACES.has(space)) {
    return {
      space: space === 'xyz' ? 'xyz-d65' : space,
      x: c0,
      y: c1,
      z: c2,
      alpha: parsedAlpha,
    };
  }
  return null;
}

/**
 * `lab()` and `oklab()`: lightness, then the a and b axes.
 * https://www.w3.org/TR/css-color-4/#specifying-lab-lch
 */
function parseLabLike(args, space, ranges) {
  const [channels, alpha] = splitAlpha(args);
  if (channels == null || channels.length !== 3) {
    return null;
  }
  const l = parseChannel(channels[0], ranges.lightness);
  const a = parseChannel(channels[1], ranges.ab);
  const b = parseChannel(channels[2], ranges.ab);
  const parsedAlpha = parseAlpha(alpha);
  if (l == null || a == null || b == null || parsedAlpha == null) {
    return null;
  }
  return {
    space,
    l: clamp(l, 0, ranges.lightness),
    a,
    b,
    alpha: parsedAlpha,
  };
}

/**
 * `lch()` and `oklch()`: lightness, chroma, then a hue.
 * https://www.w3.org/TR/css-color-4/#specifying-lab-lch
 */
function parseLchLike(args, space, ranges) {
  const [channels, alpha] = splitAlpha(args);
  if (channels == null || channels.length !== 3) {
    return null;
  }
  const l = parseChannel(channels[0], ranges.lightness);
  const c = parseChannel(channels[1], ranges.chroma);
  const h = parseHue(channels[2]);
  const parsedAlpha = parseAlpha(alpha);
  if (l == null || c == null || h == null || parsedAlpha == null) {
    return null;
  }
  return {
    space,
    l: clamp(l, 0, ranges.lightness),
    c: Math.max(c, 0),
    h,
    alpha: parsedAlpha,
  };
}

// Splits `a b c / d` into the channels and the alpha token, if any
function splitAlpha(args) {
  const slash = args.findIndex(token => token.type === 'slash');
  if (slash === -1) {
    return [args, null];
  }
  if (slash !== args.length - 2) {
    return [null, null];
  }
  return [args.slice(0, slash), args[slash + 1]];
}

/*
 * A channel: a number, a percentage of `percentReference`, or `none`, which is
 * 0 from parsing on, so it can't take the other color's value in an
 * interpolation (CSS Color 4 §12.2).
 * DOM-CSS-LIMITATION(missing-color-components-are-zero)
 */
function parseChannel(token, percentReference) {
  switch (token.type) {
    case 'number':
      return Number.isFinite(token.value) ? token.value : null;
    case 'percentage':
      return Number.isFinite(token.value)
        ? (token.value / 100) * percentReference
        : null;
    case 'ident':
      return token.value.toLowerCase() === 'none' ? 0 : null;
    default:
      return null;
  }
}

// `<alpha-value> | none`, clamped to [0, 1]; 1 when absent
function parseAlpha(token) {
  if (token == null) {
    return 1;
  }
  const alpha = parseChannel(token, 1);
  return alpha == null ? null : clamp(alpha, 0, 1);
}

const DEGREES_PER_UNIT = {
  deg: 1,
  grad: 360 / 400,
  rad: 180 / Math.PI,
  turn: 360,
};

// `<hue> | none`: a number of degrees or an angle, normalized to [0, 360)
function parseHue(token) {
  let degrees;
  if (token.type === 'number') {
    degrees = token.value;
  } else if (token.type === 'dimension') {
    const perUnit = DEGREES_PER_UNIT[token.unit.toLowerCase()];
    if (perUnit == null) {
      return null;
    }
    degrees = token.value * perUnit;
  } else if (token.type === 'ident' && token.value.toLowerCase() === 'none') {
    return 0;
  } else {
    return null;
  }
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// css-syntax-3's number: digits, or digits with a dot FOLLOWED by digits, so
// `1.` is not a number, then an optional exponent
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?/i;
const IDENT_PATTERN = /^-?-?[a-zA-Z_][a-zA-Z0-9_.-]*|^--[a-zA-Z0-9_.-]+/;

/*
 * Splits `name( … )` into the lowercased name and its argument tokens. Dashed
 * identifiers keep their case (CSS custom identifiers are case-sensitive);
 * a comma makes the color invalid, as no modern color syntax has one.
 */
function parseFunction(color) {
  const text = color.trim();
  const open = text.indexOf('(');
  if (open <= 0 || text[text.length - 1] !== ')') {
    return null;
  }
  const name = text.slice(0, open).toLowerCase();
  const body = text.slice(open + 1, -1);
  const args = [];
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    // CSS's whitespace: space, tab, newline, and the CR and FF its
    // preprocessing turns into newlines
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === '\f'
    ) {
      index++;
      continue;
    }
    if (char === '/') {
      args.push({type: 'slash'});
      index++;
      continue;
    }
    const rest = body.slice(index);
    const number = NUMBER_PATTERN.exec(rest);
    if (number != null) {
      const value = parseFloat(number[0]);
      index += number[0].length;
      if (body[index] === '%') {
        args.push({type: 'percentage', value});
        index++;
        continue;
      }
      const unit = /^[a-zA-Z]+/.exec(body.slice(index));
      if (unit != null) {
        args.push({type: 'dimension', value, unit: unit[0]});
        index += unit[0].length;
        continue;
      }
      args.push({type: 'number', value});
      continue;
    }
    const ident = IDENT_PATTERN.exec(rest);
    if (ident != null) {
      args.push({
        type: 'ident',
        value: ident[0],
        dashed: ident[0].startsWith('--'),
      });
      index += ident[0].length;
      continue;
    }
    return null;
  }
  return {name, args};
}

module.exports = normalizeColorSpace;
