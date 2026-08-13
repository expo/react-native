/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * CSS floats and clearance in the native block formatting context
 * (CSS2 §9.5; block Stage 4a). Every expectation is pinned against real
 * Safari, using a block container inside a flex column — which is what an RN
 * block container always is.
 *
 * That containment matters and is the one place this deliberately differs
 * from a plain web block: an RN block container is always a flex item or a
 * root, i.e. an **independent formatting context**, so it grows to contain
 * its floats instead of letting them overflow (Safari agrees for the
 * flex-item case, which is the only case RN can produce).
 *
 * Stage 4a covers float placement, packing/wrapping, clearance and container
 * growth. NOT included: line boxes shortening beside a float (text flowing
 * around it) — that needs exclusion rectangles pushed into platform text
 * layout, which the iOS/Android text managers do not expose. In-flow *block*
 * boxes correctly still overlap floats; only their line boxes would change.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

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

describe('floats in a block formatting context', () => {
  it('float actually reaches Yoga (guards the silent-drop trap)', () => {
    // Canary for the three-site wiring rule documented in
    // ReactCommon/.../view/propsConversions.h: a Yoga style prop missing from
    // the convertRawProp list (or from ReactNativeStyleAttributes.js) is
    // dropped silently. This case is chosen so it CANNOT pass if `float` is
    // ignored: an in-flow auto-width block child stretches to the container's
    // 300pt, while a float shrinks to its content — so the widths differ.
    const floatRef = createRef<HostInstance>();
    const inFlowRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{display: 'block', width: 300}}>
          <View
            collapsable={false}
            ref={floatRef}
            // $FlowExpectedError[incompatible-type] CSS float
            style={{float: 'left', height: 10}}>
            {'ab'}
          </View>
          <View collapsable={false} ref={inFlowRef} style={{height: 10}}>
            {'ab'}
          </View>
        </View>,
      );
    });

    expect(rectOf(inFlowRef).width).toBe(300);
    expect(rectOf(floatRef).width).toBeLessThan(300);
  });

  it('a lone float grows the container (independent formatting context)', () => {
    // Safari: container 300x30 for a single 60x30 float.
    const containerRef = createRef<HostInstance>();
    const floatRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          <View
            collapsable={false}
            ref={floatRef}
            // $FlowExpectedError[incompatible-type] CSS float
            style={{float: 'left', width: 60, height: 30}}
          />
        </View>,
      );
    });

    expect(rectOf(containerRef).height).toBe(30);
    expect(rectOf(floatRef).x - rectOf(containerRef).x).toBe(0);
    expect(rectOf(floatRef).y - rectOf(containerRef).y).toBe(0);
  });

  it('a right float sits against the inline end', () => {
    // Safari: f6a at x=240 in a 300-wide container.
    const containerRef = createRef<HostInstance>();
    const floatRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          <View
            collapsable={false}
            ref={floatRef}
            // $FlowExpectedError[incompatible-type] CSS float
            style={{float: 'right', width: 60, height: 30}}
          />
        </View>,
      );
    });

    expect(rectOf(floatRef).x - rectOf(containerRef).x).toBe(240);
  });

  it('an in-flow block sibling still overlaps the float (only line boxes shorten)', () => {
    // Safari: the 20pt block sibling is at 0,0 with the full 300 width, i.e.
    // underneath the float — floats shorten line boxes, not block boxes.
    const containerRef = createRef<HostInstance>();
    const siblingRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          <View collapsable={false} ref={siblingRef} style={{height: 20}} />
        </View>,
      );
    });

    expect(rectOf(siblingRef).x - rectOf(containerRef).x).toBe(0);
    expect(rectOf(siblingRef).y - rectOf(containerRef).y).toBe(0);
    expect(rectOf(siblingRef).width).toBe(300);
    // Container grows to the float, not just the in-flow content.
    expect(rectOf(containerRef).height).toBe(30);
  });

  it('clear pushes a sibling below the float and grows the container', () => {
    // Safari: cleared child at y=30, container 50 tall.
    const containerRef = createRef<HostInstance>();
    const clearedRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          <View
            collapsable={false}
            ref={clearedRef}
            // $FlowExpectedError[incompatible-type] CSS clear
            style={{height: 20, clear: 'left'}}
          />
        </View>,
      );
    });

    expect(rectOf(clearedRef).y - rectOf(containerRef).y).toBe(30);
    expect(rectOf(containerRef).height).toBe(50);
  });

  it('floats pack along the line then wrap below', () => {
    // Safari: six 60-wide floats in a 300-wide container pack five per row
    // (0, 60, 120, 180, 240) then the sixth wraps to (0, 30).
    const containerRef = createRef<HostInstance>();
    const fifthRef = createRef<HostInstance>();
    const sixthRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          <View
            collapsable={false}
            ref={fifthRef}
            // $FlowExpectedError[incompatible-type] CSS float
            style={{float: 'left', width: 60, height: 30}}
          />
          <View
            collapsable={false}
            ref={sixthRef}
            // $FlowExpectedError[incompatible-type] CSS float
            style={{float: 'left', width: 60, height: 30}}
          />
        </View>,
      );
    });

    expect(rectOf(fifthRef).x - rectOf(containerRef).x).toBe(240);
    expect(rectOf(fifthRef).y - rectOf(containerRef).y).toBe(0);
    expect(rectOf(sixthRef).x - rectOf(containerRef).x).toBe(0);
    expect(rectOf(sixthRef).y - rectOf(containerRef).y).toBe(30);
    expect(rectOf(containerRef).height).toBe(60);
  });

  it('clear:both clears floats on either side', () => {
    const containerRef = createRef<HostInstance>();
    const clearedRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 300}}>
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'right', width: 60, height: 40}} />
          <View
            collapsable={false}
            ref={clearedRef}
            // $FlowExpectedError[incompatible-type] CSS clear
            style={{height: 10, clear: 'both'}}
          />
        </View>,
      );
    });

    expect(rectOf(clearedRef).y - rectOf(containerRef).y).toBe(40);
    expect(rectOf(containerRef).height).toBe(50);
  });

  it('floats are ignored by flex containers (block-only feature)', () => {
    // The flex algorithm is untouched: a floated child is still a flex item.
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={containerRef} style={{width: 300}}>
          {/* $FlowExpectedError[incompatible-type] CSS float */}
          <View style={{float: 'left', width: 60, height: 30}} />
          <View style={{height: 20}} />
        </View>,
      );
    });

    // Stacked as flex items: 30 + 20.
    expect(rectOf(containerRef).height).toBe(50);
  });
});
