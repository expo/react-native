/**
 * Turns measured rects into the quantities three different text engines can
 * actually be compared on.
 *
 * Nothing here looks at an absolute coordinate unless CSS fixes it outright.
 * Safari, CoreText and `android.text.Layout` shape with different fonts, so
 * every position and size that depends on shaping differs between them by a
 * few points, always. Comparing those numbers directly produces a wall of
 * failures that say nothing. What they must agree on is:
 *
 *   - the STRUCTURE — which boxes share a line, which sit above which, which
 *     contain which. Font metrics move lines around; they do not change how
 *     many there are or what is on them. This is the `signature`.
 *   - the ABSOLUTES that CSS pins regardless of font — a block child's width,
 *     a sized atomic inline, a padding offset. These are the `assert` entries
 *     on a case, checked against each engine separately.
 *   - the DIFFERENCES between a case and a baseline that differs from it by
 *     one property. Neither number is font-independent; the delta is.
 *
 * @noflow
 * @format
 */

'use strict';

// Half a point. Safari reports fractional CSS pixels; the native engines round
// run origins to the pixel grid, so anything tighter than this is noise.
const EPS = 0.75;

// Two boxes are on the same line when they overlap vertically by most of the
// shorter one. A generous threshold on purpose: a 10pt inline-block and a 19pt
// line box legitimately share a line while overlapping by only half the taller.
const SAME_LINE_OVERLAP = 0.6;

function bottom(r) {
  return r.y + r.h;
}
function right(r) {
  return r.x + r.w;
}

function contains(outer, inner) {
  return (
    outer.x <= inner.x + EPS &&
    outer.y <= inner.y + EPS &&
    right(outer) >= right(inner) - EPS &&
    bottom(outer) >= bottom(inner) - EPS
  );
}

function verticalOverlap(a, b) {
  return Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
}

function sameLine(a, b) {
  const shorter = Math.min(a.h, b.h);
  if (shorter <= 0) {
    // A zero-height probe (an empty inline) is on the line its position sits in.
    return a.y >= b.y - EPS && a.y <= bottom(b) + EPS;
  }
  return verticalOverlap(a, b) >= shorter * SAME_LINE_OVERLAP;
}

/**
 * The one relation between two probes, chosen so that exactly one applies and
 * the reverse of `above` is `below`. `contains` wins over `same-line` because
 * a nested inline both overlaps its parent's line and sits inside its box, and
 * containment is the more specific thing to have got right.
 */
function relation(a, b) {
  if (contains(a, b) && !contains(b, a)) {
    return 'contains';
  }
  if (contains(b, a) && !contains(a, b)) {
    return 'inside';
  }
  if (sameLine(a, b)) {
    if (right(a) <= b.x + EPS) {
      return 'line-before';
    }
    if (right(b) <= a.x + EPS) {
      return 'line-after';
    }
    return 'line-overlap';
  }
  if (bottom(a) <= b.y + EPS) {
    return 'above';
  }
  if (bottom(b) <= a.y + EPS) {
    return 'below';
  }
  return 'partial';
}

/**
 * Every pairwise relation, canonically ordered — the structural fingerprint of
 * a case. Two engines that agree on this laid the content out the same way,
 * whatever their fonts did to the coordinates.
 */
function signature(measurement) {
  const ids = Object.keys(measurement.probes).sort();
  const parts = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      parts.push(
        `${ids[i]}|${ids[j]}=${relation(
          measurement.probes[ids[i]],
          measurement.probes[ids[j]],
        )}`,
      );
    }
  }
  return parts.join(' ');
}

function near(a, b, eps = EPS) {
  return Math.abs(a - b) <= eps;
}

/**
 * Evaluates one case's `assert` entries against one engine's measurement.
 * Returns the failures, so an empty array means the engine satisfied the case
 * on its own terms — before any cross-engine comparison happens.
 */
function checkAsserts(c, measurement, contentWidth) {
  const failures = [];
  const probe = id => {
    const r = measurement.probes[id];
    if (r == null) {
      failures.push(`no probe "${id}" was measured`);
    }
    return r;
  };

  for (const a of c.assert ?? []) {
    switch (a.kind) {
      case 'fillsContentWidth': {
        const r = probe(a.id);
        if (r && !near(r.w, contentWidth)) {
          failures.push(
            `${a.id} should fill the content width ${contentWidth}, is ${r.w.toFixed(2)}`,
          );
        }
        break;
      }
      case 'atContentTop': {
        const r = probe(a.id);
        if (r && !near(r.y, contentTop(c))) {
          failures.push(
            `${a.id} should sit at the content top ${contentTop(c)}, is ${r.y.toFixed(2)}`,
          );
        }
        break;
      }
      case 'size': {
        const r = probe(a.id);
        if (r && a.width != null && !near(r.w, a.width)) {
          failures.push(`${a.id} width should be ${a.width}, is ${r.w.toFixed(2)}`);
        }
        if (r && a.height != null && !near(r.h, a.height)) {
          failures.push(`${a.id} height should be ${a.height}, is ${r.h.toFixed(2)}`);
        }
        break;
      }
      case 'offset': {
        const r = probe(a.id);
        if (r && a.x != null && !near(r.x, a.x)) {
          failures.push(`${a.id} x should be ${a.x}, is ${r.x.toFixed(2)}`);
        }
        if (r && a.y != null && !near(r.y, a.y)) {
          failures.push(`${a.id} y should be ${a.y}, is ${r.y.toFixed(2)}`);
        }
        break;
      }
      case 'sameLine': {
        const a1 = probe(a.id);
        const b1 = probe(a.of);
        if (a1 && b1 && !sameLine(a1, b1)) {
          failures.push(`${a.id} and ${a.of} should share a line`);
        }
        break;
      }
      case 'below': {
        const a1 = probe(a.id);
        const b1 = probe(a.of);
        if (a1 && b1 && !(a1.y >= bottom(b1) - EPS)) {
          failures.push(`${a.id} should start below ${a.of}`);
        }
        break;
      }
      case 'contains': {
        const a1 = probe(a.id);
        const b1 = probe(a.of);
        if (a1 && b1 && !contains(a1, b1)) {
          failures.push(`${a.id} should contain ${a.of}`);
        }
        break;
      }
      case 'insideContainer': {
        const r = probe(a.id);
        if (r && !contains(measurement.container, r)) {
          failures.push(`${a.id} should be inside the container`);
        }
        break;
      }
      case 'nonEmpty': {
        const r = probe(a.id);
        if (r && (r.w <= 0 || r.h <= 0)) {
          failures.push(`${a.id} should have a non-empty box, is ${r.w}x${r.h}`);
        }
        break;
      }
      case 'spansMultipleLines': {
        const r = probe(a.id);
        // A wrapped inline's union box is taller than one line. "One line" is
        // not knowable font-independently, so the test is that the box is
        // taller than it is for a single-line probe by a clear margin: at
        // least 1.5x the tallest single-line probe in the same case.
        const single = Math.min(
          ...Object.values(measurement.probes).map(p => p.h).filter(h => h > 0),
        );
        if (r && !(r.h >= single * 1.5)) {
          failures.push(
            `${a.id} should span more than one line (h=${r.h.toFixed(2)}, one line ≈ ${single.toFixed(2)})`,
          );
        }
        break;
      }
      case 'xOrder': {
        let previous = null;
        for (const id of a.ids) {
          const r = probe(id);
          if (r == null) {
            break;
          }
          if (previous != null && !(r.x >= previous.x - EPS)) {
            failures.push(`${a.ids.join(' < ')} are out of order at ${id}`);
            break;
          }
          previous = r;
        }
        break;
      }
      default:
        failures.push(`unknown assertion kind "${a.kind}"`);
    }
  }
  return failures;
}

function contentTop(c) {
  const p = c.container ?? {};
  return p.paddingTop ?? p.padding ?? 0;
}

function contentWidthOf(c, W) {
  const p = c.container ?? {};
  const left = p.paddingLeft ?? p.padding ?? 0;
  const right_ = p.paddingRight ?? p.padding ?? 0;
  return W - left - right_;
}

/**
 * Evaluates a case's `diff` entries: the same engine, this case against its
 * baseline. Deltas survive the font because both sides shaped the same string
 * with the same engine.
 */
function checkDiffs(c, measurement, baselineMeasurement) {
  const failures = [];
  if (baselineMeasurement == null) {
    return [`baseline case "${c.baseline}" was not measured`];
  }
  for (const d of c.diff ?? []) {
    const now = d.id != null ? measurement.probes[d.id] : measurement.container;
    const was = d.id != null ? baselineMeasurement.probes[d.id] : baselineMeasurement.container;
    if (now == null || was == null) {
      failures.push(`probe "${d.id}" missing from this case or its baseline`);
      continue;
    }
    const actual =
      d.kind === 'widthDelta'
        ? now.w - was.w
        : d.kind === 'heightDelta'
          ? now.h - was.h
          : d.kind === 'xDelta'
            ? now.x - was.x
            : d.kind === 'yDelta'
              ? now.y - was.y
              : d.kind === 'containerHeightDelta'
                ? measurement.container.h - baselineMeasurement.container.h
                : null;
    if (actual == null) {
      failures.push(`unknown diff kind "${d.kind}"`);
      continue;
    }
    const label = `${d.kind}${d.id != null ? `(${d.id})` : ''}`;
    // `atLeast` is for deltas whose exact size is a line height — which is a
    // font, not a spec. "The marker dropped by at least the separator's own
    // height" is the strongest font-independent form of "a line appeared".
    if (d.atLeast != null) {
      if (!(actual >= d.atLeast - EPS)) {
        failures.push(`${label} should be at least ${d.atLeast}, is ${actual.toFixed(2)}`);
      }
    } else if (!near(actual, d.equals)) {
      failures.push(`${label} should be ${d.equals}, is ${actual.toFixed(2)}`);
    }
  }
  return failures;
}

module.exports = {
  EPS,
  relation,
  signature,
  sameLine,
  contains,
  checkAsserts,
  checkDiffs,
  contentWidthOf,
  contentTop,
};
