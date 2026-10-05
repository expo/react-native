/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

// <inline> and <block> are react-native's own example elements
// (fixtures/exampleElements.js), so these tests borrow no catalog tag
import './fixtures/exampleElements';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';
import type {ViewStyleProp} from 'react-native/Libraries/StyleSheet/StyleSheet';

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
    // The dot must sit inside the chip's box in both axes
    expect(dot.y).toBeGreaterThanOrEqual(chip.y);
    expect(dot.y + dot.height).toBeLessThanOrEqual(chip.y + chip.height);
    expect(dot.x).toBeGreaterThanOrEqual(chip.x);
    expect(dot.x + dot.width).toBeLessThanOrEqual(chip.x + chip.width);
  });
});

/*
 * `display` sets the outer display and the inner one (css-display-3 §2), and
 * every `inline-*` value shares one outer display, so one table asks each the
 * same question; that catches a value wired for its inner display alone.
 */
describe('outer display (css-display-3 §2)', () => {
  const TEXT_WIDTH = 20; // 'aa' at the deterministic 10pt cell width

  function xOfBoxAfterText(display: $FlowFixMe) {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          {'aa'}
          <View
            ref={ref}
            style={{display, width: 40, height: 20, verticalAlign: 'top'}}
          />
        </View>,
      );
    });
    const rect = rectOf(ref);
    root.destroy();
    return rect.x;
  }

  for (const display of ['inline-block', 'inline-flex']) {
    it(`display:${display} is inline-level, so it sits on the line after the text`, () => {
      expect(xOfBoxAfterText(display)).toBe(TEXT_WIDTH);
    });
  }

  for (const display of ['block', 'flex', 'grid', 'grid-lanes']) {
    it(`display:${display} is block-level, so it starts a line of its own`, () => {
      expect(xOfBoxAfterText(display)).toBe(0);
    });
  }
});

/*
 * In a block container an inline-level box joins a line, sized to its content;
 * in a flex container it is blockified into a flex item (css-display-3 §2.7)
 * and aligns as the container says, so no rule may force its alignSelf.
 */
describe('inline-level boxes and their formatting context', () => {
  function layOut(container: ViewStyleProp): {
    box: ReturnType<typeof rectOf>,
    container: ReturnType<typeof rectOf>,
  } {
    const boxRef = createRef<HostInstance>();
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View ref={containerRef} collapsable={false} style={container}>
          {/* $FlowExpectedError[not-a-component] */}
          <inline ref={boxRef} style={{display: 'inline-block'}}>
            {'ready'}
          </inline>
        </View>,
      );
    });
    return {box: rectOf(boxRef), container: rectOf(containerRef)};
  }

  it('follows the alignItems of a flex row it is an item of', () => {
    const {box, container} = layOut({
      flexDirection: 'row',
      alignItems: 'center',
      height: 44,
      width: 300,
    });
    expect(box.height).toBeGreaterThan(0);
    expect(box.height).toBeLessThan(44);
    // To the pixel grid, which rounds the offset to a third of a point
    expect(box.top - container.top).toBeCloseTo((44 - box.height) / 2, 0);
  });

  it('stretches across a flex column, as a browser stretches it', () => {
    const {box} = layOut({flexDirection: 'column', width: 300});
    expect(box.width).toBe(300);
  });
});
