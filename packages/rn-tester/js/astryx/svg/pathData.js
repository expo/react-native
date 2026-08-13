/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

/**
 * SVG path data (`d`) reduced to a flat list of primitives.
 *
 * Parsing is the only genuinely hard part of drawing SVG, and doing it in
 * JavaScript means doing it ONCE. Native then replays three operations it
 * already has — move, line, cubic — into a `CGPath` or an
 * `android.graphics.Path`: no parser on either platform, no arc maths written
 * twice, and no way for the two to disagree.
 *
 * It also puts the difficult logic somewhere a unit test can reach, rather
 * than only a screenshot.
 *
 * Everything reduces to cubics. Quadratics are exactly representable as cubics;
 * arcs are approximated by them, following SVG 1.1 Appendix F.6.5's
 * endpoint-to-centre conversion.
 */

export const OP_MOVE = 0;
export const OP_LINE = 1;
export const OP_CUBIC = 2;
export const OP_CLOSE = 3;

// An opcode followed by its arguments. Flat rather than objects so the whole
// path crosses to native as a single array of numbers.
export type PathCommands = Array<number>;

const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

/**
 * Arc arguments, where the two flags are SINGLE DIGITS.
 *
 * `A`'s large-arc and sweep flags are defined as one character each, so the
 * grammar allows them to run together with what follows and with each other:
 * `a10 10 0 100 20` is rx=10 ry=10 rotation=0 largeArc=1 sweep=0 x=0 y=20 —
 * NOT a 100 anywhere. A plain number scanner reads "100" and produces geometry
 * that is wrong by two orders of magnitude, which is exactly how it presented:
 * icons drawing lines across the whole screen.
 *
 * Every solid icon Astryx ships is written this way, so this is the normal
 * case rather than an exotic one.
 */
function arcArguments(text: string): Array<number> {
  const out: Array<number> = [];
  let i = 0;
  const readNumber = (): number => {
    while (i < text.length && /[\s,]/.test(text[i])) {
      i++;
    }
    const match = /^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/.exec(
      text.slice(i),
    );
    if (match == null) {
      return NaN;
    }
    const text0 = match[0];
    i += text0.length;
    return parseFloat(text0);
  };
  const readFlag = (): number => {
    while (i < text.length && /[\s,]/.test(text[i])) {
      i++;
    }
    const ch = text[i];
    if (ch !== '0' && ch !== '1') {
      return NaN;
    }
    i++;
    return ch === '1' ? 1 : 0;
  };

  while (i < text.length) {
    const before = i;
    const rx = readNumber();
    const ry = readNumber();
    const rotation = readNumber();
    const largeArc = readFlag();
    const sweep = readFlag();
    const ex = readNumber();
    const ey = readNumber();
    if (
      [rx, ry, rotation, largeArc, sweep, ex, ey].some(n => Number.isNaN(n))
    ) {
      break;
    }
    out.push(rx, ry, rotation, largeArc, sweep, ex, ey);
    if (i === before) {
      break; // no progress; stop rather than spin
    }
  }
  return out;
}

function numbersIn(text: string): Array<number> {
  const out: Array<number> = [];
  NUMBER.lastIndex = 0;
  let match = NUMBER.exec(text);
  while (match != null) {
    out.push(parseFloat(match[0]));
    match = NUMBER.exec(text);
  }
  return out;
}

/**
 * One elliptical arc as a sequence of cubic Beziers.
 *
 * The arc is given by its endpoints, which must be converted to a centre
 * parameterisation before it can be split (SVG 1.1 F.6.5). F.6.6's
 * out-of-range corrections matter in practice: radii too small to span the
 * endpoints are scaled up rather than rejected, and real icon path data relies
 * on that.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  out: PathCommands,
): void {
  if (x1 === x2 && y1 === y2) {
    return; // an arc to where the pen already sits draws nothing
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    out.push(OP_LINE, x2, y2); // degenerate radii mean a straight line (F.6.2)
    return;
  }

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // F.6.6.2: grow radii that cannot reach across the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const grow = Math.sqrt(lambda);
    rx *= grow;
    ry *= grow;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const numerator = rxSq * rySq - rxSq * y1p * y1p - rySq * x1p * x1p;
  const denominator = rxSq * y1p * y1p + rySq * x1p * x1p;
  let coefficient = Math.sqrt(Math.max(0, numerator / denominator));
  if (largeArc === sweep) {
    coefficient = -coefficient;
  }
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleBetween = (
    ux: number,
    uy: number,
    vx: number,
    vy: number,
  ): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let angle = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) {
      angle = -angle;
    }
    return angle;
  };

  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let sweepAngle = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && sweepAngle > 0) {
    sweepAngle -= 2 * Math.PI;
  } else if (sweep && sweepAngle < 0) {
    sweepAngle += 2 * Math.PI;
  }

  // Split into segments of at most 90 degrees, where the standard cubic
  // approximation of a circular arc stays within a fraction of a pixel.
  const segments = Math.max(1, Math.ceil(Math.abs(sweepAngle / (Math.PI / 2))));
  const delta = sweepAngle / segments;
  // Guard the MAGNITUDE, not the value. A negative sweep gives a negative
  // sine, and clamping that to a tiny positive number both flips the control
  // points and divides by ~0 — coordinates came out at 3.5e12, which drew the
  // icon as lines across the whole screen.
  const sinHalf = Math.sin(delta / 2);
  const alpha =
    Math.abs(sinHalf) < 1e-12
      ? 0
      : ((4 / 3) * (1 - Math.cos(delta / 2))) / sinHalf;

  const toUser = (ex: number, ey: number): [number, number] => [
    cx + cosPhi * rx * ex - sinPhi * ry * ey,
    cy + sinPhi * rx * ex + cosPhi * ry * ey,
  ];
  const rotate = (vx: number, vy: number): [number, number] => [
    cosPhi * vx - sinPhi * vy,
    sinPhi * vx + cosPhi * vy,
  ];

  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const next = theta + delta;
    const [px, py] = toUser(Math.cos(theta), Math.sin(theta));
    const [qx, qy] = toUser(Math.cos(next), Math.sin(next));
    const [dpx, dpy] = rotate(-rx * Math.sin(theta), ry * Math.cos(theta));
    const [dqx, dqy] = rotate(-rx * Math.sin(next), ry * Math.cos(next));
    out.push(
      OP_CUBIC,
      px + alpha * dpx,
      py + alpha * dpy,
      qx - alpha * dqx,
      qy - alpha * dqy,
      qx,
      qy,
    );
    theta = next;
  }
}

/**
 * Parses SVG path data into primitives.
 *
 * A malformed `d` draws what it can rather than throwing, which is what
 * browsers do: SVG 1.1 §8.3.1 says to render up to the point of the error.
 */
export function parsePathData(d: string): PathCommands {
  const out: PathCommands = [];
  if (d == null || d === '') {
    return out;
  }
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g);
  if (tokens == null) {
    return out;
  }

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Reflected control point for S/s and T/t (SVG 1.1 §8.3.6).
  let controlX = 0;
  let controlY = 0;
  let afterCubic = false;
  let afterQuadratic = false;

  const quadraticAsCubic = (cx: number, cy: number, ex: number, ey: number) => {
    // Exact, not an approximation: a quadratic IS a cubic whose controls sit
    // two thirds of the way from each endpoint toward the quadratic's control.
    out.push(
      OP_CUBIC,
      x + (2 / 3) * (cx - x),
      y + (2 / 3) * (cy - y),
      ex + (2 / 3) * (cx - ex),
      ey + (2 / 3) * (cy - ey),
      ex,
      ey,
    );
  };

  for (const token of tokens) {
    const letter = token[0];
    const relative = letter === letter.toLowerCase();
    const upper = letter.toUpperCase();
    const args =
      upper === 'A' ? arcArguments(token.slice(1)) : numbersIn(token.slice(1));

    if (upper === 'Z') {
      out.push(OP_CLOSE);
      x = startX;
      y = startY;
      afterCubic = false;
      afterQuadratic = false;
      continue;
    }

    // Every command but Z repeats while arguments remain (§8.3.2).
    let i = 0;
    let first = true;
    while (i < args.length) {
      if (upper === 'M') {
        const nx = relative ? x + args[i] : args[i];
        const ny = relative ? y + args[i + 1] : args[i + 1];
        i += 2;
        if (first) {
          out.push(OP_MOVE, nx, ny);
          startX = nx;
          startY = ny;
        } else {
          // Extra pairs after a moveto are implicit linetos (§8.3.2).
          out.push(OP_LINE, nx, ny);
        }
        x = nx;
        y = ny;
        afterCubic = false;
        afterQuadratic = false;
      } else if (upper === 'L') {
        x = relative ? x + args[i] : args[i];
        y = relative ? y + args[i + 1] : args[i + 1];
        i += 2;
        out.push(OP_LINE, x, y);
        afterCubic = false;
        afterQuadratic = false;
      } else if (upper === 'H') {
        x = relative ? x + args[i] : args[i];
        i += 1;
        out.push(OP_LINE, x, y);
        afterCubic = false;
        afterQuadratic = false;
      } else if (upper === 'V') {
        y = relative ? y + args[i] : args[i];
        i += 1;
        out.push(OP_LINE, x, y);
        afterCubic = false;
        afterQuadratic = false;
      } else if (upper === 'C' || upper === 'S') {
        let c1x;
        let c1y;
        let c2x;
        let c2y;
        let ex;
        let ey;
        if (upper === 'C') {
          c1x = relative ? x + args[i] : args[i];
          c1y = relative ? y + args[i + 1] : args[i + 1];
          c2x = relative ? x + args[i + 2] : args[i + 2];
          c2y = relative ? y + args[i + 3] : args[i + 3];
          ex = relative ? x + args[i + 4] : args[i + 4];
          ey = relative ? y + args[i + 5] : args[i + 5];
          i += 6;
        } else {
          // S's first control mirrors the previous curve's last one; with no
          // previous curve it coincides with the current point.
          c1x = afterCubic ? 2 * x - controlX : x;
          c1y = afterCubic ? 2 * y - controlY : y;
          c2x = relative ? x + args[i] : args[i];
          c2y = relative ? y + args[i + 1] : args[i + 1];
          ex = relative ? x + args[i + 2] : args[i + 2];
          ey = relative ? y + args[i + 3] : args[i + 3];
          i += 4;
        }
        out.push(OP_CUBIC, c1x, c1y, c2x, c2y, ex, ey);
        controlX = c2x;
        controlY = c2y;
        x = ex;
        y = ey;
        afterCubic = true;
        afterQuadratic = false;
      } else if (upper === 'Q' || upper === 'T') {
        let cx;
        let cy;
        let ex;
        let ey;
        if (upper === 'Q') {
          cx = relative ? x + args[i] : args[i];
          cy = relative ? y + args[i + 1] : args[i + 1];
          ex = relative ? x + args[i + 2] : args[i + 2];
          ey = relative ? y + args[i + 3] : args[i + 3];
          i += 4;
        } else {
          cx = afterQuadratic ? 2 * x - controlX : x;
          cy = afterQuadratic ? 2 * y - controlY : y;
          ex = relative ? x + args[i] : args[i];
          ey = relative ? y + args[i + 1] : args[i + 1];
          i += 2;
        }
        quadraticAsCubic(cx, cy, ex, ey);
        controlX = cx;
        controlY = cy;
        x = ex;
        y = ey;
        afterCubic = false;
        afterQuadratic = true;
      } else if (upper === 'A') {
        const rx = args[i];
        const ry = args[i + 1];
        const rotation = args[i + 2];
        const largeArc = args[i + 3] !== 0;
        const sweep = args[i + 4] !== 0;
        const ex = relative ? x + args[i + 5] : args[i + 5];
        const ey = relative ? y + args[i + 6] : args[i + 6];
        i += 7;
        // args for A came from `arcArguments`, which knows the flags are
        // single digits — see the note there.
        arcToCubics(x, y, rx, ry, rotation, largeArc, sweep, ex, ey, out);
        x = ex;
        y = ey;
        afterCubic = false;
        afterQuadratic = false;
      } else {
        return out; // unknown command: keep what was drawn so far
      }

      first = false;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        return out; // ran off the end of a truncated argument list
      }
    }
  }

  return out;
}

/** `<circle>`, as two half arcs — exact, not a polygon. */
export function circleCommands(
  cx: number,
  cy: number,
  r: number,
): PathCommands {
  const out: PathCommands = [];
  if (!(r > 0)) {
    return out;
  }
  out.push(OP_MOVE, cx + r, cy);
  arcToCubics(cx + r, cy, r, r, 0, false, true, cx - r, cy, out);
  arcToCubics(cx - r, cy, r, r, 0, false, true, cx + r, cy, out);
  out.push(OP_CLOSE);
  return out;
}

/** `<rect>`, with optional corner radii (SVG 1.1 §9.2). */
export function rectCommands(
  x: number,
  y: number,
  width: number,
  height: number,
  rxIn: number = 0,
  ryIn: number = 0,
): PathCommands {
  const out: PathCommands = [];
  if (!(width > 0) || !(height > 0)) {
    return out;
  }
  // An omitted radius takes the other's value, and neither may exceed half the
  // side it rounds (§9.2).
  let rx = rxIn > 0 ? rxIn : ryIn;
  let ry = ryIn > 0 ? ryIn : rxIn;
  rx = Math.min(rx, width / 2);
  ry = Math.min(ry, height / 2);

  if (!(rx > 0) || !(ry > 0)) {
    out.push(OP_MOVE, x, y);
    out.push(OP_LINE, x + width, y);
    out.push(OP_LINE, x + width, y + height);
    out.push(OP_LINE, x, y + height);
    out.push(OP_CLOSE);
    return out;
  }

  const right = x + width;
  const bottom = y + height;
  out.push(OP_MOVE, x + rx, y);
  out.push(OP_LINE, right - rx, y);
  arcToCubics(right - rx, y, rx, ry, 0, false, true, right, y + ry, out);
  out.push(OP_LINE, right, bottom - ry);
  arcToCubics(
    right,
    bottom - ry,
    rx,
    ry,
    0,
    false,
    true,
    right - rx,
    bottom,
    out,
  );
  out.push(OP_LINE, x + rx, bottom);
  arcToCubics(x + rx, bottom, rx, ry, 0, false, true, x, bottom - ry, out);
  out.push(OP_LINE, x, y + ry);
  arcToCubics(x, y + ry, rx, ry, 0, false, true, x + rx, y, out);
  out.push(OP_CLOSE);
  return out;
}

/** `<line>` — the last shape `packages/core` uses. */
export function lineCommands(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): PathCommands {
  return [OP_MOVE, x1, y1, OP_LINE, x2, y2];
}

/**
 * Scales every coordinate, for `viewBox` to rendered size.
 *
 * Done to the coordinates rather than as a native transform so the stroke can
 * be scaled separately and deliberately. A transform would scale the stroke by
 * the same factor whether or not that is wanted; here the caller decides.
 */
export function scaleCommands(
  commands: PathCommands,
  scale: number,
): PathCommands {
  if (scale === 1) {
    return commands;
  }
  const out: PathCommands = [];
  let i = 0;
  while (i < commands.length) {
    const op = commands[i];
    out.push(op);
    const argCount = op === OP_CLOSE ? 0 : op === OP_CUBIC ? 6 : 2;
    for (let a = 1; a <= argCount; a++) {
      out.push(commands[i + a] * scale);
    }
    i += 1 + argCount;
  }
  return out;
}
