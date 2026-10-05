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
 * The CSS box model on inline elements: inline-axis margin, padding and border
 * add to the advance at the element's edges (CSS2 §10.6.1); block-axis padding
 * and border do not change the line height; a wrapped inline box pays for its
 * edges once. Deterministic measurer: 10pt/char (+2 bold), 20pt lines.
 *
 * Pinned against Safari (its monospace is 6pt/char, so compare the deltas):
 *   a<inline>bc</inline>d                                    -> 24 wide
 *   + padding-left 5 / right 7                           -> 36  (+12)
 *   + margin 4, border 2, padding 3 on each edge         -> 42  (+18)
 *   vertical padding 20/20                               -> height still 20
 *   the inline element's own rect                        -> 24, one 'a' in
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

// <inline> and <block> are react-native's own example elements
// (fixtures/exampleElements.js), so these tests borrow no catalog tag
import './fixtures/exampleElements';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The type size the measurements are calibrated against; the document default
// is the platform's body size and differs per platform
const FONT_SIZE = 14;

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

// The reference for the inline cases: an inline element must resolve the same
// style object the way <View> does
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
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline style={{paddingLeft: 5, paddingRight: 7}}>bc</inline>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={withoutRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline>bc</inline>
            {'d'}
          </View>
        </>,
      );
    });

    // 4 chars = 40; padding adds 5 + 7.
    expect(rectOf(withoutRef).width).toBe(40);
    expect(rectOf(withRef).width).toBe(52);
  });

  // The axis shorthands are a separate lookup from the per-edge props
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
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline style={{paddingHorizontal: 6, paddingVertical: 3}}>
              bc
            </inline>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={withoutRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline>bc</inline>
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

  // The logical properties are separate lookups from the physical ones
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
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline style={{paddingInline: 6}}>bc</inline>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={startEndRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline style={{paddingInlineStart: 5, paddingInlineEnd: 7}}>
              bc
            </inline>
            {'d'}
          </View>
          <View
            collapsable={false}
            ref={plainRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
            <inline style={{paddingBlock: 20}}>bc</inline>
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
  // or `<block>` and `<inline>` would disagree. Mirrors Yoga's edge resolution
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
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          <inline
            // $FlowExpectedError[not-a-component] intrinsic <inline> tag
            style={{
              padding: 1,
              paddingHorizontal: 2,
              paddingInline: 3,
              paddingLeft: 4,
              paddingInlineStart: 9,
            }}>
            bc
          </inline>
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
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
          <inline style={{marginHorizontal: 4, borderWidth: 2, padding: 3}}>
            bc
          </inline>
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
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
          <inline style={{paddingTop: 20, paddingBottom: 20, borderWidth: 0}}>
            bc
          </inline>
        </View>,
      );
    });

    // Still one 20pt line — vertical padding paints but does not lay out.
    expect(rectOf(containerRef).height).toBe(20);
  });

  it("the element's reported box includes its own edges", () => {
    const containerRef = createRef<HostInstance>();
    const inlineRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
          <inline ref={inlineRef} style={{paddingLeft: 5, paddingRight: 7}}>
            bc
          </inline>
        </View>,
      );
    });

    // Starts right after 'a', and covers padding + text + padding.
    expect(rectOf(inlineRef).x - rectOf(containerRef).x).toBe(10);
    expect(rectOf(inlineRef).width).toBe(32);
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
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
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

describe('an inline element keeps DOM metrics while mounting no box', () => {
  // `TextShadowNode::getMountedLayoutMetrics` returns empty metrics so the view
  // an inline element mounts on Android stays a handle; the shadow metrics,
  // which the DOM reports, must survive that
  it('getBoundingClientRect still reports the element box', () => {
    const elementRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
          <inline ref={elementRef} style={{paddingLeft: 5, paddingRight: 7}}>
            bc
          </inline>
          {'d'}
        </View>,
      );
    });

    // 'bc' is 20 wide plus 6 of padding on each edge; a zero would mean the
    // mounted metrics leaked into the shadow tree
    const rect = rectOf(elementRef);
    expect(rect.width).toBe(32);
    expect(rect.height).toBeGreaterThan(0);
  });

  // Logical edges under RTL (css-logical-1 §2): `inline-start` is the left edge
  // in LTR and the right edge in RTL, while physical edges never move. The
  // observable is where the element's content starts, since its box begins
  // right after the preceding glyph whichever edge carries the padding, and
  // every assertion compares within one direction.
  describe('logical inline edges follow the resolved direction', () => {
    function innerOffsets(direction: 'ltr' | 'rtl'): {[string]: number} {
      const cases = {
        logicalStart: {paddingInlineStart: 12},
        physicalLeft: {paddingLeft: 12},
        physicalRight: {paddingRight: 12},
      };
      const containerRefs: {[string]: {current: HostInstance | null}} = {};
      const innerRefs: {[string]: {current: HostInstance | null}} = {};
      const root = Fantom.createRoot();
      Fantom.runTask(() => {
        root.render(
          <View collapsable={false}>
            {Object.keys(cases).map(name => {
              containerRefs[name] = createRef<HostInstance>();
              innerRefs[name] = createRef<HostInstance>();
              return (
                <View
                  key={name}
                  collapsable={false}
                  ref={containerRefs[name]}
                  style={{
                    display: 'block',
                    alignSelf: 'flex-start',
                    direction,
                  }}>
                  {'a'}
                  {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
                  <inline style={cases[name]}>
                    {'c'}
                    {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
                    <b ref={innerRefs[name]}>d</b>
                  </inline>
                </View>
              );
            })}
          </View>,
        );
      });
      const out: {[string]: number} = {};
      for (const name of Object.keys(cases)) {
        out[name] = rectOf(innerRefs[name]).x - rectOf(containerRefs[name]).x;
      }
      console.log(`${direction} inner offsets: ` + JSON.stringify(out));
      return out;
    }

    it('inline-start is the left edge in an LTR line', () => {
      const o = innerOffsets('ltr');
      expect(o.logicalStart).toBe(o.physicalLeft);
      expect(o.logicalStart).not.toBe(o.physicalRight);
    });

    it('a direction flip on an already-built run re-resolves its edges', () => {
      // The flip keeps the run's advance, so the element is never re-cloned
      // yet its box must move
      const containerRef = createRef<HostInstance>();
      const innerRef = createRef<HostInstance>();
      const root = Fantom.createRoot();
      const render = (direction: 'ltr' | 'rtl') => {
        Fantom.runTask(() => {
          root.render(
            <View
              collapsable={false}
              ref={containerRef}
              style={{display: 'block', alignSelf: 'flex-start', direction}}>
              {'a'}
              {/* $FlowExpectedError[not-a-component] intrinsic <inline> tag */}
              <inline style={{paddingInlineStart: 12}}>
                {'c'}
                {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
                <b ref={innerRef}>d</b>
              </inline>
            </View>,
          );
        });
        return rectOf(innerRef).x - rectOf(containerRef).x;
      };

      // LTR puts the 12pt edge before the content; RTL puts it after, so the
      // content starts 12 earlier.
      expect(render('ltr')).toBe(32);
      expect(render('rtl')).toBe(20);
      // And back
      expect(render('ltr')).toBe(32);
    });

    it('inline-start is the right edge in an RTL line', () => {
      const o = innerOffsets('rtl');
      expect(o.logicalStart).toBe(o.physicalRight);
      expect(o.logicalStart).not.toBe(o.physicalLeft);
    });
  });
});
