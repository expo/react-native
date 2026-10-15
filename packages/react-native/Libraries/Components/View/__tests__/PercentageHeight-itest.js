/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */

/**
 * Percentage heights resolve the web's way: against a DEFINITE containing-block
 * height only (css-sizing-3 §5.1.2), and compute to `auto` otherwise. Yoga's
 * own rule resolves them against the available height, which lets a
 * `height: 100%` box under an auto-height parent take the grandparent's free
 * space. The rule is Yoga's WebPercentageHeights feature, on with
 * `enableYogaDisplayBlock`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {ViewStyleProp} from '../../../StyleSheet/StyleSheet';
import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {ScrollView, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function heightOf(ref: {current: HostInstance | null}): number {
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect()
    .height;
}

describe('percentage heights', () => {
  it('computes to auto under an auto-height parent in a column', () => {
    // The Astryx shape: a column stack holding a centred Section whose inner
    // box is `height: 100%`, and a tall sibling. Yoga's rule gave the Section
    // the column's whole height (header + gap + sibling) and pushed the
    // sibling below it.
    const centerRef = createRef<HostInstance>();
    const innerRef = createRef<HostInstance>();
    const siblingRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View style={{flexDirection: 'column', gap: 32}}>
          <View
            ref={centerRef}
            style={{flexDirection: 'row', justifyContent: 'center'}}>
            <View style={{maxWidth: 680}}>
              <View ref={innerRef} style={{height: '100%'}}>
                <View style={{height: 138, width: 300}} />
              </View>
            </View>
          </View>
          <View ref={siblingRef} style={{height: 1461}} />
        </View>,
      );
    });
    expect(heightOf(innerRef)).toBe(138);
    expect(heightOf(centerRef)).toBe(138);
    expect(
      ensureInstance(
        siblingRef.current,
        ReactNativeElement,
      ).getBoundingClientRect().y,
    ).toBe(138 + 32);
  });

  it('resolves against a parent with a definite height', () => {
    const halfRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View style={{height: 300}}>
          <View ref={halfRef} style={{height: '50%'}} />
        </View>,
      );
    });
    expect(heightOf(halfRef)).toBe(150);
  });

  it('resolves against a flex item stretched to a definite cross size', () => {
    // css-flexbox-1 §9.8: a stretched item's cross size is definite
    const innerRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View style={{flexDirection: 'row', height: 200}}>
          <View style={{width: 100}}>
            <View ref={innerRef} style={{height: '100%'}} />
          </View>
        </View>,
      );
    });
    expect(heightOf(innerRef)).toBe(200);
  });

  it('computes to auto under an auto-height block', () => {
    const innerRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block'}}>
          <View style={{display: 'block'}}>
            <View ref={innerRef} style={{display: 'block', height: '100%'}}>
              <View style={{height: 40}} />
            </View>
          </View>
          <View style={{height: 500}} />
        </View>,
      );
    });
    expect(heightOf(innerRef)).toBe(40);
  });

  it('resolves again when the owner changes and the available size does not', () => {
    // Astryx's Centered Hero in the app: a page laid out first in the scroll
    // view's whole frame, then in the screen below the bar. The cached layout
    // of `min-height: 100%` was keyed on the available sizes, which did not
    // change, so the content kept the frame's 874 and the page scrolled.
    const contentRef = createRef<HostInstance>();
    const page = (surface: ViewStyleProp) => (
      <ScrollView style={{height: 874}}>
        <View style={surface}>
          <View style={{display: 'block', height: '100%', flexGrow: 1}}>
            <View
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}>
              <View
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  flex: 1,
                  minHeight: 0,
                }}>
                <View style={{display: 'block', flexGrow: 1, minHeight: 0}}>
                  <View
                    ref={contentRef}
                    style={{
                      display: 'block',
                      minHeight: '100%',
                      flexShrink: 0,
                    }}>
                    <View style={{height: 300}} />
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    );
    const root = Fantom.createRoot({viewportWidth: 402, viewportHeight: 874});
    Fantom.runTask(() => {
      root.render(page({display: 'block', minHeight: 874}));
    });
    expect(heightOf(contentRef)).toBe(874);
    Fantom.runTask(() => {
      root.render(
        page({display: 'flex', flexDirection: 'column', minHeight: 758}),
      );
    });
    expect(heightOf(contentRef)).toBe(758);
  });
});
