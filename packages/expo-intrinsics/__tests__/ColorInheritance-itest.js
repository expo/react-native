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
 * An author's `color` reaches the elements inside it.
 *
 * `color` is inherited, and the user-agent sheet states it on no element: a
 * per-element declaration would outrank the inherited value, so
 * `<div style={{color:'red'}}><b>` would draw its `<b>` in the sheet's colour.
 * Browsers state it once, at the root, and let it inherit; here the root's
 * value is the renderer's initial colour, CanvasText.
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

test('an element with no author colour above it is left to the platform', () => {
  // CanvasText, `color`'s initial value: nothing states a colour, so the text
  // carries none and the platform draws its own label colour, which follows
  // the appearance. An unset colour reads as the null colour here.
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
  expect(colorsOf(root)).toContain('"foregroundColor":"rgba(0, 0, 0, 0)"');
});

/*
 * The structural guarantee.
 *
 * `PlatformColor` resolves to nothing in Fantom, so a rendered-output test
 * cannot see a per-element user-agent colour: it vanishes here and shows only
 * on a device, where it resolves and outranks the inherited value. So the rule
 * is asserted on the sheet itself: an inherited property is never stated per
 * element.
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
     * an inherited property to every element, which is what a property in
     * `INITIAL_VALUES` would be.
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
