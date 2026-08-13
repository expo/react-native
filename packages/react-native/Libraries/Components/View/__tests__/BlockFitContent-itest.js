/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */
/**
 * A block container sized to fit, as a flex item in a centered column is, is
 * min(max-content, max(min-content, available)) wide (css-sizing-3 §5.1). Its
 * children were measured at their max-content, so a paragraph set the block as
 * wide as its whole line and pushed the column's content off the screen.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

const SENTENCE =
  'We cut through the noise and get straight to the work, every time, for every one of you.';

describe('a block container sized to fit', () => {
  it('treats a cyclic percentage as auto while finding a flex basis', () => {
    const mainRef = createRef<HostInstance>();
    const panelRef = createRef<HostInstance>();
    const percentageRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 300});
    Fantom.runTask(() => {
      root.render(
        <View style={{flexDirection: 'row', width: 300}}>
          <View
            ref={mainRef}
            style={{display: 'block', flexGrow: 1, minWidth: 0}}
          />
          <View
            ref={panelRef}
            style={{display: 'block', flexShrink: 0, padding: 16}}>
            <View ref={percentageRef} style={{width: '100%'}}>
              <View style={{width: 100, height: 10}} />
            </View>
          </View>
        </View>,
      );
    });
    expect(rect(mainRef).width).toBe(168);
    expect([rect(panelRef).x, rect(panelRef).width]).toEqual([168, 132]);
    expect(rect(percentageRef).width).toBe(100);
  });

  it('resolves a cyclic percentage against a float after intrinsic sizing', () => {
    const floatRef = createRef<HostInstance>();
    const percentageRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 300});
    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', width: 300}}>
          <View
            ref={floatRef}
            style={{display: 'block', float: 'left', padding: 16}}>
            <View ref={percentageRef} style={{width: '50%'}}>
              <View style={{width: 100, height: 10}} />
            </View>
          </View>
        </View>,
      );
    });
    // The 50% is ignored for the float's intrinsic width, then resolves against
    // its final 100pt content box without changing that intrinsic width.
    expect(rect(floatRef).width).toBe(132);
    expect(rect(percentageRef).width).toBe(50);
  });

  it('wraps its text within the width it was offered', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{flexDirection: 'column', alignItems: 'center', width: 402}}>
          <View ref={blockRef} style={{display: 'block', maxWidth: 800}}>
            <View style={{display: 'block', padding: 24}}>
              <Text>{SENTENCE}</Text>
            </View>
          </View>
        </View>,
      );
    });
    // Within the column. React Native's text reports its widest wrapped line,
    // so the block can be narrower than the 402 a browser gives it
    const block = rect(blockRef);
    expect(block.width).toBeLessThanOrEqual(402);
    expect(block.width).toBeGreaterThan(300);
    expect(block.x).toBe((402 - block.width) / 2);
  });

  it('shrinks to content narrower than the offer', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{flexDirection: 'column', alignItems: 'center', width: 402}}>
          <View ref={blockRef} style={{display: 'block', maxWidth: 800}}>
            <View style={{width: 100, height: 10}} />
          </View>
        </View>,
      );
    });
    const block = rect(blockRef);
    expect([block.x, block.width]).toEqual([151, 100]);
  });

  it('is as wide as content that cannot shrink, its min-content', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View
          style={{flexDirection: 'column', alignItems: 'center', width: 402}}>
          <View ref={blockRef} style={{display: 'block', maxWidth: 800}}>
            <View style={{width: 500, height: 10}} />
          </View>
        </View>,
      );
    });
    expect(rect(blockRef).width).toBe(500);
  });
});
