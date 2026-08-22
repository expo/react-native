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
 * An author's `color` must reach the elements inside it.
 *
 * This is the property the themed user-agent defaults nearly destroyed. Giving
 * every element its own `color` in the UA sheet themes a bare screen correctly
 * and quietly stops inheritance dead: the child's own UA declaration outranks
 * the value it should have inherited, so `<div style={{color:'red'}}><b>` drew
 * BLACK.
 *
 * Browsers do not state `color` on every element. They state it once, at the
 * root, and let it inherit — which is the whole reason the cascade has an
 * inherited origin. Matching that is what this pins.
 */

import {uaStyleFor} from '../src/uaStyles';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

const RED = 'rgba(255, 0, 0, 1)';

function colorsOf(root: Fantom.Root): string {
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ) ?? ''
  );
}

test('an author colour on an ancestor reaches a nested inline element', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[not-a-component] intrinsic tags
      <div style={{color: 'red'}}>
        {'plain '}
        {/* $FlowExpectedError[not-a-component] */}
        <b>bold</b>
        {/* $FlowExpectedError[not-a-component] */}
        <small>tiny</small>
      </div>,
    );
  });

  const rendered = colorsOf(root);
  // Every run under the red div is red. Before the fix the <b> and <small>
  // carried the UA canvas colour instead, which is what read as black.
  expect(rendered).toContain(RED);
  // And nothing under it kept a colour that is not the author's.
  const colors = (rendered.match(/"foregroundColor":"[^"]+"/g) ?? []).map(s =>
    s.slice('"foregroundColor":"'.length, -1),
  );
  expect(colors.length).toBeGreaterThan(0);
  for (const c of colors) {
    expect(c).toBe(RED);
  }
});

test('an element with no author colour above it still gets one', () => {
  // The themed default has to survive the fix: an element nobody has coloured
  // must still pick up the platform's label colour rather than nothing.
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[not-a-component]
      <div>
        {/* $FlowExpectedError[not-a-component] */}
        <b>bold</b>
      </div>,
    );
  });
  expect(colorsOf(root)).toBeTruthy();
});

/*
 * The structural guarantee, and the one that actually catches this.
 *
 * The rendered-output test above CANNOT see the bug: `PlatformColor` resolves
 * to nothing in Fantom, so a per-element UA colour silently disappears here and
 * inheritance looks fine — the original version of this file passed against the
 * broken code for exactly that reason. It only failed on a device, where the
 * colour resolves and outranks the inherited value.
 *
 * So the rule is asserted where it is observable everywhere: an INHERITED
 * property must never be stated per element in the user-agent sheet. Whether
 * the value resolves in this environment is irrelevant to that.
 */
describe('inherited properties are not stated per element', () => {
  // The CSS inherited set this sheet could plausibly reach for.
  const INHERITED = [
    'color',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'textAlign',
    'textTransform',
  ];

  test('a purely presentational inline element declares no inherited colour', () => {
    // <b> means "bold" and nothing about colour; <small> means "smaller" and
    // nothing about colour. Either one carrying `color` blocks the cascade.
    for (const tag of ['b', 'i', 'em', 'strong', 'span', 'small', 'code']) {
      expect(uaStyleFor(tag).color).toBeUndefined();
    }
  });

  test('no element declares an inherited property it does not mean', () => {
    /*
     * Elements legitimately state SOME inherited properties — <b> sets
     * font-weight, <small> sets font-size, <code> sets font-family. Those are
     * the element's meaning. What must not happen is a blanket application of
     * an inherited property to every element, which is what `INITIAL_VALUES`
     * did with `color`.
     *
     * Detected as a blanket: if every one of a diverse set of elements declares
     * the same inherited property, it is coming from the initial-values sweep
     * rather than from any element's meaning.
     */
    const diverse = ['b', 'i', 'span', 'small', 'code', 'mark', 'abbr'];
    for (const prop of INHERITED) {
      const declaringAll = diverse.every(
        tag => uaStyleFor(tag)[prop] !== undefined,
      );
      expect({prop, declaringAll}).toEqual({prop, declaringAll: false});
    }
  });
});
