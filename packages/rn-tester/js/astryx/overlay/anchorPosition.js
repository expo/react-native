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
 * CSS anchor positioning (css-anchor-position-1), the engine every Astryx
 * overlay sits on: Popover, Tooltip, HoverCard, DropdownMenu, Typeahead and
 * the Carousel controls all position themselves with `position-area` plus
 * `position-try-fallbacks`, with **no JS fallback in the library** — so there
 * is nothing to port, only to implement.
 *
 * This module is deliberately pure: given the anchor's rect, the overlay's
 * size and the viewport, it returns where the overlay goes. That keeps the
 * hard part (the geometry and the fallback search) unit-testable without a
 * device, and leaves measurement/rendering to the caller.
 */

export type Rect = {
  readonly x: number,
  readonly y: number,
  readonly width: number,
  readonly height: number,
};

export type Size = {
  readonly width: number,
  readonly height: number,
};

/**
 * A `position-area` value, in the logical grid CSS defines around the anchor.
 * Supported subset: the block/inline placements Astryx actually uses, plus
 * `center`. `span-*` variants describe alignment along the cross axis.
 */
export type PositionArea =
  | 'block-start'
  | 'block-end'
  | 'inline-start'
  | 'inline-end'
  | 'center'
  | 'block-start span-inline-start'
  | 'block-start span-inline-end'
  | 'block-end span-inline-start'
  | 'block-end span-inline-end'
  | 'inline-start span-block-start'
  | 'inline-start span-block-end'
  | 'inline-end span-block-start'
  | 'inline-end span-block-end';

/**
 * `position-try-fallbacks`: alternatives tried in order when the preferred
 * area overflows. `flip-block` / `flip-inline` mirror the current area across
 * the anchor, exactly as in CSS.
 */
export type PositionTryFallback = PositionArea | 'flip-block' | 'flip-inline';

export type AnchorPositionInput = {
  readonly anchor: Rect,
  readonly overlay: Size,
  readonly viewport: Size,
  readonly area: PositionArea,
  readonly fallbacks?: ReadonlyArray<PositionTryFallback>,
  /** Gap between anchor and overlay, in points (CSS would use margin). */
  readonly offset?: number,
  /** Keep the overlay this far from the viewport edges. */
  readonly inset?: number,
};

export type AnchorPositionResult = {
  readonly x: number,
  readonly y: number,
  /** The area actually used — the preferred one unless a fallback won. */
  readonly area: PositionArea,
  /** True when no candidate fit and the result was clamped into view. */
  readonly clamped: boolean,
};

const BLOCK_FLIP: {[PositionArea]: PositionArea} = {
  'block-start': 'block-end',
  'block-end': 'block-start',
  'block-start span-inline-start': 'block-end span-inline-start',
  'block-end span-inline-start': 'block-start span-inline-start',
  'block-start span-inline-end': 'block-end span-inline-end',
  'block-end span-inline-end': 'block-start span-inline-end',
  'inline-start': 'inline-start',
  'inline-end': 'inline-end',
  'inline-start span-block-start': 'inline-start span-block-end',
  'inline-start span-block-end': 'inline-start span-block-start',
  'inline-end span-block-start': 'inline-end span-block-end',
  'inline-end span-block-end': 'inline-end span-block-start',
  center: 'center',
};

const INLINE_FLIP: {[PositionArea]: PositionArea} = {
  'inline-start': 'inline-end',
  'inline-end': 'inline-start',
  'inline-start span-block-start': 'inline-end span-block-start',
  'inline-start span-block-end': 'inline-end span-block-end',
  'inline-end span-block-start': 'inline-start span-block-start',
  'inline-end span-block-end': 'inline-start span-block-end',
  'block-start span-inline-start': 'block-start span-inline-end',
  'block-start span-inline-end': 'block-start span-inline-start',
  'block-end span-inline-start': 'block-end span-inline-end',
  'block-end span-inline-end': 'block-end span-inline-start',
  'block-start': 'block-start',
  'block-end': 'block-end',
  center: 'center',
};

/** Places the overlay for one area, without any fitting logic. */
function place(
  area: PositionArea,
  anchor: Rect,
  overlay: Size,
  offset: number,
): {x: number, y: number} {
  const anchorCenterX = anchor.x + anchor.width / 2;
  const anchorCenterY = anchor.y + anchor.height / 2;
  const centeredX = anchorCenterX - overlay.width / 2;
  const centeredY = anchorCenterY - overlay.height / 2;

  switch (area) {
    case 'block-start':
      return {x: centeredX, y: anchor.y - overlay.height - offset};
    case 'block-end':
      return {x: centeredX, y: anchor.y + anchor.height + offset};
    case 'inline-start':
      return {x: anchor.x - overlay.width - offset, y: centeredY};
    case 'inline-end':
      return {x: anchor.x + anchor.width + offset, y: centeredY};
    case 'center':
      return {x: centeredX, y: centeredY};
    // `span-*` aligns the overlay's edge with the anchor's edge rather than
    // centering it — the menu-under-a-button shape.
    //
    // The direction names read like the SPREAD, not the anchor edge
    // (css-anchor-position-1 §3.1): `span-inline-end` grows from the
    // anchor's inline-START edge toward inline-end, so the START edges are
    // the flush pair; `span-inline-start` grows the other way and aligns
    // the END edges. This function had them inverted — a menu opened with
    // Radix's align="start" hung LEFT off its trigger.
    case 'block-start span-inline-end':
      return {x: anchor.x, y: anchor.y - overlay.height - offset};
    case 'block-start span-inline-start':
      return {
        x: anchor.x + anchor.width - overlay.width,
        y: anchor.y - overlay.height - offset,
      };
    case 'block-end span-inline-end':
      return {x: anchor.x, y: anchor.y + anchor.height + offset};
    case 'block-end span-inline-start':
      return {
        x: anchor.x + anchor.width - overlay.width,
        y: anchor.y + anchor.height + offset,
      };
    // The inline sides span the BLOCK axis the same way. These fell through
    // to the centered default before, so a side="left"/"right" overlay
    // ignored its align entirely.
    case 'inline-start span-block-end':
      return {x: anchor.x - overlay.width - offset, y: anchor.y};
    case 'inline-start span-block-start':
      return {
        x: anchor.x - overlay.width - offset,
        y: anchor.y + anchor.height - overlay.height,
      };
    case 'inline-end span-block-end':
      return {x: anchor.x + anchor.width + offset, y: anchor.y};
    case 'inline-end span-block-start':
      return {
        x: anchor.x + anchor.width + offset,
        y: anchor.y + anchor.height - overlay.height,
      };
    default:
      return {x: centeredX, y: centeredY};
  }
}

/** How far a placement spills outside the viewport, in points (0 = fits). */
function overflowAmount(
  position: {x: number, y: number},
  overlay: Size,
  viewport: Size,
  inset: number,
): number {
  const left = Math.max(0, inset - position.x);
  const top = Math.max(0, inset - position.y);
  const right = Math.max(
    0,
    position.x + overlay.width - (viewport.width - inset),
  );
  const bottom = Math.max(
    0,
    position.y + overlay.height - (viewport.height - inset),
  );
  return left + top + right + bottom;
}

function resolveFallbackArea(
  fallback: PositionTryFallback,
  preferred: PositionArea,
): PositionArea {
  if (fallback === 'flip-block') {
    return BLOCK_FLIP[preferred] ?? preferred;
  }
  if (fallback === 'flip-inline') {
    return INLINE_FLIP[preferred] ?? preferred;
  }
  return fallback;
}

/**
 * Resolves an overlay's position against its anchor.
 *
 * Follows the CSS algorithm's shape: try the preferred `position-area`; if it
 * overflows the viewport, walk `position-try-fallbacks` in order and take the
 * first that fits. If none fit, keep the candidate that overflows least (CSS's
 * default `position-try-order: normal` behaviour) and clamp it into view so
 * the overlay is never rendered off-screen.
 */
export function resolveAnchorPosition(
  input: AnchorPositionInput,
): AnchorPositionResult {
  const {
    anchor,
    overlay,
    viewport,
    area,
    fallbacks = [],
    offset = 0,
    inset = 0,
  } = input;

  const candidates: Array<PositionArea> = [area];
  for (const fallback of fallbacks) {
    candidates.push(resolveFallbackArea(fallback, area));
  }

  let best: ?{area: PositionArea, x: number, y: number, overflow: number} =
    null;

  for (const candidate of candidates) {
    const position = place(candidate, anchor, overlay, offset);
    const overflow = overflowAmount(position, overlay, viewport, inset);
    if (overflow === 0) {
      return {x: position.x, y: position.y, area: candidate, clamped: false};
    }
    if (best == null || overflow < best.overflow) {
      best = {area: candidate, x: position.x, y: position.y, overflow};
    }
  }

  // Nothing fit: clamp the least-bad candidate into the viewport.
  const chosen = best ?? {
    area,
    ...place(area, anchor, overlay, offset),
    overflow: 0,
  };
  const maxX = Math.max(inset, viewport.width - inset - overlay.width);
  const maxY = Math.max(inset, viewport.height - inset - overlay.height);
  return {
    x: Math.min(Math.max(chosen.x, inset), maxX),
    y: Math.min(Math.max(chosen.y, inset), maxY),
    area: chosen.area,
    clamped: true,
  };
}
