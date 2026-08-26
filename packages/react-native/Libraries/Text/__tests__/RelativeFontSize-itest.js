/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

/**
 * `em` and `rem` on `font-size`, against css-values-4 §5.1.1.
 *
 * The two units differ in exactly one way — which size they multiply — so every
 * test here is really about the BASE, and the interesting cases are the ones
 * where the two bases differ. An element at the top of a document inherits the
 * root's size, `em` and `rem` agree, and a wrong implementation passes; nesting
 * one inside a restyled container is what tells them apart. That is the shape
 * of the bug this file was written for, so most of it renders nested.
 *
 * ## How a font size is observed
 *
 * Through the baseline-shift reserve. A shifted fragment reserves `fontSize/2`
 * above the line, and it is the one font-size-derived number this renderer
 * exposes to a test — Fantom's text advance is a fixed width per character, so
 * glyph widths say nothing about the resolved size.
 *
 * ## Why almost nothing here asserts a number
 *
 * The reserve is only PROPORTIONAL to the font size: the box it lands in is
 * snapped to the pixel grid, and for a text node Yoga ceils rather than rounds
 * (so a glyph is never clipped). Reconstructing points through that is
 * arithmetic about the snapping, not about the units.
 *
 * So the method is A/B. State a size two ways — relatively, and as the absolute
 * size it should resolve to — and require the two boxes to come out IDENTICAL.
 * Same element, same content, same rounding; the only difference is the
 * spelling, so any difference in the result is the resolution.
 *
 * That also makes the file say nothing about the root font size, which it must
 * not: the root here is the PLATFORM's body text size on purpose — 17 on iOS,
 * 16 on Android, 16 on the web —
 * `DOM-CSS-DEVIATION(root-font-size-is-native-not-16px)`. A test that asserted
 * points would fail on one of them for the one reason that is not a bug. Ratios
 * survive the root changing, and the ratios are what the spec actually states.
 */

const LINE_HEIGHT = 20;
const WIDTH = 400;

/*
 * A style, as these helpers pass one around.
 *
 * An indexer rather than a named set of keys, because the whole point is to
 * vary which property states the size — and read-only, because nothing here
 * mutates one and Flow will not let an indexed object be passed by value
 * otherwise.
 */
type Style = {readonly [string]: unknown};

/*
 * Merge a caller's style over the helper's defaults, caller wins.
 *
 * Both sides arrive as `Style` — indexed — on purpose. Flow refuses to spread
 * an indexed object AFTER explicit keys, because the indexer could overwrite
 * them in a way it cannot track, so the defaults cannot be written inline at
 * the spread. Naming them as a parameter makes both operands indexed and the
 * spread legal, with the precedence still stated by the order.
 */
function withDefaults(defaults: Style, style: Style): Style {
  return {...defaults, ...style};
}

/**
 * The baseline-shift reserve a `<sup>` claims inside `style`, in points.
 *
 * Proportional to the resolved font size and not equal to it — see the file
 * comment. Only ever compared against another reading from this same function.
 */
function reserveUnder(
  style: Style,
  outer?: Style,
  supStyle?: Style,
  Tag: string = 'div',
): number {
  const root = Fantom.createRoot({viewportWidth: WIDTH, viewportHeight: 300});
  const ref = createRef<unknown>();
  const Element: $FlowFixMe = Tag;
  const inner = (
    <Element
      ref={ref}
      style={withDefaults({width: WIDTH, lineHeight: LINE_HEIGHT}, style)}>
      {'x'}
      {/* $FlowFixMe[incompatible-type] */}
      <sup style={supStyle}>2</sup>
    </Element>
  );
  Fantom.runTask(() => {
    root.render(
      outer != null ? (
        // $FlowFixMe[incompatible-type]
        <div style={withDefaults({width: WIDTH}, outer)}>{inner}</div>
      ) : (
        inner
      ),
    );
  });
  // $FlowFixMe[incompatible-use]
  const height = ref.current.getBoundingClientRect().height;
  root.destroy();
  return height - LINE_HEIGHT;
}

/**
 * Assert that stating a size relatively lands on exactly the same box as
 * stating it absolutely.
 */
function resolvesTo(relative: Style, absolute: number, outer?: Style) {
  expect(reserveUnder(relative, outer)).toBe(
    reserveUnder({fontSize: absolute}, outer),
  );
}

describe('font-size in em', () => {
  it('multiplies the size the element inherited', () => {
    // The base is the PARENT's computed size, so `0.5em` under 40 is 20 —
    // whatever the root happens to be.
    resolvesTo({fontSizeEm: 0.5}, 20, {fontSize: 40});
    resolvesTo({fontSizeEm: 2}, 60, {fontSize: 30});
    resolvesTo({fontSizeEm: 1}, 24, {fontSize: 24});
  });

  it('tracks the inherited size rather than staying constant', () => {
    /*
     * The bug in one assertion. `em` implemented as `rem` gives the same
     * absolute size whatever the element inherited, so it is the ratio between
     * two different parents — not either value — that tells them apart.
     */
    const small = reserveUnder({fontSizeEm: 1}, {fontSize: 15});
    const large = reserveUnder({fontSizeEm: 1}, {fontSize: 45});
    expect(large).toBeGreaterThan(small);
    expect(reserveUnder({fontSizeEm: 1}, {fontSize: 45})).toBe(
      reserveUnder({fontSize: 45}, {fontSize: 15}),
    );
  });

  it('compounds through nesting', () => {
    /*
     * `em` is relative to the parent, so a chain multiplies: 40 → 0.5em → 20 →
     * 0.5em → 10. A `rem` in the same shape would give the root's size twice
     * and land on the root's size, not a quarter of 40.
     */
    const root = Fantom.createRoot({viewportWidth: WIDTH, viewportHeight: 300});
    const ref = createRef<unknown>();
    Fantom.runTask(() => {
      root.render(
        // $FlowFixMe[incompatible-type]
        <div style={{width: WIDTH, fontSize: 40}}>
          {/* $FlowFixMe[incompatible-type] */}
          <div style={{width: WIDTH, fontSizeEm: 0.5}}>
            {/* $FlowFixMe[incompatible-type] */}
            <div
              ref={ref}
              style={{width: WIDTH, lineHeight: LINE_HEIGHT, fontSizeEm: 0.5}}>
              {'x'}
              {/* $FlowFixMe[incompatible-type] */}
              <sup>2</sup>
            </div>
          </div>
        </div>,
      );
    });
    // $FlowFixMe[incompatible-use]
    const height = ref.current.getBoundingClientRect().height;
    root.destroy();
    expect(height - LINE_HEIGHT).toBe(reserveUnder({fontSize: 10}));
  });

  it('resolves against the initial value when nothing is inherited', () => {
    // Nothing above states a size, so the base is the size an element starts
    // at. `1em` there has to be a no-op, whatever that size is per platform.
    expect(reserveUnder({fontSizeEm: 1})).toBe(reserveUnder({}));
  });
});

describe('font-size in rem', () => {
  it('ignores the inherited size', () => {
    /*
     * The whole of the difference. Under a 40pt parent and under no parent at
     * all, one `rem` is one number — which is what `em` is not.
     */
    expect(reserveUnder({fontSizeRem: 2}, {fontSize: 40})).toBe(
      reserveUnder({fontSizeRem: 2}),
    );
    expect(reserveUnder({fontSizeRem: 2}, {fontSize: 40})).toBe(
      reserveUnder({fontSizeRem: 2}, {fontSize: 8}),
    );
  });

  it('is the root’s size, which is the initial value here', () => {
    // Nothing has restyled the root, so `1rem` is the size an element starts
    // at — asserted as an identity so the platform's own number stays out of
    // it.
    expect(reserveUnder({fontSizeRem: 1}, {fontSize: 40})).toBe(
      reserveUnder({}),
    );
  });

  it('does not compound through nesting', () => {
    /*
     * `2rem` inside `2rem` is `2rem`, not `4rem`. The inner element inherits
     * twice the root's size and must ignore it — which is exactly the step an
     * `em` would take.
     */
    const root = Fantom.createRoot({viewportWidth: WIDTH, viewportHeight: 300});
    const ref = createRef<unknown>();
    Fantom.runTask(() => {
      root.render(
        // $FlowFixMe[incompatible-type]
        <div style={{width: WIDTH, fontSizeRem: 2}}>
          {/* $FlowFixMe[incompatible-type] */}
          <div
            ref={ref}
            style={{width: WIDTH, lineHeight: LINE_HEIGHT, fontSizeRem: 2}}>
            {'x'}
            {/* $FlowFixMe[incompatible-type] */}
            <sup>2</sup>
          </div>
        </div>,
      );
    });
    // $FlowFixMe[incompatible-use]
    const height = ref.current.getBoundingClientRect().height;
    root.destroy();
    expect(height - LINE_HEIGHT).toBe(reserveUnder({fontSizeRem: 2}));
  });

  it('names the surface root, which no app-rendered element is', () => {
    /*
     * WHAT "the root element" is here, stated so it cannot drift.
     *
     * On the web it is `<html>`, which an author can style. React Native's
     * equivalent is the SURFACE ROOT — the node the layout walk starts from —
     * and everything an app renders is already a child of it. So an app's
     * outermost element is not the root, and restyling it moves every `em`
     * below it and no `rem` at all.
     *
     * DOM-CSS-LIMITATION(rem-root-is-the-unstylable-surface-root): there is no
     * way for an app to state the root's font size, so `rem` resolves to the
     * platform's body size for the life of the surface. The native lever for
     * moving all text at once is the user's own text-size setting, which
     * arrives as `fontSizeMultiplier` and scales the resolved sizes after the
     * fact rather than through this base.
     */
    for (const outerSize of [12, 30, 60]) {
      expect(reserveUnder({fontSizeRem: 1}, {fontSize: outerSize})).toBe(
        reserveUnder({}),
      );
    }
  });

  it('uses font-size’s initial value on the root element itself', () => {
    /*
     * css-values-4 §5.1.1's one special case, and the only place `rem` is not
     * simply "the root's size": ON the root there is no root above it to name,
     * so a `rem` in the root's own `font-size` resolves against the INITIAL
     * value instead. Without that rule the definition is circular.
     *
     * Set up as a root that declares both — an absolute 40 and a `1rem`. The
     * `rem` wins (it is the relative unit), and it must resolve to the initial
     * size rather than to the 40 sitting beside it.
     */
    expect(reserveUnder({fontSize: 40, fontSizeRem: 1})).toBe(reserveUnder({}));
  });
});

describe('the cascade’s origins', () => {
  it('an author’s absolute size beats the user-agent sheet’s em', () => {
    /*
     * css-cascade-4 §6.1: the author origin outranks the user-agent one. The
     * sheet gives `<sup>` `font-size: 0.8333em`; an author stating 10 gets 10.
     *
     * This failed while both values shared the `fontSizeEm` property — the
     * relative declaration took precedence over the absolute one and the
     * author's size was silently discarded. Measured then: a `<sup>` asked for
     * 10pt inside a 40pt parent rendered at 33.3, the user-agent answer. The
     * fix is a `uaFontSizeEm` channel only the sheet writes, so the renderer
     * can see which of the two spoke.
     */
    const parent = {fontSize: 40};
    // An authored 10 must land where a 10pt inline lands, and nowhere near
    // where the user-agent default does.
    expect(reserveUnder({}, parent, {fontSize: 10})).toBe(
      reserveUnder({fontSize: 10}, parent, {fontSize: 10}),
    );
    expect(reserveUnder({}, parent, {fontSize: 10})).not.toBe(
      reserveUnder({}, parent),
    );
  });

  it('an author’s em beats the user-agent sheet’s em', () => {
    // The same precedence where both declarations are relative, so the only
    // thing separating them is the origin.
    const parent = {fontSize: 40};
    expect(reserveUnder({}, parent, {fontSizeEm: 0.25})).toBe(
      reserveUnder({}, parent, {fontSize: 10}),
    );
  });

  it('a block element’s user-agent em reaches its descendants', () => {
    /*
     * `<pre>` is given `font-size: 0.8125em` by the sheet, and it is a BLOCK
     * element — its props are a View's, not a `<Text>`'s. While only the text
     * path carried an `em` factor, this declaration was dropped on the floor:
     * `<pre>` passed its parent's size straight through and everything inside
     * it was drawn at a size `<pre>` itself was not.
     *
     * Asserted as the A/B it is: inheriting 40 with `0.8125em` must land
     * exactly where an explicit 32.5 does.
     */
    const inherited = 40;
    const resolved = 0.8125 * inherited;
    const viaEm = reserveUnder({}, {fontSize: inherited}, undefined, 'pre');
    const viaPoints = reserveUnder(
      {fontSize: resolved},
      {fontSize: inherited},
      undefined,
      'pre',
    );
    expect(viaEm).toBe(viaPoints);
    // And specifically NOT the size it inherited, which is what dropping the
    // declaration produced.
    expect(viaEm).not.toBe(
      reserveUnder({fontSize: inherited}, undefined, undefined, 'pre'),
    );
  });
});
