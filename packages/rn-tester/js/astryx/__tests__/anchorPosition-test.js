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

import {resolveAnchorPosition} from '../overlay/anchorPosition';

// A 100x40 anchor in the middle of a 400x800 viewport, and a 120x60 overlay.
const anchor = {x: 150, y: 380, width: 100, height: 40};
const overlay = {width: 120, height: 60};
const viewport = {width: 400, height: 800};

describe('anchor positioning', () => {
  it('places block-end below the anchor, centered', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'block-end',
    });
    // Centered on the anchor: 150 + 50 - 60 = 140.
    expect(result).toEqual({x: 140, y: 420, area: 'block-end', clamped: false});
  });

  it('applies the offset as the gap to the anchor', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'block-end',
      offset: 8,
    });
    expect(result.y).toBe(428);
  });

  it('aligns edges for span-inline-start (the menu-under-a-button shape)', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'block-end span-inline-start',
    });
    expect(result.x).toBe(anchor.x);
  });

  it('aligns the trailing edge for span-inline-end', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'block-end span-inline-end',
    });
    // Right edges flush: 150 + 100 - 120 = 130.
    expect(result.x).toBe(130);
  });

  it('places inline-end to the right, vertically centered', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'inline-end',
    });
    expect(result.x).toBe(250);
    expect(result.y).toBe(370);
  });

  it('keeps the preferred area when it fits, ignoring fallbacks', () => {
    const result = resolveAnchorPosition({
      anchor,
      overlay,
      viewport,
      area: 'block-end',
      fallbacks: ['flip-block'],
    });
    expect(result.area).toBe('block-end');
  });

  it('flips across the anchor when the preferred area overflows', () => {
    // Anchor near the bottom: below would overflow, so flip-block goes above.
    const lowAnchor = {x: 150, y: 760, width: 100, height: 40};
    const result = resolveAnchorPosition({
      anchor: lowAnchor,
      overlay,
      viewport,
      area: 'block-end',
      fallbacks: ['flip-block'],
    });
    expect(result.area).toBe('block-start');
    expect(result.y).toBe(700); // 760 - 60
    expect(result.clamped).toBe(false);
  });

  it('flips on the inline axis too', () => {
    const edgeAnchor = {x: 330, y: 380, width: 60, height: 40};
    const result = resolveAnchorPosition({
      anchor: edgeAnchor,
      overlay,
      viewport,
      area: 'inline-end',
      fallbacks: ['flip-inline'],
    });
    expect(result.area).toBe('inline-start');
    expect(result.x).toBe(210); // 330 - 120
  });

  it('walks fallbacks in order and takes the first that fits', () => {
    const lowAnchor = {x: 150, y: 760, width: 100, height: 40};
    const result = resolveAnchorPosition({
      anchor: lowAnchor,
      overlay,
      viewport,
      // Neither block-end nor inline-end-at-the-bottom is ideal; the explicit
      // block-start fallback is the first that fits.
      area: 'block-end',
      fallbacks: ['block-end span-inline-start', 'block-start'],
    });
    expect(result.area).toBe('block-start');
  });

  it('clamps into view when nothing fits, keeping the least-bad candidate', () => {
    const tinyViewport = {width: 130, height: 100};
    const result = resolveAnchorPosition({
      anchor: {x: 0, y: 60, width: 100, height: 40},
      overlay,
      viewport: tinyViewport,
      area: 'block-end',
      fallbacks: ['flip-block'],
      inset: 4,
    });
    expect(result.clamped).toBe(true);
    // Clamped inside the inset on both axes.
    expect(result.x).toBeGreaterThanOrEqual(4);
    expect(result.y).toBeGreaterThanOrEqual(4);
    expect(result.x + overlay.width).toBeLessThanOrEqual(
      tinyViewport.width + 120,
    );
  });

  it('respects the viewport inset when deciding what fits', () => {
    // Exactly flush with the bottom edge fits with inset 0…
    const anchorAtEdge = {x: 150, y: 700, width: 100, height: 40};
    expect(
      resolveAnchorPosition({
        anchor: anchorAtEdge,
        overlay,
        viewport,
        area: 'block-end',
        fallbacks: ['flip-block'],
      }).area,
    ).toBe('block-end');

    // …but not once an inset is required, so it flips.
    expect(
      resolveAnchorPosition({
        anchor: anchorAtEdge,
        overlay,
        viewport,
        area: 'block-end',
        fallbacks: ['flip-block'],
        inset: 16,
      }).area,
    ).toBe('block-start');
  });
});
