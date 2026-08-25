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
 * `stylex.when.*` and the markers they refer to.
 *
 * The shapes here are read off `@stylexjs/stylex@0.19`'s own type
 * declarations, not inferred from how Astryx happens to call them:
 *
 *   defineMarker(): MapNamespace<{readonly marker: symbol}>
 *   when.ancestor(pseudo?, marker?): `:where-ancestor(${Pseudo}, ${Symbol})`
 *
 * with `descendant`, `siblingBefore`, `siblingAfter` and `anySibling`
 * alongside `ancestor`, and both arguments optional. Upstream these are
 * compile-time only — the published runtime THROWS from every one of them,
 * because the Babel plugin is expected to have rewritten them into a class and
 * a selector. There is no compiler here, so they are evaluated at runtime, and
 * these pin that the evaluation agrees with the selector it is standing in for.
 */

import type {MarkerState} from '../stylex-rn';

import {
  EMPTY_MARKER_STATE,
  defaultMarker,
  defineMarker,
  hasMarkers,
  parseWhenKey,
  when,
  whenConditionApplies,
} from '../stylex-rn';

/*
 * A state in which exactly one relation has anything to say. Written out per
 * relation rather than with a computed key, because a computed key makes the
 * object an indexed one and an indexer is not the exact `MarkerState` the
 * evaluator takes — which is worth keeping exact, since the whole point of
 * these tests is that each relation reads its OWN side.
 */
function stateWith(
  which: 'ancestors' | 'before' | 'after' | 'descendants',
  marker: string,
  pseudos: Array<string>,
): MarkerState {
  const only: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    [marker, new Set(pseudos)],
  ]);
  switch (which) {
    case 'ancestors':
      return {...EMPTY_MARKER_STATE, ancestors: only};
    case 'before':
      return {...EMPTY_MARKER_STATE, before: only};
    case 'after':
      return {...EMPTY_MARKER_STATE, after: only};
    case 'descendants':
      return {...EMPTY_MARKER_STATE, descendants: only};
  }
  throw new Error(`unknown relation: ${which}`);
}

/** The marker id inside a key, which is what the state is keyed by. */
function markerIn(key: string): string {
  const parsed = parseWhenKey(key);
  if (parsed == null) {
    throw new Error(`not a when key: ${key}`);
  }
  return parsed.marker;
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

  test('defining one is what makes the tree bookkeeping worth doing', () => {
    // Guards the cost: an app with no markers clones no children.
    expect(hasMarkers()).toBe(true);
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

describe('evaluating a condition', () => {
  test('an ancestor condition holds when that marker matches the pseudo', () => {
    const marker = defineMarker();
    const key = when.ancestor(':first-child', marker);
    const id = markerIn(key);

    expect(
      whenConditionApplies(key, stateWith('ancestors', id, [':first-child'])),
    ).toBe(true);
    expect(
      whenConditionApplies(key, stateWith('ancestors', id, [':last-child'])),
    ).toBe(false);
    expect(whenConditionApplies(key, EMPTY_MARKER_STATE)).toBe(false);
  });

  test('it is the marked ancestor that is asked, not any ancestor', () => {
    const marked = defineMarker();
    const other = defineMarker();
    const key = when.ancestor(':first-child', marked);
    // A DIFFERENT marker matching the same pseudo must not satisfy it.
    const state = stateWith('ancestors', markerIn(when.ancestor(':x', other)), [
      ':first-child',
    ]);
    expect(whenConditionApplies(key, state)).toBe(false);
  });

  test('sibling relations read their own side', () => {
    const m = defineMarker();
    const before = when.siblingBefore(':checked', m);
    const after = when.siblingAfter(':checked', m);
    const id = markerIn(before);

    const beforeState = stateWith('before', id, [':checked']);
    expect(whenConditionApplies(before, beforeState)).toBe(true);
    expect(whenConditionApplies(after, beforeState)).toBe(false);

    // anySibling takes either side.
    expect(
      whenConditionApplies(when.anySibling(':checked', m), beforeState),
    ).toBe(true);
    expect(
      whenConditionApplies(
        when.anySibling(':checked', m),
        stateWith('after', id, [':checked']),
      ),
    ).toBe(true);
  });

  test('descendant reads the descendants map, with `:has()` semantics', () => {
    // The one relation whose answer travels UP. It is answered from what
    // marked descendants have reported rather than from anything visible at
    // the asking element, so it reads the `descendants` side and nothing else:
    // an ANCESTOR matching the same pseudo must not satisfy it.
    const m = defineMarker();
    const key = when.descendant(':checked', m);
    const id = markerIn(key);

    expect(whenConditionApplies(key, stateWith('descendants', id, [':checked'])))
      .toBe(true);
    expect(whenConditionApplies(key, stateWith('ancestors', id, [':checked'])))
      .toBe(false);
    // Nothing reported yet — a parent's first render, before its subtree
    // exists — is a legitimate "no" rather than an error.
    expect(whenConditionApplies(key, EMPTY_MARKER_STATE)).toBe(false);
  });

  test('a key that is not a when condition never applies', () => {
    expect(whenConditionApplies(':hover', EMPTY_MARKER_STATE)).toBe(false);
    expect(parseWhenKey(':hover')).toBeNull();
  });
});
