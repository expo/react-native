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

import {
  OP_CLOSE,
  OP_CUBIC,
  OP_LINE,
  OP_MOVE,
  circleCommands,
  parsePathData,
  rectCommands,
  scaleCommands,
} from '../svg/pathData';

// Walks the flat command list back into something readable, so a failure says
// which operation went wrong rather than printing forty raw numbers.
function ops(commands: Array<number>): Array<string> {
  const out = [];
  let i = 0;
  while (i < commands.length) {
    const op = commands[i];
    const n = op === OP_CLOSE ? 0 : op === OP_CUBIC ? 6 : 2;
    const name =
      op === OP_MOVE ? 'M' : op === OP_LINE ? 'L' : op === OP_CUBIC ? 'C' : 'Z';
    out.push(name + commands.slice(i + 1, i + 1 + n).join(','));
    i += 1 + n;
  }
  return out;
}

/** The end point of the last drawing command. */
function endPoint(commands: Array<number>): [number, number] {
  let i = 0;
  let point = [0, 0];
  while (i < commands.length) {
    const op = commands[i];
    const n = op === OP_CLOSE ? 0 : op === OP_CUBIC ? 6 : 2;
    if (n > 0) {
      point = [commands[i + n - 1], commands[i + n]];
    }
    i += 1 + n;
  }
  // $FlowFixMe[incompatible-return]
  return point;
}

describe('parsing SVG path data', () => {
  it('handles the icons Astryx actually ships', () => {
    // Astryx's own `close` icon: two diagonal strokes.
    expect(ops(parsePathData('M6 6l12 12M6 18L18 6'))).toEqual([
      'M6,6',
      'L18,18',
      'M6,18',
      'L18,6',
    ]);
  });

  it('treats lowercase commands as relative', () => {
    expect(ops(parsePathData('M10 10 l5 0 l0 5'))).toEqual([
      'M10,10',
      'L15,10',
      'L15,15',
    ]);
  });

  it('repeats a command while arguments remain', () => {
    // §8.3.2: one letter, many coordinate pairs.
    expect(ops(parsePathData('M0 0 L1 1 2 2 3 3'))).toEqual([
      'M0,0',
      'L1,1',
      'L2,2',
      'L3,3',
    ]);
  });

  it('treats extra pairs after a moveto as linetos', () => {
    // The subtle one in §8.3.2: `M` repeated is `L`, not another `M`.
    expect(ops(parsePathData('M0 0 1 1 2 2'))).toEqual([
      'M0,0',
      'L1,1',
      'L2,2',
    ]);
  });

  it('closes back to the subpath start, not the origin', () => {
    const commands = parsePathData('M5 5 L10 5 Z L20 20');
    // After Z the pen is at (5,5), so the following L draws from there.
    expect(ops(commands)).toEqual(['M5,5', 'L10,5', 'Z', 'L20,20']);
  });

  it('expands H and V into full linetos', () => {
    expect(ops(parsePathData('M2 3 H8 V9'))).toEqual(['M2,3', 'L8,3', 'L8,9']);
  });

  it('converts a quadratic to the exactly equivalent cubic', () => {
    // Q(0,0) control (3,3) end (6,0) has cubic controls at two thirds.
    expect(ops(parsePathData('M0 0 Q3 3 6 0'))).toEqual([
      'M0,0',
      'C2,2,4,2,6,0',
    ]);
  });

  it('reflects the control point for S', () => {
    // The second curve's first control mirrors the first curve's last.
    const commands = parsePathData('M0 0 C1 1 2 2 3 3 S5 5 6 6');
    expect(ops(commands)[2]).toBe('C4,4,5,5,6,6');
  });

  it('uses the current point for S with no preceding curve', () => {
    expect(ops(parsePathData('M1 1 S3 3 4 4'))[1]).toBe('C1,1,3,3,4,4');
  });
});

describe('arcs', () => {
  it('lands exactly on the requested end point', () => {
    // The approximation is in the middle of the curve, never the endpoints.
    const commands = parsePathData('M0 0 A5 5 0 0 1 10 0');
    const [x, y] = endPoint(commands);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('draws a straight line when a radius is zero', () => {
    // F.6.2: a zero radius degenerates to a line rather than an error.
    expect(ops(parsePathData('M0 0 A0 5 0 0 1 10 0'))).toEqual([
      'M0,0',
      'L10,0',
    ]);
  });

  it('grows radii too small to span the endpoints', () => {
    // F.6.6.2. Without the correction this produces NaN, which is how the bug
    // shows up in practice: the whole icon vanishes.
    const commands = parsePathData('M0 0 A1 1 0 0 1 10 0');
    expect(commands.every(n => Number.isFinite(n))).toBe(true);
    const [x] = endPoint(commands);
    expect(x).toBeCloseTo(10, 6);
  });

  it('takes the long way round when large-arc is set', () => {
    // The radius must EXCEED half the endpoint distance for the two arcs to
    // differ at all: at exactly half, both are the same semicircle, and an
    // earlier version of this test asserted a difference that cannot exist.
    const small = parsePathData('M0 0 A8 8 0 0 1 10 0');
    const large = parsePathData('M0 0 A8 8 0 1 1 10 0');
    expect(large.length).toBeGreaterThan(small.length);
    // Both still land on the endpoint; only the route differs.
    expect(endPoint(small)[0]).toBeCloseTo(10, 6);
    expect(endPoint(large)[0]).toBeCloseTo(10, 6);
  });
});

describe('shape primitives', () => {
  it('draws a circle that stays on its radius', () => {
    const commands = circleCommands(10, 10, 5);
    // Sample every point the path passes through; all lie on the circle.
    let i = 0;
    while (i < commands.length) {
      const op = commands[i];
      const n = op === OP_CLOSE ? 0 : op === OP_CUBIC ? 6 : 2;
      if (n > 0) {
        const x = commands[i + n - 1];
        const y = commands[i + n];
        expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(5, 6);
      }
      i += 1 + n;
    }
  });

  it('draws a plain rectangle as four corners', () => {
    expect(ops(rectCommands(1, 2, 10, 20))).toEqual([
      'M1,2',
      'L11,2',
      'L11,22',
      'L1,22',
      'Z',
    ]);
  });

  it('clamps a corner radius to half the side', () => {
    // §9.2: an rx larger than half the width is reduced, not honoured.
    const commands = rectCommands(0, 0, 10, 10, 999, 999);
    expect(commands.every(n => Number.isFinite(n))).toBe(true);
    // With rx clamped to 5 the straight top edge collapses to zero length.
    expect(ops(commands)[0]).toBe('M5,0');
  });

  it('lets one corner radius stand in for the other', () => {
    expect(ops(rectCommands(0, 0, 10, 10, 3))).toEqual(
      ops(rectCommands(0, 0, 10, 10, 3, 3)),
    );
  });
});

describe('scaling', () => {
  it('scales coordinates but leaves opcodes alone', () => {
    expect(
      ops(scaleCommands([OP_MOVE, 1, 2, OP_CUBIC, 1, 2, 3, 4, 5, 6], 2)),
    ).toEqual(['M2,4', 'C2,4,6,8,10,12']);
  });

  it('returns the input untouched at scale 1', () => {
    const commands = [OP_MOVE, 1, 2, OP_CLOSE];
    expect(scaleCommands(commands, 1)).toBe(commands);
  });
});

describe('arc flags written without separators', () => {
  // SVG defines large-arc and sweep as SINGLE CHARACTERS, so the grammar lets
  // them run together with each other and with what follows. Every solid icon
  // Astryx ships is written this way, and a plain number scanner reads "100"
  // as one hundred — geometry wrong by two orders of magnitude. It presented
  // as icons drawing lines across the entire screen.
  it('reads "100 18" as flags 1,0 then x=0 y=18', () => {
    const packed = parsePathData('M12 3a9 9 0 100 18');
    const spaced = parsePathData('M12 3a9 9 0 1 0 0 18');
    expect(packed).toEqual(spaced);
  });

  it('keeps the arc inside its viewBox', () => {
    // Astryx's `success` icon starts with this. Parsed wrongly it reaches
    // hundreds of units out of a 24-unit box.
    const commands = parsePathData('M12 3a9 9 0 100 18 9 9 0 000-18z');
    const coords = [];
    let i = 0;
    while (i < commands.length) {
      const op = commands[i];
      const n = op === OP_CLOSE ? 0 : op === OP_CUBIC ? 6 : 2;
      for (let a = 1; a <= n; a++) {
        coords.push(commands[i + a]);
      }
      i += 1 + n;
    }
    expect(Math.min(...coords)).toBeGreaterThan(-5);
    expect(Math.max(...coords)).toBeLessThan(30);
  });

  it('handles the even-odd ring from the demo', () => {
    const commands = parsePathData(
      'M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a5 5 0 110 10 5 5 0 010-10z',
    );
    expect(commands.every(n => Number.isFinite(n))).toBe(true);
    const [x, y] = endPoint(commands);
    expect(x).toBeCloseTo(12, 3);
    expect(y).toBeCloseTo(7, 3);
  });

  // Every arc test above happened to use sweep=1. Sweeping the other way makes
  // the half-angle sine negative, and the guard against dividing by zero has
  // to protect the magnitude rather than the value or the control points both
  // flip and blow up.
  it('sweeps counter-clockwise without exploding', () => {
    const commands = parsePathData('M12 3a9 9 0 100 18');
    expect(commands.every(n => Number.isFinite(n) && Math.abs(n) < 100)).toBe(
      true,
    );
    const [x, y] = endPoint(commands);
    expect(x).toBeCloseTo(12, 3);
    expect(y).toBeCloseTo(21, 3);
  });
});
