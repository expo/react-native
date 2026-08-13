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

import {withoutOutrankedBoxEdges} from '../cascade';

// What the stylesheet engine hands back for Tailwind preflight's
// `button { padding: 0 }` — the shorthand is expanded to the four physical
// longhands on the way through (see `expandShorthand`).
const PREFLIGHT_BUTTON = {
  backgroundColor: 'transparent',
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
};

describe('withoutOutrankedBoxEdges', () => {
  it('drops the sheet padding an axis-spelled author style covers', () => {
    // The bug this exists for: both layers survive a merge-by-key, and Yoga
    // then prefers `padding-top` over the vertical axis — so the reset won and
    // every Astryx card sat flush against its label.
    expect(
      withoutOutrankedBoxEdges(PREFLIGHT_BUTTON, {
        paddingBlock: 12,
        paddingInline: 16,
      }),
    ).toEqual({backgroundColor: 'transparent'});
  });

  it('gives up only the edges the author claimed', () => {
    // A browser resolves `padding: 0` under `padding-left: 4px` to 0 0 0 4.
    expect(
      withoutOutrankedBoxEdges(PREFLIGHT_BUTTON, {paddingLeft: 4}),
    ).toEqual({
      backgroundColor: 'transparent',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
    });
  });

  it('keeps the other axis', () => {
    expect(
      withoutOutrankedBoxEdges(PREFLIGHT_BUTTON, {paddingBlock: 12}),
    ).toEqual({
      backgroundColor: 'transparent',
      paddingRight: 0,
      paddingLeft: 0,
    });
  });

  it('lets a one-sided FLOW-relative author edge stand aside', () => {
    // `paddingInlineStart` is the left edge or the right one depending on a
    // direction this layer cannot see, so it masks neither. It does not need
    // to: Yoga ranks `Edge::Start` above `Edge::Left` on its own.
    expect(
      withoutOutrankedBoxEdges(PREFLIGHT_BUTTON, {paddingInlineStart: 8}),
    ).toEqual(PREFLIGHT_BUTTON);
  });

  it('masks a physical edge with the axis that contains it, either naming', () => {
    expect(
      withoutOutrankedBoxEdges(
        {paddingLeft: 0, paddingStart: 0},
        {paddingHorizontal: 6},
      ),
    ).toEqual({});
  });

  it('covers margin and inset by the same rule', () => {
    expect(
      withoutOutrankedBoxEdges(
        {marginTop: 0, marginBottom: 0, top: 0, left: 0},
        {marginBlock: 4, insetBlock: 2},
      ),
    ).toEqual({left: 0});
  });

  it('does not confuse one box property for another', () => {
    expect(withoutOutrankedBoxEdges({paddingTop: 0}, {marginBlock: 4})).toEqual(
      {paddingTop: 0},
    );
  });

  it('treats an unstated key as no declaration at all', () => {
    // A style object built by spreading can carry `paddingBlock: undefined`;
    // masking on it would leave the element with no padding from either layer.
    expect(
      withoutOutrankedBoxEdges(PREFLIGHT_BUTTON, {paddingBlock: undefined}),
    ).toEqual(PREFLIGHT_BUTTON);
  });

  it('returns the same object when there is nothing to mask', () => {
    const lower = {color: 'red'};
    expect(withoutOutrankedBoxEdges(lower, {paddingBlock: 4})).toBe(lower);
    expect(withoutOutrankedBoxEdges(lower, null)).toBe(lower);
  });
});
