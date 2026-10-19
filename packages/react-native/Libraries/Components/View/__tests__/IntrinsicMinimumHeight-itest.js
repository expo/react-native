/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */
/**
 * A box whose `min-height` is an intrinsic size is at least as tall as its
 * content (css-sizing-3 §3.2, §5.2). Yoga read the keyword as no minimum, so a
 * bottom sheet's body, `height: 100%; min-height: min-content` in a scroll
 * view, stayed the scroll view's height and the scroll view had nothing past
 * it to scroll to.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('a box whose minimum height is its content', () => {
  it("is its content's height when that is taller than its own", () => {
    const tallRef = createRef<HostInstance>();
    const shortRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View>
          {[
            [tallRef, 432],
            [shortRef, 100],
          ].map(([ref, content], index) => (
            <View key={index} style={{display: 'block', height: 300}}>
              <View
                ref={ref}
                style={{height: '100%', minHeight: 'max-content'}}>
                <View style={{height: content}} />
              </View>
            </View>
          ))}
        </View>,
      );
    });
    expect(rect(tallRef).height).toBe(432);
    expect(rect(shortRef).height).toBe(300);
  });

  it('moves what follows it in a column', () => {
    const boxRef = createRef<HostInstance>();
    const nextRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{height: 300}}>
          <View ref={boxRef} style={{height: 200, minHeight: 'fit-content'}}>
            <View style={{height: 250}} />
          </View>
          <View ref={nextRef} style={{height: 20}} />
        </View>,
      );
    });
    expect(rect(boxRef).height).toBe(250);
    expect(rect(nextRef).y).toBe(250);
  });
});
