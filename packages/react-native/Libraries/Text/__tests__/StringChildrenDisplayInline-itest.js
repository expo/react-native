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
 * `display:'inline'` — atomic inline-level boxes (text-children-plan.md §3.A/§7).
 *
 * An otherwise block-level element (`View`) opted inline via `display:'inline'`:
 *
 *  - In a *block container* it joins the surrounding run as an atomic inline
 *    box — an inline attachment, exactly like the replaced `<img>` — so
 *    `a<View/>b` flows on one line with the box between the glyphs.
 *  - In a *flex container* it is blockified into a regular flex item
 *    (css-display-3 §2.7), identical to a View without the prop.
 *  - `position:'absolute'` blockifies (CSS2 §9.7): the box leaves the flow
 *    and never joins a run.
 *
 * Deterministic-measurer contract (onboarding §4): 10pt/char, 20pt line
 * height, attachments reserve their measured box — same numbers as the sized
 * `<img>` cases in StringChildrenBehavior-itest.js.
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

describe("display:'inline' — atomic inline boxes in block containers", () => {
  it('an inline View joins the run instead of stacking as a block child', () => {
    // 'a<View 30x40/>b' in a block container measures like the sized <img>
    // case: 10 + 30 + 10 = 50pt wide, line height max(20, 40) = 40pt.
    const blockRef = createRef<HostInstance>();
    const inlineRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
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
    expect(rectOf(blockRef).height).toBe(40);
    // The atomic box keeps its own size (laid out at the attachment frame).
    expect(rectOf(inlineRef).width).toBe(30);
    expect(rectOf(inlineRef).height).toBe(40);
  });

  it('a lone inline View forms a run by itself', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          <View style={{display: 'inline', width: 30, height: 40}} />
        </View>,
      );
    });

    expect(rectOf(blockRef).width).toBe(30);
    expect(rectOf(blockRef).height).toBe(40);
  });

  it('an inline View with flex content lays out its own subtree (inner display stays flex)', () => {
    // Atomic inline boxes are inline OUTSIDE, flex INSIDE (≈ web
    // inline-block): the box's children keep RN flex layout at the measured
    // attachment size.
    const innerRef = createRef<HostInstance>();
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          <View style={{display: 'inline', width: 30, height: 40}}>
            <View
              collapsable={false}
              ref={innerRef}
              style={{flexGrow: 1, width: 15}}
            />
          </View>
          {'b'}
        </View>,
      );
    });

    // flex-grow fills the atomic box's fixed 40pt height — flex semantics
    // apply inside the box even though it flows inline outside.
    expect(rectOf(innerRef).height).toBe(40);
    expect(rectOf(innerRef).width).toBe(15);
    expect(rectOf(blockRef).height).toBe(40);
  });

  it('inline Views flow inside the intrinsic <div> too', () => {
    const divRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[not-a-component] intrinsic <div> tag
        <div collapsable={false} ref={divRef} style={{alignSelf: 'flex-start'}}>
          {'a'}
          <View style={{display: 'inline', width: 30, height: 40}} />
          {'b'}
        </div>,
      );
    });

    expect(rectOf(divRef).width).toBe(50);
    expect(rectOf(divRef).height).toBe(40);
  });
});

describe("display:'inline' — span-like flow (un-sized, all-inline contents)", () => {
  it("an un-sized inline View's contents flow into the surrounding run", () => {
    // Safari-pinned: <div>a <div style="display:inline">x <b>y</b></div> b</div>
    // lays out identically to the flattened text — one line.
    const flowRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={flowRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a '}
            <View style={{display: 'inline'}}>
              {'x '}
              {/* $FlowExpectedError[not-a-component] intrinsic tags */}
              <b>y</b>
            </View>
            {' b'}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a x '}
            {/* $FlowExpectedError[not-a-component] intrinsic tags */}
            <b>y</b>
            {' b'}
          </View>
        </>,
      );
    });

    expect(rectOf(flowRef).height).toBe(rectOf(controlRef).height);
    expect(rectOf(flowRef).width).toBe(rectOf(controlRef).width);
    expect(rectOf(flowRef).height).toBe(20);
  });

  it('inline flow boxes nest (Safari-pinned)', () => {
    const flowRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={flowRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a '}
            <View style={{display: 'inline'}}>
              {'x '}
              <View style={{display: 'inline'}}>{'y'}</View>
              {' z'}
            </View>
            {' b'}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'a x y z b'}
          </View>
        </>,
      );
    });

    expect(rectOf(flowRef).height).toBe(20);
    expect(rectOf(flowRef).width).toBe(rectOf(controlRef).width);
  });

  it('an atomic (sized) inline box nested in a flow box is placed in the run', () => {
    const containerRef = createRef<HostInstance>();
    const atomicRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          <View style={{display: 'inline'}}>
            {'x'}
            <View
              ref={atomicRef}
              style={{display: 'inline', width: 30, height: 40}}
            />
          </View>
          {'b'}
        </View>,
      );
    });

    // 'a' + 'x' + 30pt box + 'b' = 10+10+30+10 = 60 wide; line = max(20, 40).
    expect(rectOf(containerRef).width).toBe(60);
    expect(rectOf(containerRef).height).toBe(40);
    expect(rectOf(atomicRef).width).toBe(30);
    expect(rectOf(atomicRef).height).toBe(40);
  });

  it('an inline View with block-level content stays atomic (no block-in-inline)', () => {
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          <View style={{display: 'inline'}}>
            <View style={{width: 12, height: 10}} />
          </View>
          {'b'}
        </View>,
      );
    });

    // The box holds a block-level child, so it cannot flow; it becomes an
    // atomic inline attachment measured at its content size (12x10) — the
    // line stays one 20pt text line ('a' + box + 'b').
    expect(rectOf(containerRef).height).toBe(20);
    expect(rectOf(containerRef).width).toBe(32);
  });
});

describe("display:'inline' — blockification outside block containers", () => {
  it('an inline View in a flex container is a regular flex item (css-display-3 §2.7)', () => {
    const flexRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={flexRef}>
            {'a'}
            <View style={{display: 'inline', width: 30, height: 40}} />
            {'b'}
          </View>
          <View collapsable={false} ref={controlRef}>
            {'a'}
            <View style={{width: 30, height: 40}} />
            {'b'}
          </View>
        </>,
      );
    });

    // Identical to a View without the prop: run 'a' (20) + block item (40) +
    // run 'b' (20), stacked.
    expect(rectOf(flexRef).height).toBe(rectOf(controlRef).height);
    expect(rectOf(flexRef).height).toBe(80);
  });

  it("position:'absolute' blockifies: the View leaves the flow (CSS2 §9.7)", () => {
    const blockRef = createRef<HostInstance>();
    const absRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'ab'}
          <View
            ref={absRef}
            style={{
              display: 'inline',
              position: 'absolute',
              top: 0,
              left: 0,
              width: 30,
              height: 40,
            }}
          />
        </View>,
      );
    });

    // The absolutely-positioned box does not reserve space in the run: the
    // container is one 20pt text line, not a 40pt attachment line.
    expect(rectOf(blockRef).height).toBe(20);
    expect(rectOf(blockRef).width).toBe(20);
    expect(rectOf(absRef).width).toBe(30);
    expect(rectOf(absRef).height).toBe(40);
  });
});
