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

/**
 * `color-mix()` (css-color-5 §3).
 *
 * Astryx uses it 39 times — 37 in `srgb`, 2 in `oklab` — almost all of them to
 * tint a token toward a hover colour or fade one toward `transparent`.
 *
 * Two parts of the spec are easy to skip and wrong to:
 *
 *  - **Mixing is premultiplied.** Fading a colour toward `transparent` means
 *    mixing with `rgba(0,0,0,0)`. Mixed straight, the channels drag toward
 *    black and a 50% red comes out dark red at half alpha instead of red at
 *    half alpha. Premultiplying by alpha first is what keeps the hue.
 *  - **Percentages that do not sum to 100 are not an error.** They are
 *    normalised, and if they sum to LESS than 100 the shortfall becomes
 *    transparency (§3.2). `color-mix(in srgb, red 30%, blue 30%)` is a 50/50
 *    mix at 60% alpha, not a mistake.
 */

import {processColor} from 'react-native';

type Rgba = {r: number, g: number, b: number, a: number};

/**
 * Parses any colour React Native understands, since that is exactly the set
 * the surrounding style values may contain.
 */
export function parseColor(value: string): ?Rgba {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  // `transparent` is rgba(0,0,0,0) — a real colour, not "no colour", and the
  // premultiplied mix below depends on that.
  const processed = processColor(trimmed);
  if (typeof processed !== 'number') {
    return null;
  }
  // Unpacking a packed ARGB int is what bit operations are for; React
  // Native's own colour code does the same.
  /* eslint-disable no-bitwise */
  return {
    a: ((processed >> 24) & 0xff) / 255,
    r: ((processed >> 16) & 0xff) / 255,
    g: ((processed >> 8) & 0xff) / 255,
    b: (processed & 0xff) / 255,
  };
  /* eslint-enable no-bitwise */
}

function toCssRgba({r, g, b, a}: Rgba): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)));
  // Emitted as rgba() rather than a number so the result can flow back into
  // the same resolution pipeline as any other colour value.
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Number(
    a.toFixed(4),
  )})`;
}

// --- oklab, for the two call sites that ask for it -------------------------
// sRGB -> linear -> LMS -> OKLab and back (Björn Ottosson's matrices). Mixing
// in a perceptual space is the whole reason to ask for oklab, so approximating
// it with an sRGB mix would quietly return the wrong colour.

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * Mixes two colours in the given space.
 *
 * `p1` and `p2` are the raw percentages as authored, either of which may be
 * null for "not stated".
 */
export function mixColors(
  space: string,
  c1: Rgba,
  p1: ?number,
  c2: Rgba,
  p2: ?number,
): ?Rgba {
  // §3.2: an omitted percentage is whatever the other leaves; both omitted is
  // an even mix.
  // css-color-5 §3.1 types these as <percentage [0,100]>. Out of range makes
  // the whole function invalid — NOT something to normalise. Verified against
  // Safari: `color-mix(in srgb, red 150%, blue 50%)` drops the declaration
  // entirely, while an in-range pair summing above 100 (60% + 60%) IS
  // normalised to an even mix. An earlier version here normalised both, and a
  // test asserted that as correct.
  const outOfRange = (p: ?number) => p != null && (p < 0 || p > 100);
  if (outOfRange(p1) || outOfRange(p2)) {
    return null;
  }

  const neitherStated = p1 == null && p2 == null;
  const w1: number = neitherStated ? 50 : p1 != null ? p1 : 100 - (p2 ?? 0);
  const w2: number = neitherStated ? 50 : p2 != null ? p2 : 100 - (p1 ?? 0);
  const sum = w1 + w2;
  if (!(sum > 0)) {
    return null; // two zero percentages have no meaning
  }
  // A shortfall below 100 becomes transparency; an excess is just normalised.
  const alphaScale = sum < 100 ? sum / 100 : 1;
  const n1 = w1 / sum;
  const n2 = w2 / sum;

  const alpha = c1.a * n1 + c2.a * n2;

  if (space === 'oklab') {
    const [l1, a1, b1] = rgbToOklab(c1.r, c1.g, c1.b);
    const [l2, a2, b2] = rgbToOklab(c2.r, c2.g, c2.b);
    const [r, g, b] = oklabToRgb(
      l1 * n1 + l2 * n2,
      a1 * n1 + a2 * n2,
      b1 * n1 + b2 * n2,
    );
    return {r, g, b, a: alpha * alphaScale};
  }

  // srgb, premultiplied. Un-premultiplying at the end is what stops a mix with
  // `transparent` from dragging the colour toward black.
  const pr = c1.r * c1.a * n1 + c2.r * c2.a * n2;
  const pg = c1.g * c1.a * n1 + c2.g * c2.a * n2;
  const pb = c1.b * c1.a * n1 + c2.b * c2.a * n2;
  if (alpha === 0) {
    return {r: 0, g: 0, b: 0, a: 0};
  }
  return {
    r: pr / alpha,
    g: pg / alpha,
    b: pb / alpha,
    a: alpha * alphaScale,
  };
}

/**
 * Splits `red 30%` into its colour and percentage.
 *
 * The percentage may lead or trail (`30% red` is valid), so this looks for a
 * percentage token anywhere rather than assuming a position.
 */
function splitColorAndPercentage(text: string): {color: string, pct: ?number} {
  const match = text.match(/(^|\s)([+-]?[\d.]+)%(\s|$)/);
  if (match == null) {
    return {color: text.trim(), pct: null};
  }
  const pct = parseFloat(match[2]);
  const color = (
    text.slice(0, match.index) +
    text.slice((match.index ?? 0) + match[0].length)
  ).trim();
  return {color, pct: Number.isFinite(pct) ? pct : null};
}

/**
 * Resolves one `color-mix(...)` body (everything between the parentheses).
 *
 * Returns null when it cannot — an unresolved `var()`, an unknown colour — so
 * the caller can leave the expression alone rather than emit a wrong colour.
 */
export function resolveColorMixArgs(args: string): ?string {
  const parts = splitTopLevel(args);
  if (parts.length !== 3) {
    return null;
  }
  const spaceMatch = parts[0].trim().match(/^in\s+([a-z-]+)$/);
  if (spaceMatch == null) {
    return null;
  }
  const space = spaceMatch[1];
  if (space !== 'srgb' && space !== 'oklab') {
    // Every other space (lch, hsl, display-p3…) is unused by Astryx and would
    // need its own conversion; refusing beats guessing.
    // DOM-CSS-LIMITATION(color-mix-spaces)
    return null;
  }

  const first = splitColorAndPercentage(parts[1]);
  const second = splitColorAndPercentage(parts[2]);
  const c1 = parseColor(first.color);
  const c2 = parseColor(second.color);
  if (c1 == null || c2 == null) {
    return null;
  }
  const mixed = mixColors(space, c1, first.pct, c2, second.pct);
  return mixed == null ? null : toCssRgba(mixed);
}

/** Splits on commas that are not inside nested parentheses. */
export function splitTopLevel(text: string): Array<string> {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}
