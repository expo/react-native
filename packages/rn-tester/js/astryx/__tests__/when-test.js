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
 * `stylex.when.*` and the markers they refer to. The shapes are
 * `@stylexjs/stylex@0.19`'s own declarations:
 *   defineMarker(): MapNamespace<{readonly marker: symbol}>
 *   when.ancestor(pseudo?, marker?): `:where-ancestor(${Pseudo}, ${Symbol})`
 * with `descendant`, `siblingBefore`, `siblingAfter` and `anySibling`
 * alongside, both arguments optional. Upstream's runtime throws from every one
 * of them and expects the Babel plugin to have rewritten them; here a key
 * stands in for the selector, which the renderer's style engine answers (see
 * whenConditions-itest.js), and these pin its format.
 */

import {defaultMarker, defineMarker, when} from '../stylex-rn';

/** The marker id inside a key */
function markerIn(key: string): string {
  const match = /^:where-[a-z-]+\([^,]+, ([^)]+)\)$/.exec(key);
  if (match == null) {
    throw new Error(`not a when key: ${key}`);
  }
  return match[1];
}

describe('defineMarker', () => {
  test('is a style namespace whose marker is a unique symbol', () => {
    const a = defineMarker();
    const b = defineMarker();
    expect(typeof a.marker).toBe('symbol');
    expect(a.marker).not.toBe(b.marker);
  });

  test('the default marker is one shared value', () => {
    expect(defaultMarker()).toBe(defaultMarker());
    expect(typeof defaultMarker().marker).toBe('symbol');
  });
});

describe('when.* key format', () => {
  test('matches the selector the compiler would emit', () => {
    const marker = defineMarker();
    expect(when.ancestor(':first-child', marker)).toBe(
      `:where-ancestor(:first-child, ${markerIn(when.ancestor(':first-child', marker))})`,
    );
    expect(when.ancestor(':first-child', marker)).toMatch(
      /^:where-ancestor\(:first-child, m\d+\)$/,
    );
  });

  test('every documented relation has its own selector', () => {
    const m = defineMarker();
    expect(when.descendant(':checked', m)).toMatch(/^:where-descendant\(/);
    expect(when.siblingBefore(':checked', m)).toMatch(
      /^:where-sibling-before\(/,
    );
    expect(when.siblingAfter(':checked', m)).toMatch(/^:where-sibling-after\(/);
    expect(when.anySibling(':checked', m)).toMatch(/^:where-any-sibling\(/);
  });

  test('attribute selectors are pseudos too, per the type', () => {
    const m = defineMarker();
    expect(when.ancestor('[data-state=open]', m)).toBe(
      `:where-ancestor([data-state=open], ${markerIn(when.ancestor('[data-state=open]', m))})`,
    );
  });

  test('both arguments are optional and the marker defaults', () => {
    const withDefault = when.ancestor(':first-child');
    const explicit = when.ancestor(':first-child', defaultMarker());
    expect(withDefault).toBe(explicit);
  });

  test('two markers never collide', () => {
    const a = when.ancestor(':first-child', defineMarker());
    const b = when.ancestor(':first-child', defineMarker());
    expect(a).not.toBe(b);
  });
});
