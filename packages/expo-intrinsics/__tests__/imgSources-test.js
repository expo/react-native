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
 * `srcset` and `sizes` parsing.
 *
 * A plain unit test rather than an itest: these are pure functions, and the
 * cases worth covering are the grammar's awkward corners — commas inside URLs,
 * invalid descriptors, `vw` lengths — none of which need a renderer.
 */

import type {ImageCandidate} from '../src/imgSources';

import {parseSrcSet, resolveSizes, selectImageSource} from '../src/imgSources';

describe('parseSrcSet', () => {
  test('a bare URL is a 1x candidate', () => {
    expect(parseSrcSet('a.png')).toEqual([{uri: 'a.png', scale: 1}]);
  });

  test('reads x descriptors', () => {
    expect(parseSrcSet('a.png 1x, b.png 2x, c.png 3x')).toEqual([
      {uri: 'a.png', scale: 1},
      {uri: 'b.png', scale: 2},
      {uri: 'c.png', scale: 3},
    ]);
  });

  test('reads w descriptors', () => {
    expect(parseSrcSet('small.png 480w, large.png 1024w')).toEqual([
      {uri: 'small.png', width: 480},
      {uri: 'large.png', width: 1024},
    ]);
  });

  test('fractional descriptors are allowed', () => {
    expect(parseSrcSet('a.png 1.5x')).toEqual([{uri: 'a.png', scale: 1.5}]);
  });

  test('tolerates newlines and runs of whitespace', () => {
    expect(parseSrcSet('  a.png   1x ,\n  b.png 2x  ')).toEqual([
      {uri: 'a.png', scale: 1},
      {uri: 'b.png', scale: 2},
    ]);
  });

  // The case a naive `split(',')` gets wrong, and the reason the splitter reads
  // a URL before it will treat a comma as a separator.
  test('a comma inside a URL does not split the candidate', () => {
    expect(parseSrcSet('https://e.com/a,b.png 2x')).toEqual([
      {uri: 'https://e.com/a,b.png', scale: 2},
    ]);
  });

  test('a comma inside a URL with no descriptor still yields one candidate', () => {
    expect(parseSrcSet('https://e.com/w_100,h_50/a.png')).toEqual([
      {uri: 'https://e.com/w_100,h_50/a.png', scale: 1},
    ]);
  });

  test('drops candidates with an unreadable descriptor', () => {
    // Keeping these would pick a file the author did not mean.
    expect(parseSrcSet('a.png 2q, b.png 2x')).toEqual([
      {uri: 'b.png', scale: 2},
    ]);
  });

  test('drops zero and negative descriptors', () => {
    expect(parseSrcSet('a.png 0x, b.png 0w, c.png 1x')).toEqual([
      {uri: 'c.png', scale: 1},
    ]);
  });

  test('an empty srcset yields nothing', () => {
    expect(parseSrcSet('')).toEqual([]);
    expect(parseSrcSet('   ')).toEqual([]);
  });
});

describe('resolveSizes', () => {
  test('a bare length is the default and always applies', () => {
    expect(resolveSizes('400px', 1000)).toBe(400);
  });

  test('vw resolves against the viewport', () => {
    expect(resolveSizes('50vw', 1000)).toBe(500);
  });

  test('the first matching condition wins', () => {
    const sizes = '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 800px';
    expect(resolveSizes(sizes, 500)).toBe(500);
    expect(resolveSizes(sizes, 1000)).toBe(500);
    expect(resolveSizes(sizes, 2000)).toBe(800);
  });

  test('min-width conditions', () => {
    expect(resolveSizes('(min-width: 800px) 600px, 300px', 1000)).toBe(600);
    expect(resolveSizes('(min-width: 800px) 600px, 300px', 400)).toBe(300);
  });

  test('an unreadable condition is skipped rather than guessed at', () => {
    expect(resolveSizes('(orientation: landscape) 900px, 300px', 1000)).toBe(
      300,
    );
  });

  test('nothing understood resolves to null, leaving the choice to the platform', () => {
    expect(resolveSizes('(orientation: landscape) 900px', 1000)).toBe(null);
    expect(resolveSizes('', 1000)).toBe(null);
  });
});

describe('selectImageSource', () => {
  const wide: Array<ImageCandidate> = [
    {uri: 's.png', width: 480},
    {uri: 'm.png', width: 800},
    {uri: 'l.png', width: 1600},
  ];

  test('picks the smallest file that covers the box at 1x', () => {
    expect(selectImageSource(wide, 500, 1)).toEqual({uri: 'm.png', width: 800});
    expect(selectImageSource(wide, 480, 1)).toEqual({uri: 's.png', width: 480});
  });

  test('the pixel ratio raises what "covers" means', () => {
    // 300pt on a 2x screen needs 600 real pixels, so the 480 file will not do.
    expect(selectImageSource(wide, 300, 1)).toEqual({uri: 's.png', width: 480});
    expect(selectImageSource(wide, 300, 2)).toEqual({uri: 'm.png', width: 800});
    expect(selectImageSource(wide, 300, 3)).toEqual({
      uri: 'l.png',
      width: 1600,
    });
  });

  test('falls back to the largest when the box is wider than every file', () => {
    expect(selectImageSource(wide, 4000, 1)).toEqual({
      uri: 'l.png',
      width: 1600,
    });
  });

  test('x candidates are chosen by pixel ratio', () => {
    const dense: Array<ImageCandidate> = [
      {uri: 'a.png', scale: 1},
      {uri: 'b.png', scale: 2},
      {uri: 'c.png', scale: 3},
    ];
    expect(selectImageSource(dense, null, 1)).toEqual({uri: 'a.png', scale: 1});
    expect(selectImageSource(dense, null, 2)).toEqual({uri: 'b.png', scale: 2});
    expect(selectImageSource(dense, null, 4)).toEqual({uri: 'c.png', scale: 3});
  });

  test('a fractional pixel ratio rounds up to a file that covers it', () => {
    const dense: Array<ImageCandidate> = [
      {uri: 'a.png', scale: 1},
      {uri: 'b.png', scale: 2},
    ];
    expect(selectImageSource(dense, null, 1.5)).toEqual({
      uri: 'b.png',
      scale: 2,
    });
  });

  test('w candidates with no width to judge by fall back to source order', () => {
    expect(selectImageSource(wide, null, 2)).toEqual({
      uri: 's.png',
      width: 480,
    });
  });

  test('a width-based answer beats a density one when a width is known', () => {
    const mixed: Array<ImageCandidate> = [
      {uri: 'x.png', scale: 2},
      {uri: 'w.png', width: 1600},
    ];
    expect(selectImageSource(mixed, 500, 2)).toEqual({
      uri: 'w.png',
      width: 1600,
    });
  });

  test('an empty list selects nothing', () => {
    expect(selectImageSource([], 300, 2)).toBe(null);
  });
});
