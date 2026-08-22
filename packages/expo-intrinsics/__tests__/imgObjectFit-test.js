/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `object-fit` — its default, and its translation into the two vocabularies the
 * backing image views speak.
 *
 * A plain unit test rather than an itest because Fantom cannot answer it:
 * `rn-img`'s view config carries neither `contentFit` nor `resizeMode`, so both
 * are absent from the mounted tree no matter what the component passes. A test
 * there would pass or fail on a property of the harness.
 */

import {objectFitProps} from '../src/Img';

describe('objectFitProps', () => {
  test('defaults to fill, which is what CSS does', () => {
    // The regression this exists for. Passing nothing let the backing view
    // decide, and both backings default to `cover` — so an <img> given a width
    // and height that do not match its intrinsic ratio was cropped where a
    // browser stretches it.
    expect(objectFitProps(null)).toEqual({
      contentFit: 'fill',
      resizeMode: 'stretch',
    });
    expect(objectFitProps(undefined)).toEqual({
      contentFit: 'fill',
      resizeMode: 'stretch',
    });
  });

  test('an authored value is used', () => {
    expect(objectFitProps('contain')).toEqual({
      contentFit: 'contain',
      resizeMode: 'contain',
    });
    expect(objectFitProps('cover')).toEqual({
      contentFit: 'cover',
      resizeMode: 'cover',
    });
  });

  test('translates the values the two vocabularies spell differently', () => {
    // `contentFit` is CSS's own vocabulary, so it always passes through.
    // `resizeMode` has no `fill` and no `scale-down`, and no word at all for
    // `none` — `center` is the nearest thing that does not scale.
    expect(objectFitProps('fill').resizeMode).toBe('stretch');
    expect(objectFitProps('scale-down').resizeMode).toBe('contain');
    expect(objectFitProps('none').resizeMode).toBe('center');
    expect(objectFitProps('scale-down').contentFit).toBe('scale-down');
    expect(objectFitProps('none').contentFit).toBe('none');
  });

  test('an unrecognised value falls back to the initial value', () => {
    // Not passed through: a backing view handed a word it does not know
    // applies its own default, which puts `cover` back — the very thing the
    // default exists to prevent.
    expect(objectFitProps('nonsense')).toEqual({
      contentFit: 'fill',
      resizeMode: 'stretch',
    });
  });
});
