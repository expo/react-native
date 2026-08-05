/**
 * @flow
 * @format
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
          <span ref={chipRef} style={{display: 'inline-flex'}}>
            <View style={{width: 8, height: 40}} collapsable={false} />
          </span>
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
          <span
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
          </span>
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
});
