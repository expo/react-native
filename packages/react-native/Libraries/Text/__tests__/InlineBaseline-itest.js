/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

// These exercise the INLINE ELEMENT machinery — padding, borders, baselines —
// not HTML. <inline> and <block> are react-native's own example elements, so
// the tests do not borrow a tag from the element catalog to test their own
// layout. See fixtures/exampleElements.js.
import './fixtures/exampleElements';
import '@react-native/expo-intrinsics-poc';

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

describe('atomic inline vertical alignment', () => {
  it('a taller chip: baseline-aligned or line-filling?', () => {
    const lineRef = createRef<HostInstance>();
    const chipRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          ref={lineRef}
          collapsable={false}
          style={{display: 'block', width: 300}}>
          {'status '}
          {/* $FlowExpectedError[not-a-component] */}
          <inline ref={chipRef} style={{display: 'inline-flex'}}>
            <View style={{width: 8, height: 40}} collapsable={false} />
          </inline>
          {' after'}
        </View>,
      );
    });
    const line = rectOf(lineRef);
    const chip = rectOf(chipRef);
    console.log(
      `tall chip: line h=${line.height} | chip top=${chip.y - line.y} ` +
        `h=${chip.height} bottom=${chip.y - line.y + chip.height}`,
    );
    expect(chip.height).toBe(40);
  });

  it('reports where the chip sits in the line', () => {
    const lineRef = createRef<HostInstance>();
    const chipRef = createRef<HostInstance>();
    const dotRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          ref={lineRef}
          collapsable={false}
          style={{display: 'block', width: 300}}>
          {'status '}
          {/* $FlowExpectedError[not-a-component] */}
          <inline
            ref={chipRef}
            style={{
              display: 'inline-flex',
              flexDirection: 'row',
              gap: 4,
              alignItems: 'center',
              paddingHorizontal: 6,
            }}>
            <View
              ref={dotRef}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            {'ready'}
          </inline>
          {' — flowing inline'}
        </View>,
      );
    });

    const line = rectOf(lineRef);
    const chip = rectOf(chipRef);
    const dot = rectOf(dotRef);
    console.log(
      `line h=${line.height} | chip top=${chip.y - line.y} h=${chip.height} ` +
        `bottom=${chip.y - line.y + chip.height} | dot top=${dot.y - line.y} h=${dot.height}`,
    );
    expect(chip.height).toBeGreaterThan(0);
  });

  // CSS2 §10.8.1: an atomic inline's baseline is the baseline of its last
  // in-flow line box, so a box of a FIXED size still sits differently in its
  // line depending on the type inside it. Two 60x40 boxes, one holding 10pt
  // text and one 30pt, must not land in the same place.
  //
  // The surrounding text is deliberately much larger than the boxes. A box
  // that is the tallest thing on its line has its top AT the line top whatever
  // its baseline is, and then every candidate answer agrees on 0 — the probe
  // has to leave the box room to float, which the assertions below pin.
  //
  it('an atomic inline of fixed size sits by the baseline of its own text', () => {
    function Line({
      lineRef,
      boxRef,
      fontSize,
      text,
    }: {
      lineRef: {current: HostInstance | null},
      boxRef: {current: HostInstance | null},
      fontSize: number,
      text: string,
    }) {
      return (
        <View
          ref={lineRef}
          collapsable={false}
          // $FlowExpectedError[incompatible-type] inheritable text prop
          style={{display: 'block', width: 400, fontSize: 60}}>
          {'before '}
          {/* $FlowExpectedError[not-a-component] */}
          <inline
            ref={boxRef}
            style={{
              display: 'inline-block',
              width: 60,
              height: 40,
              fontSize,
            }}>
            {text}
          </inline>
          {' after'}
        </View>
      );
    }

    const smallLineRef = createRef<HostInstance>();
    const smallBoxRef = createRef<HostInstance>();
    const largeLineRef = createRef<HostInstance>();
    const largeBoxRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View collapsable={false}>
          <Line
            lineRef={smallLineRef}
            boxRef={smallBoxRef}
            fontSize={10}
            text={'x'}
          />
          <Line
            lineRef={largeLineRef}
            boxRef={largeBoxRef}
            fontSize={30}
            text={'y'}
          />
        </View>,
      );
    });

    const smallBox = rectOf(smallBoxRef);
    const largeBox = rectOf(largeBoxRef);
    const smallLine = rectOf(smallLineRef);
    const largeLine = rectOf(largeLineRef);
    const smallOffset = smallBox.y - smallLine.y;
    const largeOffset = largeBox.y - largeLine.y;
    console.log(
      `atomic inline baseline: 10pt box top=${smallOffset} | 30pt box top=${largeOffset}`,
    );

    // The premise: the boxes really are the same size, so nothing but the
    // baseline can separate them.
    expect(smallBox.height).toBe(40);
    expect(largeBox.height).toBe(40);
    expect(smallBox.width).toBe(60);
    expect(largeBox.width).toBe(60);

    // And the probe is a live one: each box is shorter than its line and is
    // free to sit anywhere in it.
    expect(smallLine.height).toBeGreaterThan(40);
    expect(largeLine.height).toBeGreaterThan(40);

    // Larger text inside means a lower baseline inside, so the box rides
    // HIGHER in the line.
    expect(largeOffset).toBeLessThan(smallOffset);
  });

  // The rest of CSS2 §10.8.1, pinned to Safari. Each case renders an
  // inline-block of a fixed 60x40 in a 60pt line, so the box is free to float
  // and every answer is distinguishable; the ASSERTIONS are relative
  // (which case matches which) rather than absolute pixel values, because the
  // system font's metrics differ between Safari and this engine. Safari's own
  // numbers are quoted per case as the source of the relation.
  describe('the last in-flow line box (CSS2 §10.8.1)', () => {
    // `MixedElement`, not `Node`: every case below is a JSX element, and
    // `cloneElement` needs one — `React.Node` also admits strings, arrays and
    // undefined, none of which can be cloned.
    type Case = {name: string, node: React.MixedElement};

    function measure(cases: Array<Case>): {[string]: number} {
      const lineRefs: {[string]: {current: HostInstance | null}} = {};
      const boxRefs: {[string]: {current: HostInstance | null}} = {};
      const root = Fantom.createRoot();
      Fantom.runTask(() => {
        root.render(
          <View collapsable={false}>
            {cases.map(c => {
              lineRefs[c.name] = createRef<HostInstance>();
              boxRefs[c.name] = createRef<HostInstance>();
              return (
                <View
                  key={c.name}
                  ref={lineRefs[c.name]}
                  collapsable={false}
                  style={{display: 'block', width: 400, fontSize: 60}}>
                  {'before '}
                  {/* The cases are catalog intrinsics — `<inline>` is a string
                      element Flow has no component type for, same as the
                      `not-a-component` suppressions on each case below. The
                      clone itself is ordinary. */}
                  {/* $FlowExpectedError[incompatible-type] */}
                  {React.cloneElement(c.node, {ref: boxRefs[c.name]})}
                  {' after'}
                </View>
              );
            })}
          </View>,
        );
      });
      const out: {[string]: number} = {};
      for (const c of cases) {
        out[c.name] = rectOf(boxRefs[c.name]).y - rectOf(lineRefs[c.name]).y;
      }
      console.log('§10.8.1 box tops: ' + JSON.stringify(out));
      return out;
    }

    const BOX = {display: 'inline-block', width: 60, height: 40} as const;

    it('descends into child blocks, at any depth', () => {
      // Safari: direct 48, one level 48, two levels 48 (10pt);
      //         direct 29, one level 29, two levels 29 (30pt).
      const tops = measure([
        // $FlowExpectedError[not-a-component]
        {
          name: 'direct10',
          node: <inline style={{...BOX, fontSize: 10}}>{'x'}</inline>,
        },
        {
          name: 'nested10',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 10}}>{'x'}</View>
            </inline>
          ),
        },
        {
          name: 'deep10',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              <View>
                {/* $FlowExpectedError[incompatible-type] */}
                <View style={{fontSize: 10}}>{'x'}</View>
              </View>
            </inline>
          ),
        },
        // $FlowExpectedError[not-a-component]
        {
          name: 'direct30',
          node: <inline style={{...BOX, fontSize: 30}}>{'y'}</inline>,
        },
        {
          name: 'nested30',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30}}>{'y'}</View>
            </inline>
          ),
        },
      ]);
      expect(tops.nested10).toBe(tops.direct10);
      expect(tops.deep10).toBe(tops.direct10);
      expect(tops.nested30).toBe(tops.direct30);
      // And the two type sizes still separate, so the equalities above are
      // not just "everything lands in the same place".
      expect(tops.direct30).not.toBe(tops.direct10);
    });

    it('takes the LAST line box, skips one that does not exist, and ignores out-of-flow boxes', () => {
      // Safari: empty box 18, absolute-only 18, float-only 18 (all the bottom
      // edge); two stacked blocks 13 (the last, 10pt, one wins — its baseline
      // is 45 inside a 40pt box); a trailing EMPTY block falls back to the
      // 30pt block at 29.
      const tops = measure([
        // $FlowExpectedError[not-a-component]
        {name: 'empty', node: <inline style={BOX} />},
        {
          name: 'absoluteOnly',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{position: 'absolute', fontSize: 30}}>{'y'}</View>
            </inline>
          ),
        },
        {
          name: 'twoBlocks',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30}}>{'y'}</View>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 10}}>{'x'}</View>
            </inline>
          ),
        },
        {
          name: 'trailingEmpty',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30}}>{'y'}</View>
              <View />
            </inline>
          ),
        },
        {
          name: 'nested30',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30}}>{'y'}</View>
            </inline>
          ),
        },
      ]);
      // An absolutely positioned child is not in the flow, so the box has no
      // line box at all and falls back to its bottom edge — same as empty.
      expect(tops.absoluteOnly).toBe(tops.empty);
      // The last line box wins, and it is NOT the same as the first one's.
      expect(tops.twoBlocks).not.toBe(tops.nested30);
      // A trailing block with no line box is skipped, not answered for.
      expect(tops.trailingEmpty).toBe(tops.nested30);
    });

    it('a clipped descendant offers its bottom edge, but only if it has a line box', () => {
      // Safari: clipped 30pt child 23 — between the line box's own 29 and the
      // box's bottom edge at 18; a clipped EMPTY child gives 18.
      const tops = measure([
        // $FlowExpectedError[not-a-component]
        {name: 'empty', node: <inline style={BOX} />},
        {
          name: 'clippedWithText',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30, overflow: 'hidden'}}>{'y'}</View>
            </inline>
          ),
        },
        {
          name: 'clippedEmpty',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              <View style={{overflow: 'hidden', height: 0}} />
            </inline>
          ),
        },
        {
          name: 'nested30',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 30}}>{'y'}</View>
            </inline>
          ),
        },
      ]);
      // Clipping hides the line box, so the child aligns by its own bottom
      // edge instead — neither the line box's answer nor the box's own.
      expect(tops.clippedWithText).not.toBe(tops.nested30);
      expect(tops.clippedWithText).not.toBe(tops.empty);
      // But clipping does not conjure a baseline out of nothing.
      expect(tops.clippedEmpty).toBe(tops.empty);
    });

    it('offsets accumulate through padding and margins', () => {
      // Safari: a 12pt top margin on the inner block moves the baseline by
      // exactly 12, so the box top moves by 12 the other way.
      const tops = measure([
        {
          name: 'plain',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 10}}>{'x'}</View>
            </inline>
          ),
        },
        {
          name: 'margin12',
          // $FlowExpectedError[not-a-component]
          node: (
            <inline style={BOX}>
              {/* $FlowExpectedError[incompatible-type] */}
              <View style={{fontSize: 10, marginTop: 12}}>{'x'}</View>
            </inline>
          ),
        },
      ]);
      expect(tops.plain - tops.margin12).toBe(12);
    });
  });
});
