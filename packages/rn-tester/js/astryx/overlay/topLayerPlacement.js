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

import type {PositionArea, Rect, Size} from './anchorPosition';

import {flipArea, place} from './anchorPosition';

/**
 * Where an element in the top layer goes, in the viewport: next to its anchor
 * by CSS anchor positioning when it names one (`position-anchor`,
 * `position-area`, `position-try-fallbacks`), else at its own insets.
 *
 * The margins are the margin box CSS fits: the one facing the anchor is the
 * clearance between them, the one on the far side of the placement axis the
 * gutter kept from the viewport's edge. The answer is the border box's
 * position, so the caller drops the margins from the element it places.
 *
 * DOM-CSS-LIMITATION(position-try-is-flips-and-a-clamp): a named
 * `@position-try` rule is not read; when no flip fits, the least overflowing
 * option is clamped into the viewport, which is where Astryx's slide rules put
 * a layer wider than the room beside its trigger.
 */
export function placeInTopLayer({
  style,
  size,
  anchor,
  viewport,
  defaultInset = null,
}: {
  // The element's resolved style
  style: {readonly [string]: unknown},
  // Its border box
  size: Size,
  // The rect of the element `position-anchor` names, or null
  anchor: ?Rect,
  viewport: Size,
  // The inset the user agent gives an edge the element's style leaves auto:
  // `0` for a modal dialog (`dialog:modal { inset: 0 }`)
  defaultInset?: ?number,
}): {x: number, y: number} {
  const area = positionAreaOf(style.positionArea);
  if (anchor != null && area != null) {
    return placeAgainstAnchor(area, style, size, anchor, viewport);
  }
  // Positioned against the viewport by its own insets, as a fixed element is
  return {
    x: placeOnAxis(
      lengthOf(style.left) ?? defaultInset,
      lengthOf(style.right) ?? defaultInset,
      autoMargins(style, ['marginLeft', 'marginRight', 'marginHorizontal']),
      size.width,
      viewport.width,
    ),
    y: placeOnAxis(
      lengthOf(style.top) ?? defaultInset,
      lengthOf(style.bottom) ?? defaultInset,
      autoMargins(style, ['marginTop', 'marginBottom', 'marginVertical']),
      size.height,
      viewport.height,
    ),
  };
}

// Where a fixed element's box starts on one axis (CSS 2.1 §10.3.7, §10.6.4):
// between two insets with both margins auto, centred in what they leave; at
// the start inset otherwise, or the end one, or centred with neither
function placeOnAxis(
  start: ?number,
  end: ?number,
  centered: boolean,
  size: number,
  room: number,
): number {
  if (start != null && end != null && centered) {
    return start + Math.max(0, (room - start - end - size) / 2);
  }
  if (start != null) {
    return start;
  }
  if (end != null) {
    return room - end - size;
  }
  return (room - size) / 2;
}

// Whether both margins of an axis are auto: the shorthand, the axis
// shorthand, or each side
function autoMargins(
  style: {readonly [string]: unknown},
  [start, end, axis]: Array<string>,
): boolean {
  return (
    style.margin === 'auto' ||
    style[axis] === 'auto' ||
    (style[start] === 'auto' && style[end] === 'auto')
  );
}

type Margins = {top: number, right: number, bottom: number, left: number};

/**
 * The first option of `position-area` and its fallbacks whose margin box fits
 * the viewport (css-anchor-position-1 §5), else the one that overflows least,
 * moved into the viewport. A flip mirrors the margins with the area, so the
 * clearance stays between the element and its anchor and the gutter on the
 * far side.
 */
function placeAgainstAnchor(
  area: PositionArea,
  style: {readonly [string]: unknown},
  size: Size,
  anchor: Rect,
  viewport: Size,
): {x: number, y: number} {
  const margins: Margins = {
    top: marginOf(style, 'Top'),
    right: marginOf(style, 'Right'),
    bottom: marginOf(style, 'Bottom'),
    left: marginOf(style, 'Left'),
  };
  const options = [
    {block: false, inline: false},
    ...tryFlipsOf(style.positionTryFallbacks),
  ];
  let best: ?{x: number, y: number, margins: Margins, overflow: number} = null;
  for (const {block, inline} of options) {
    const optionArea = flipArea(area, block, inline);
    const optionMargins = {
      top: block ? margins.bottom : margins.top,
      bottom: block ? margins.top : margins.bottom,
      left: inline ? margins.right : margins.left,
      right: inline ? margins.left : margins.right,
    };
    const position = place(
      optionArea,
      anchor,
      size,
      facingMargin(optionArea, optionMargins),
    );
    const overflow =
      Math.max(0, optionMargins.left - position.x) +
      Math.max(
        0,
        position.x + size.width + optionMargins.right - viewport.width,
      ) +
      Math.max(0, optionMargins.top - position.y) +
      Math.max(
        0,
        position.y + size.height + optionMargins.bottom - viewport.height,
      );
    if (overflow === 0) {
      return position;
    }
    if (best == null || overflow < best.overflow) {
      best = {...position, margins: optionMargins, overflow};
    }
  }
  const chosen = best ?? {x: anchor.x, y: anchor.y, margins, overflow: 0};
  return {
    x: clamp(
      chosen.x,
      chosen.margins.left,
      viewport.width - chosen.margins.right - size.width,
    ),
    y: clamp(
      chosen.y,
      chosen.margins.top,
      viewport.height - chosen.margins.bottom - size.height,
    ),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

const AREAS: Set<string> = new Set([
  'block-start',
  'block-end',
  'inline-start',
  'inline-end',
  'center',
  'block-start span-inline-start',
  'block-start span-inline-end',
  'block-end span-inline-start',
  'block-end span-inline-end',
  'inline-start span-block-start',
  'inline-start span-block-end',
  'inline-end span-block-start',
  'inline-end span-block-end',
]);

// `self-*` keywords resolve against the element's own writing mode, which is
// the document's horizontal left-to-right one here, so they read as the
// logical keywords
function positionAreaOf(value: unknown): ?PositionArea {
  if (typeof value !== 'string') {
    return null;
  }
  const area = value
    .trim()
    .replace(/\bself-/g, '')
    .replace(/\s+/g, ' ');
  return AREAS.has(area) ? (area as $FlowFixMe) : null;
}

// The flip tactics of `position-try-fallbacks`, in order. A named
// `@position-try` rule is not read: past the flips, the least overflowing
// option is moved into the viewport, where a slide rule would put it.
function tryFlipsOf(value: unknown): Array<{block: boolean, inline: boolean}> {
  if (typeof value !== 'string') {
    return [];
  }
  const flips = [];
  for (const option of value.split(',')) {
    const tactics = option.trim().split(/\s+/);
    const block = tactics.includes('flip-block');
    const inline = tactics.includes('flip-inline');
    if (block || inline) {
      flips.push({block, inline});
    }
  }
  return flips;
}

// The margin between an element and its anchor: the clearance
function facingMargin(area: PositionArea, margins: Margins): number {
  if (area.startsWith('block-end')) {
    return margins.top;
  }
  if (area.startsWith('block-start')) {
    return margins.bottom;
  }
  if (area.startsWith('inline-end')) {
    return margins.left;
  }
  if (area.startsWith('inline-start')) {
    return margins.right;
  }
  return 0;
}

const LOGICAL_MARGIN: {[string]: Array<string>} = {
  Top: ['marginTop', 'marginBlockStart', 'marginBlock', 'marginVertical'],
  Bottom: ['marginBottom', 'marginBlockEnd', 'marginBlock', 'marginVertical'],
  Left: [
    'marginLeft',
    'marginStart',
    'marginInlineStart',
    'marginInline',
    'marginHorizontal',
  ],
  Right: [
    'marginRight',
    'marginEnd',
    'marginInlineEnd',
    'marginInline',
    'marginHorizontal',
  ],
};

function marginOf(style: {readonly [string]: unknown}, side: string): number {
  for (const key of [...LOGICAL_MARGIN[side], 'margin']) {
    const length = lengthOf(style[key]);
    if (length != null) {
      return length;
    }
  }
  return 0;
}

function lengthOf(value: unknown): ?number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^-?[\d.]+(px)?$/.test(value.trim())) {
    return parseFloat(value);
  }
  return null;
}

/** The margin properties a placed element drops, its position taking them in */
export const MARGIN_KEYS: ReadonlyArray<string> = [
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginStart',
  'marginEnd',
  'marginVertical',
  'marginHorizontal',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
];
