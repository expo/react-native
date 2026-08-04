/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect();
}

describe('inline-flex chip (css-display-3 §2)', () => {
  it('lays its children out like a flex row', () => {
    const spanRef = createRef<HostInstance>();
    const spanDotRef = createRef<HostInstance>();
    const viewRef = createRef<HostInstance>();
    const viewDotRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    // `flexDirection: 'row'` is explicit because React Native defaults a flex
    // container to `column` where CSS defaults to `row` — worth knowing, and
    // not what this test is about.
    const style = {
      display: 'inline-flex',
      flexDirection: 'row',
      gap: 4,
      alignItems: 'center',
      paddingHorizontal: 6,
    };

    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[not-a-component] */}
          <span ref={spanRef} style={style}>
            <View
              ref={spanDotRef}
              style={{width: 8, height: 8}}
              collapsable={false}
            />
            {'ready'}
          </span>
          {/* The same children in a plain flex row, as the control. */}
          <View
            ref={viewRef}
            collapsable={false}
            style={{...style, display: 'flex', alignSelf: 'flex-start'}}>
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

    const span = rectOf(spanRef);
    const spanDot = rectOf(spanDotRef);
    const view = rectOf(viewRef);
    const viewDot = rectOf(viewDotRef);
    // eslint-disable-next-line no-console
    console.log(
      `span w=${span.width} h=${span.height} dot@(${spanDot.x - span.x},${spanDot.y - span.y}) | ` +
        `view w=${view.width} h=${view.height} dot@(${viewDot.x - view.x},${viewDot.y - view.y})`,
    );
    // Its children ARE laid out as flex items — the offsets match the control.
    expect(spanDot.x - span.x).toBe(viewDot.x - view.x);
    expect(spanDot.y - span.y).toBe(viewDot.y - view.y);

    // DOM-CSS-LIMITATION(inline-flex-does-not-shrink-to-fit): an inline-level
    // box should size to its content, as the control does. Ours fills the
    // containing block instead — measured 300 against the control's 62 — so a
    // chip stretches across the line rather than hugging its label. Asserted
    // as-is rather than skipped, so the day it is fixed this test fails and
    // says why.
    expect(span.width).toBeGreaterThan(view.width);
  });

  it('bare text vs <Text> as a flex sibling', () => {
    const bareDot = createRef<HostInstance>();
    const bareBox = createRef<HostInstance>();
    const textDot = createRef<HostInstance>();
    const textBox = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const style = {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 6,
    };

    Fantom.runTask(() => {
      root.render(
        <View style={{width: 300}}>
          <View ref={bareBox} collapsable={false} style={style}>
            <View ref={bareDot} style={{width: 8, height: 8}} collapsable={false} />
            {'ready'}
          </View>
          <View ref={textBox} collapsable={false} style={style}>
            <View ref={textDot} style={{width: 8, height: 8}} collapsable={false} />
            <Text>ready</Text>
          </View>
        </View>,
      );
    });

    const bb = rectOf(bareBox);
    const bd = rectOf(bareDot);
    const tb = rectOf(textBox);
    const td = rectOf(textDot);
    // eslint-disable-next-line no-console
    console.log(
      `bare  box w=${bb.width} h=${bb.height} dot@(${bd.x - bb.x},${bd.y - bb.y}) | ` +
        `text box w=${tb.width} h=${tb.height} dot@(${td.x - tb.x},${td.y - tb.y})`,
    );
    expect(bb.width).toBe(tb.width);
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
          <span
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
          </span>
          {' — flowing inline'}
        </View>,
      );
    });

    const chip = rectOf(chipRef);
    const dot = rectOf(dotRef);
    // eslint-disable-next-line no-console
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
