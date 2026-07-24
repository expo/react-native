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
 * Native Yoga `display:block` (text-children-plan.md §3.A/§4.5; next-steps T4).
 *
 * `display:'block'` is implemented as a first-class Yoga block formatting
 * context (YGDisplayBlock) instead of the flex column+stretch emulation. This
 * suite has two halves:
 *
 *  - PARITY: the same block-flow cases as StringChildrenBehavior-itest.js M3 (which run
 *    under the emulation), asserting identical layout numbers — the native path
 *    must reproduce the emulation floor exactly.
 *  - FIDELITY: native-only cases the emulation gets wrong — flex item semantics
 *    (flex-grow) must NOT apply to block-level children, because block children
 *    are not flex items.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import {NativeVirtualText} from 'react-native/Libraries/Text/TextNativeComponent';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('native block — parity with the flex emulation', () => {
  it("display:'block' joins text and inline elements into one flow", () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View collapsable={false} ref={oneRunRef}>
            abc
          </View>
        </>,
      );
    });

    // One wrapping inline flow, not three stacked items — same as M3 emulation.
    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });

  it('block containers mix inline flows with block children', () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View collapsable={false} ref={oneRunRef}>
            before
          </View>
        </>,
      );
    });

    // Two anonymous inline flows stacked around a 10pt block child.
    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height * 2 + 10);
  });

  it('block content fills the container width and wraps like the emulation', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', width: 40}}>
          {'a b c d e f'}
        </View>,
      );
    });

    // 11 chars @10pt = 110pt intrinsic; wraps at width 40 (4 chars/line) ->
    // ceil(11/4) = 3 lines. Line height 20 -> 60pt. Same as the emulation.
    expect(rectOf(blockRef).width).toBe(40);
    expect(rectOf(blockRef).height).toBe(60);
  });

  it('bare string under a block View sizes like explicit <Text>', () => {
    const blockRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            hello world
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{alignSelf: 'flex-start'}}>
            <Text>hello world</Text>
          </View>
        </>,
      );
    });

    expect(rectOf(blockRef).height).toBe(rectOf(controlRef).height);
    expect(rectOf(blockRef).width).toBe(rectOf(controlRef).width);
  });
});

describe('native block — fidelity the emulation lacks', () => {
  it('a block-level child does NOT grow to fill (flex-grow ignored)', () => {
    // Block children are not flex items: `flex:1` must not stretch them to fill
    // the container's remaining block space. Under the flex column emulation the
    // child would grow to 90 (100 - the 10pt sibling); native block leaves it at
    // its content height (0).
    const growRef = createRef<HostInstance>();
    const fixedRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{display: 'block', width: 100, height: 100}}>
          <View collapsable={false} ref={fixedRef} style={{height: 10}} />
          <View collapsable={false} ref={growRef} style={{flexGrow: 1}} />
        </View>,
      );
    });

    expect(rectOf(fixedRef).height).toBe(10);
    // The key fidelity assertion: no flex distribution in a block container.
    expect(rectOf(growRef).height).toBe(0);
  });

  it('block-level children stack at content size (no flex distribution)', () => {
    // Two children with flexGrow set: in a flex container they would share the
    // main axis; in a block container they stack at their own heights.
    const outerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={outerRef}
          style={{display: 'block', width: 100, height: 200}}>
          <View collapsable={false} style={{height: 30, flexGrow: 1}} />
          <View collapsable={false} style={{height: 40, flexGrow: 1}} />
        </View>,
      );
    });

    // Container height is fixed (200); children keep their own heights (30, 40)
    // rather than expanding to fill it.
    expect(rectOf(outerRef).height).toBe(200);
  });

  it('the intrinsic <div> tag is a native block container', () => {
    // <div> is backed by the block path; with enableYogaDisplayBlock on it uses
    // native YGDisplayBlock. Inline children join one flow (block-inner), and a
    // block-level child inside it does not flex-grow.
    const divRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div collapsable={false} ref={divRef}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </div>
          <View collapsable={false} ref={oneRunRef}>
            abc
          </View>
        </>,
      );
    });

    expect(rectOf(divRef).height).toBe(rectOf(oneRunRef).height);
  });

  it('a block-level child fills the container content width', () => {
    const childRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{display: 'block', width: 120}}>
          <View collapsable={false} ref={childRef} style={{height: 5}} />
        </View>,
      );
    });

    // Auto-width block child fills the containing block's content width.
    expect(rectOf(childRef).width).toBe(120);
  });
});
