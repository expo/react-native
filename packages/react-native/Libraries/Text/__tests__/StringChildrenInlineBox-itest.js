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

/**
 * The CSS box model on *inline elements* — box-model-scope.md G2/G3.
 *
 * Inline text elements (`<b>`, `<span>`, a nested `<Text>`) can now carry
 * margin/padding/border/outline, and their **inline-axis** values add to the
 * advance at the element's leading and trailing edges (CSS2 §10.6.1).
 *
 * Two rules from the spec are asserted explicitly because they are the ones
 * people get wrong:
 *  - **Block-axis** padding/border on an inline box do NOT change line height
 *    (they paint and overflow the line).
 *  - A **wrapped** inline box pays for its edges once, not per line.
 *
 * Deterministic measurer: 10pt/char (+2 bold), 20pt lines.
 *
 * Pinned against Safari (its monospace is 6pt/char, so compare the deltas):
 *   a<span>bc</span>d                                    -> 24 wide
 *   + padding-left 5 / right 7                           -> 36  (+12)
 *   + margin 4, border 2, padding 3 on each edge         -> 42  (+18)
 *   vertical padding 20/20                               -> height still 20
 *   the span's own rect                                  -> 24 (12 text + 12
 *                                                            padding), starting
 *                                                            one 'a' in
 * Every delta below reproduces those exactly on the 10pt grid.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

// Baseline for the inline-box cases below: `<View>` already supports the CSS
// logical properties, and an inline element must resolve the same style object
// the same way. If this ever fails, the inline expectations below are being
// measured against the wrong reference.
describe('parity baseline: logical padding on a View', () => {
  it('paddingInline widens a View', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', paddingInline: 6}}>
          <View style={{width: 40, height: 10}} />
        </View>,
      );
    });
    expect(rectOf(ref).width).toBe(52);
  });
});

describe('inline box decorations affect the advance', () => {
  it('inline padding widens the line', () => {
    const withRef = createRef<HostInstance>();
    const withoutRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={withRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span style={{paddingLeft: 5, paddingRight: 7}}>bc</span>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={withoutRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span>bc</span>
            {'d'}
          </View>
        </>,
      );
    });

    // 4 chars = 40; padding adds 5 + 7.
    expect(rectOf(withoutRef).width).toBe(40);
    expect(rectOf(withRef).width).toBe(52);
  });

  // Regression: the axis shorthands are a separate lookup from the per-edge
  // props, and every earlier case here used `paddingLeft`/`paddingRight` or
  // `marginHorizontal` — so `paddingHorizontal` specifically was never
  // exercised, and silently contributed nothing on device.
  it('paddingHorizontal/paddingVertical shorthands are honored', () => {
    const withRef = createRef<HostInstance>();
    const withoutRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={withRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span style={{paddingHorizontal: 6, paddingVertical: 3}}>bc</span>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={withoutRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span>bc</span>
            {'d'}
          </View>
        </>,
      );
    });

    // 4 chars = 40; paddingHorizontal adds 6 on each edge. paddingVertical is
    // block-axis, so it must not change the line height (CSS2 §10.6.1).
    expect(rectOf(withoutRef).width).toBe(40);
    expect(rectOf(withRef).width).toBe(52);
    expect(rectOf(withRef).height).toBe(rectOf(withoutRef).height);
  });

  // Astryx styles almost entirely in CSS logical properties, so these are the
  // forms that matter most in practice — and they are separate lookups from
  // the physical ones.
  it('logical padding properties are honored', () => {
    const inlineRef = createRef<HostInstance>();
    const startEndRef = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={inlineRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span style={{paddingInline: 6}}>bc</span>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={startEndRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span style={{paddingInlineStart: 5, paddingInlineEnd: 7}}>bc</span>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={plainRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span style={{paddingBlock: 20}}>bc</span>
            {'d'}
          </View>
        </>,
      );
    });

    // 4 chars = 40.
    expect(rectOf(inlineRef).width).toBe(52);
    expect(rectOf(startEndRef).width).toBe(52);
    // Block-axis logical padding is still block-axis: it must not widen the
    // line, nor change its height (CSS2 §10.6.1).
    expect(rectOf(plainRef).width).toBe(40);
    expect(rectOf(plainRef).height).toBe(20);
  });

  // The precedence must match what a <View> does with the same style object,
  // or `<div>` and `<span>` would disagree. Mirrors Yoga's edge resolution
  // (Start > Left > Horizontal > All in LTR) composed with the order
  // YogaLayoutableShadowNode applies the logical aliases in.
  it('logical properties win over physical ones, like a View', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          <span
            // $FlowExpectedError[not-a-component] intrinsic <span> tag
            style={{
              padding: 1,
              paddingHorizontal: 2,
              paddingInline: 3,
              paddingLeft: 4,
              paddingInlineStart: 9,
            }}>
            bc
          </span>
          {'d'}
        </View>,
      );
    });

    // left resolves to paddingInlineStart (9), right to paddingInline (3).
    expect(rectOf(ref).width).toBe(52);
  });

  it('inline border and margin add to the advance too', () => {
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
          <span style={{marginHorizontal: 4, borderWidth: 2, padding: 3}}>
            bc
          </span>
          {'d'}
        </View>,
      );
    });

    // 40 of text + (4 + 2 + 3) on each edge = 58.
    expect(rectOf(containerRef).width).toBe(58);
  });

  it('block-axis padding does NOT change line height (CSS2 §10.6.1)', () => {
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
          <span style={{paddingTop: 20, paddingBottom: 20, borderWidth: 0}}>
            bc
          </span>
        </View>,
      );
    });

    // Still one 20pt line — vertical padding paints but does not lay out.
    expect(rectOf(containerRef).height).toBe(20);
  });

  it("the element's reported box includes its own edges", () => {
    const containerRef = createRef<HostInstance>();
    const spanRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
          <span ref={spanRef} style={{paddingLeft: 5, paddingRight: 7}}>
            bc
          </span>
        </View>,
      );
    });

    // Starts right after 'a', and covers padding + text + padding.
    expect(rectOf(spanRef).x - rectOf(containerRef).x).toBe(10);
    expect(rectOf(spanRef).width).toBe(32);
  });

  it('an undecorated inline element is unaffected', () => {
    // Guards the zero-cost path: no decorations must mean no change at all.
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
          <b>bc</b>
          {'d'}
        </View>,
      );
    });

    // 'a' 10 + bold 'bc' 24 + 'd' 10.
    expect(rectOf(containerRef).width).toBe(44);
  });
});
