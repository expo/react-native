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
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('inline-flex chip (css-display-3 §2)', () => {
  it('lays its children out like a flex row', () => {
    const inlineRef = createRef<HostInstance>();
    const inlineDotRef = createRef<HostInstance>();
    const viewRef = createRef<HostInstance>();
    const viewDotRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    // `flexDirection: 'row'` is explicit because React Native defaults a flex
    // container to `column` where CSS defaults to `row` — worth knowing, and
    // not what this test is about.
    const style = {
      display: 'inline-flex' as const,
      flexDirection: 'row' as const,
      gap: 4,
      alignItems: 'center' as const,
      paddingHorizontal: 6,
    };

    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[not-a-component] */}
          <inline ref={inlineRef} style={style}>
            <View
              ref={inlineDotRef}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            {'ready'}
          </inline>
          {/* The same children in a plain flex row, as the control. */}
          <View
            ref={viewRef}
            collapsable={false}
            style={{
              ...style,
              display: 'flex' as const,
              alignSelf: 'flex-start' as const,
            }}>
            <View
              ref={viewDotRef}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            {'ready'}
          </View>
        </View>,
      );
    });

    const inlineRect = rectOf(inlineRef);
    const inlineDot = rectOf(inlineDotRef);
    const view = rectOf(viewRef);
    const viewDot = rectOf(viewDotRef);
    console.log(
      `inline w=${inlineRect.width} h=${inlineRect.height} dot@(${inlineDot.x - inlineRect.x},${inlineDot.y - inlineRect.y}) | ` +
        `view w=${view.width} h=${view.height} dot@(${viewDot.x - view.x},${viewDot.y - view.y})`,
    );
    // Its children ARE laid out as flex items — the offsets match the control.
    expect(inlineDot.x - inlineRect.x).toBe(viewDot.x - view.x);
    expect(inlineDot.y - inlineRect.y).toBe(viewDot.y - view.y);

    // An inline-level box is shrink-to-fit, so it matches the control exactly
    // rather than stretching across the line.
    expect(inlineRect.width).toBe(view.width);
  });

  it('bare text vs <Text> as a flex sibling', () => {
    const bareDot = createRef<HostInstance>();
    const bareBox = createRef<HostInstance>();
    const textDot = createRef<HostInstance>();
    const textBox = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const style = {
      display: 'flex' as const,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      alignSelf: 'flex-start' as const,
      paddingHorizontal: 6,
    };

    Fantom.runTask(() => {
      root.render(
        <View style={{width: 300}}>
          <View ref={bareBox} collapsable={false} style={style}>
            <View
              ref={bareDot}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            {'ready'}
          </View>
          <View ref={textBox} collapsable={false} style={style}>
            <View
              ref={textDot}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            <Text>ready</Text>
          </View>
        </View>,
      );
    });

    const bb = rectOf(bareBox);
    const bd = rectOf(bareDot);
    const tb = rectOf(textBox);
    const td = rectOf(textDot);
    console.log(
      `bare  box w=${bb.width} h=${bb.height} dot@(${bd.x - bb.x},${bd.y - bb.y}) | ` +
        `text box w=${tb.width} h=${tb.height} dot@(${td.x - tb.x},${td.y - tb.y})`,
    );
    expect(bb.width).toBe(tb.width);
  });

  it('atomic inline boxes shrink to fit', () => {
    const flexRef = createRef<HostInstance>();
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[not-a-component] */}
          <inline ref={flexRef} style={{display: 'inline-flex'}}>
            {'ab'}
          </inline>
          {/* $FlowExpectedError[not-a-component] */}
          <inline ref={blockRef} style={{display: 'inline-block'}}>
            {'ab'}
          </inline>
        </View>,
      );
    });
    console.log(
      `inline-flex w=${rectOf(flexRef).width} inline-block w=${rectOf(blockRef).width} (content is 20)`,
    );
    expect(rectOf(blockRef).width).toBe(20);
    expect(rectOf(flexRef).width).toBe(20);
  });

  it('contains its children', () => {
    const chipRef = createRef<HostInstance>();
    const dotRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          {'status '}
          {/* $FlowExpectedError[not-a-component] */}
          <inline
            ref={chipRef}
            style={{
              display: 'inline-flex',
              gap: 4,
              alignItems: 'center',
              paddingHorizontal: 6,
              borderRadius: 8,
              backgroundColor: '#e6f4ea',
            }}>
            <View
              ref={dotRef}
              style={{width: 8, height: 8, borderRadius: 4}}
              collapsable={false}
            />
            {'ready'}
          </inline>
          {' — flowing inline'}
        </View>,
      );
    });

    const chip = rectOf(chipRef);
    const dot = rectOf(dotRef);
    console.log(
      `chip x=${chip.x} y=${chip.y} w=${chip.width} h=${chip.height} | ` +
        `dot x=${dot.x} y=${dot.y} w=${dot.width} h=${dot.height}`,
    );
    // The dot must sit inside the chip's box in both axes; anything else is
    // the chip clipping or the dot escaping.
    expect(dot.y).toBeGreaterThanOrEqual(chip.y);
    expect(dot.y + dot.height).toBeLessThanOrEqual(chip.y + chip.height);
    expect(dot.x).toBeGreaterThanOrEqual(chip.x);
    expect(dot.x + dot.width).toBeLessThanOrEqual(chip.x + chip.width);
  });
});
