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
 * `display: 'block'` as a Yoga block formatting context (YGDisplayBlock). The
 * parity half repeats the block-flow cases of StringChildrenBehavior-itest.js
 * and asserts identical numbers; the fidelity half covers what a flex column
 * emulation gets wrong: block children are not flex items.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import {NativeVirtualText} from 'react-native/Libraries/Text/TextNativeComponent';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The type size the measurements are calibrated against; the document default
// is the platform's body size and differs per platform
const FONT_SIZE = 14;

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
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
            abc
          </View>
        </>,
      );
    });

    // One wrapping inline flow, not three stacked items
    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });

  it('block containers mix inline flows with block children', () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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
          style={{display: 'block', width: 40, fontSize: FONT_SIZE}}>
          {'a b c d e f'}
        </View>,
      );
    });

    // 11 chars at 10pt wrap at width 40 into ceil(11/4) = 3 lines of 20pt
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
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            hello world
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            <Text style={{fontSize: FONT_SIZE}}>hello world</Text>
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
    // Block children are not flex items: `flex: 1` must not stretch the child
    // to the remaining 90pt; it keeps its content height of 0
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
    // <div> lays out through YGDisplayBlock: inline children join one flow and
    // a block-level child does not flex-grow
    const divRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div collapsable={false} ref={divRef} style={{fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </div>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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

  it("a display:'inline' View joins the run under native block too", () => {
    // Same numbers as StringChildrenDisplayInline-itest.js: 'a<View 30x40/>b'
    // is 50pt wide with a 40pt line, since box generation is independent of the
    // block path
    const blockRef = createRef<HostInstance>();
    const inlineRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          <View
            ref={inlineRef}
            style={{display: 'inline', width: 30, height: 40}}
          />
          {'b'}
        </View>,
      );
    });

    expect(rectOf(blockRef).width).toBe(50);
    // 44, not 40: the box sits on the baseline and the text's descender still
    // hangs below it
    expect(rectOf(blockRef).height).toBe(44);
    expect(rectOf(inlineRef).width).toBe(30);
    expect(rectOf(inlineRef).height).toBe(40);
  });

  it("display:'none' and absolute children do not interrupt the IFC under native block", () => {
    // The contiguity rules of StringChildrenMixedContent-itest.js hold under
    // YGDisplayBlock: a none child generates no box and an absolute child is
    // out of flow, so 'a…b' stays one 20pt line
    const noneRef = createRef<HostInstance>();
    const absContainerRef = createRef<HostInstance>();
    const absRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={noneRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            <View style={{display: 'none', width: 30, height: 40}} />
            {'b'}
          </View>
          <View
            collapsable={false}
            ref={absContainerRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            <View
              ref={absRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 30,
                height: 40,
              }}
            />
            {'b'}
          </View>
        </>,
      );
    });

    expect(rectOf(noneRef).height).toBe(20);
    expect(rectOf(noneRef).width).toBe(20);
    expect(rectOf(absContainerRef).height).toBe(20);
    expect(rectOf(absContainerRef).width).toBe(20);
    expect(rectOf(absRef).width).toBe(30);
    expect(rectOf(absRef).height).toBe(40);
  });

  it("a display:'inline' child does not stack as a native block child", () => {
    // Contrast with the same tree minus the display prop: the plain View
    // stacks as a block-level child (20 + 40 + 20 = 80pt), the inline View
    // flows in one 40pt line.
    const inlineContainerRef = createRef<HostInstance>();
    const blockContainerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={inlineContainerRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            <View style={{display: 'inline', width: 30, height: 40}} />
            {'b'}
          </View>
          <View
            collapsable={false}
            ref={blockContainerRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            <View style={{width: 30, height: 40}} />
            {'b'}
          </View>
        </>,
      );
    });

    // 44, not 40: the descender hangs below the baseline-aligned box
    expect(rectOf(inlineContainerRef).height).toBe(44);
    expect(rectOf(blockContainerRef).height).toBe(80);
  });
});
