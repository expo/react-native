/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

/**
 * Mixed inline/block content — anonymous block boxes (CSS2 §9.2.1.1; block
 * Stage 2 of text-children-plan.md §3.A) and the box-generation rules for
 * children that generate no box or are out of flow.
 *
 * Every expectation in this file is pinned against real Safari behavior
 * (fixtures mirrored in a plain HTML page; see the block/flex × none/abs
 * check): with 10pt/char + 20pt lines,
 *
 *  - `display:'none'` children generate NO box and never interrupt inline
 *    content — the surrounding runs stay contiguous (block AND flex).
 *  - Absolutely-positioned children are out-of-flow: in a *block container*
 *    they do not interrupt the IFC; in a *flex container* they DO separate
 *    text-run sequences (css-flexbox-1 §4).
 *  - Contiguous inline sequences between block-level siblings wrap in
 *    anonymous block boxes; whitespace-only sequences generate nothing.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/*
 * The type size these measurements are calibrated against.
 *
 * Stated rather than inherited: a document's default font size here is the
 * platform's own body size (17pt on iOS, 16sp on Android) rather than React
 * Native's historical 14, so a fixture that leaves it unset measures a
 * different number of points on each platform — and moved the day that default
 * did. Nothing in this file is about the type size, so pinning it keeps these
 * assertions about the property they name.
 */
const FONT_SIZE = 14;

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('children that generate no box never interrupt inline content', () => {
  it("display:'none' does not split a run in a block container", () => {
    const blockRef = createRef<HostInstance>();
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
          <View style={{display: 'none', width: 30, height: 40}} />
          {'b'}
        </View>,
      );
    });

    // Safari: one line "ab" — the none box does not exist.
    expect(rectOf(blockRef).height).toBe(20);
    expect(rectOf(blockRef).width).toBe(20);
  });

  it("display:'none' does not split a run in a flex container either", () => {
    const flexRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={flexRef}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {'a'}
          <View style={{display: 'none', width: 30, height: 40}} />
          {'b'}
        </View>,
      );
    });

    // Safari flex: 'a' and 'b' stay one contiguous sequence -> ONE anonymous
    // item, one 20pt line (not two stacked items).
    expect(rectOf(flexRef).height).toBe(20);
    expect(rectOf(flexRef).width).toBe(20);
  });
});

describe('out-of-flow children and the inline flow', () => {
  it('an absolute child does not interrupt the IFC in a block container', () => {
    const blockRef = createRef<HostInstance>();
    const absRef = createRef<HostInstance>();
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
        </View>,
      );
    });

    // Safari: "ab" on one 20pt line; the abs box is positioned independently.
    expect(rectOf(blockRef).height).toBe(20);
    expect(rectOf(blockRef).width).toBe(20);
    expect(rectOf(absRef).width).toBe(30);
    expect(rectOf(absRef).height).toBe(40);
  });

  it('an absolute child DOES separate text runs in a flex container', () => {
    const flexRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={flexRef}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {'a'}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 30,
              height: 40,
            }}
          />
          {'b'}
        </View>,
      );
    });

    // Safari flex: two anonymous items ('a', 'b') stack -> 40pt.
    expect(rectOf(flexRef).height).toBe(40);
  });
});

describe('anonymous block boxes between block-level siblings (CSS2 §9.2.1.1)', () => {
  it('interleaved inline sequences and block children stack in order', () => {
    const blockRef = createRef<HostInstance>();
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
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <b>b</b>
          <View style={{height: 10, width: 10}} />
          {'c'}
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <i>d</i>
        </View>,
      );
    });

    // Safari: anonymous box "a<b>b</b>" (20) + block child (10) + anonymous
    // box "c<i>d</i>" (20) = 50.
    expect(rectOf(blockRef).height).toBe(50);
  });

  it('whitespace-only sequences between block children generate nothing', () => {
    const blockRef = createRef<HostInstance>();
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
          <View style={{height: 10, width: 10}} />
          {'   '}
          <View style={{height: 10, width: 10}} />
        </View>,
      );
    });

    // Safari: no anonymous box for the whitespace -> 10 + 10 = 20.
    expect(rectOf(blockRef).height).toBe(20);
  });

  it('a lone inline element between block children wraps in its own anonymous box', () => {
    const blockRef = createRef<HostInstance>();
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
          <View style={{height: 10, width: 10}} />
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <b>x</b>
          <View style={{height: 10, width: 10}} />
        </View>,
      );
    });

    // Safari: 10 + 20 + 10 = 40.
    expect(rectOf(blockRef).height).toBe(40);
  });

  it('whitespace around a block child trims but the runs remain', () => {
    const blockRef = createRef<HostInstance>();
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
          {'a '}
          <View style={{height: 10, width: 10}} />
          {' b'}
        </View>,
      );
    });

    // Safari: run "a" (20) + block child (10) + run "b" (20) = 50.
    expect(rectOf(blockRef).height).toBe(50);
  });
});
