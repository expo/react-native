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
 * Block layout cases whose expected values come from Chrome, through Yoga's
 * gentest fixtures for `display: block` (`YGDisplayBlock*Test.html`). Each one
 * pins a rule that is easy to get wrong: inline-start padding and border
 * under RTL, auto inline margins under RTL, an aspect ratio deciding an auto
 * width from a definite height, absolutely positioned children ignoring
 * alignment properties a block container does not have, margins collapsing
 * through empty nested blocks, floats never rising above earlier floats, and
 * clearance keeping a child's margin from collapsing with its parent's.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

type Rect = {x: number, y: number, width: number, height: number};

function rectOf(ref: {current: HostInstance | null}): Rect {
  const rect = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

// A child's border box relative to its container's border box
function relativeRect(
  child: {current: HostInstance | null},
  container: {current: HostInstance | null},
): Rect {
  const childRect = rectOf(child);
  const containerRect = rectOf(container);
  return {
    x: childRect.x - containerRect.x,
    y: childRect.y - containerRect.y,
    width: childRect.width,
    height: childRect.height,
  };
}

function render(element: React.MixedElement): void {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
}

describe('right-to-left block layout', () => {
  it('offsets a child by the inline-start padding and border', () => {
    const container = createRef<HostInstance>();
    const child = createRef<HostInstance>();
    render(
      <View
        ref={container}
        style={{
          display: 'block',
          direction: 'rtl',
          width: 100,
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderTopWidth: 1,
          borderRightWidth: 2,
          borderBottomWidth: 3,
          borderLeftWidth: 4,
        }}>
        <View ref={child} style={{height: 10}} />
      </View>,
    );
    expect(relativeRect(child, container)).toEqual({
      x: 14,
      y: 6,
      width: 74,
      height: 10,
    });
  });

  it('puts the leftover space in the inline-start auto margin', () => {
    const container = createRef<HostInstance>();
    const child = createRef<HostInstance>();
    render(
      <View
        ref={container}
        style={{display: 'block', direction: 'rtl', width: 100}}>
        <View ref={child} style={{width: 40, height: 10, marginLeft: 'auto'}} />
      </View>,
    );
    expect(relativeRect(child, container).x).toBe(60);
  });
});

describe('aspect-ratio on a block child', () => {
  it('takes an auto width from a definite height', () => {
    const container = createRef<HostInstance>();
    const child = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View ref={child} style={{height: 30, aspectRatio: 2}} />
      </View>,
    );
    expect(relativeRect(child, container)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 30,
    });
  });
});

describe('absolutely positioned children of a block container', () => {
  it('ignore justify-content and align-items', () => {
    const container = createRef<HostInstance>();
    const child = createRef<HostInstance>();
    render(
      <View
        ref={container}
        style={{
          display: 'block',
          width: 100,
          height: 100,
          justifyContent: 'center',
          alignItems: 'flex-end',
        }}>
        <View style={{height: 20}} />
        <View
          ref={child}
          style={{position: 'absolute', width: 30, height: 10}}
        />
      </View>,
    );
    expect(relativeRect(child, container)).toEqual({
      x: 0,
      y: 20,
      width: 30,
      height: 10,
    });
  });
});

describe('margins collapsing through empty nested blocks', () => {
  it('collapse with the margins of everything inside them', () => {
    const container = createRef<HostInstance>();
    const last = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View style={{height: 10, marginBottom: 5}} />
        <View style={{display: 'block', marginTop: 10}}>
          <View style={{display: 'block', marginTop: 15, marginBottom: 35}} />
        </View>
        <View ref={last} style={{height: 10, marginTop: 20}} />
      </View>,
    );
    expect(relativeRect(last, container).y).toBe(45);
    expect(rectOf(container).height).toBe(55);
  });

  it('collapse through a parent edge from inside an empty block', () => {
    const container = createRef<HostInstance>();
    const parent = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View style={{height: 10}} />
        <View ref={parent} style={{display: 'block', marginTop: 5}}>
          <View style={{display: 'block'}}>
            <View style={{display: 'block', marginBottom: 40}} />
          </View>
          <View style={{height: 10, marginTop: 5}} />
        </View>
      </View>,
    );
    expect(relativeRect(parent, container).y).toBe(50);
    expect(rectOf(container).height).toBe(60);
  });
});

describe('float placement', () => {
  it('never places a float higher than an earlier one (CSS2 §9.5.1 rule 5)', () => {
    const container = createRef<HostInstance>();
    const wrapped = createRef<HostInstance>();
    const right = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View style={{float: 'left', width: 60, height: 10}} />
        <View ref={wrapped} style={{float: 'left', width: 60, height: 30}} />
        <View ref={right} style={{float: 'right', width: 30, height: 10}} />
      </View>,
    );
    expect(relativeRect(wrapped, container)).toEqual({
      x: 0,
      y: 10,
      width: 60,
      height: 30,
    });
    expect(relativeRect(right, container)).toEqual({
      x: 70,
      y: 10,
      width: 30,
      height: 10,
    });
    expect(rectOf(container).height).toBe(40);
  });
});

describe('clearance', () => {
  it("keeps a first child's top margin from collapsing with its parent's", () => {
    const container = createRef<HostInstance>();
    const parent = createRef<HostInstance>();
    const cleared = createRef<HostInstance>();
    const after = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View style={{float: 'left', width: 50, height: 30}} />
        <View ref={parent} style={{display: 'block', marginTop: 10}}>
          <View
            ref={cleared}
            style={{clear: 'left', marginTop: 20, height: 10}}
          />
        </View>
        <View ref={after} style={{height: 5}} />
      </View>,
    );
    expect(relativeRect(parent, container).y).toBe(10);
    expect(relativeRect(cleared, container).y).toBe(30);
    expect(relativeRect(after, container).y).toBe(40);
    expect(rectOf(container).height).toBe(45);
  });

  it('places a cleared box at the bottom of the float it clears', () => {
    const container = createRef<HostInstance>();
    const floated = createRef<HostInstance>();
    const cleared = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 100}}>
        <View style={{height: 10, marginBottom: 15}} />
        <View ref={floated} style={{float: 'left', width: 50, height: 20}} />
        <View ref={cleared} style={{clear: 'left', marginTop: 5, height: 10}} />
      </View>,
    );
    expect(relativeRect(floated, container).y).toBe(25);
    expect(relativeRect(cleared, container).y).toBe(45);
    expect(rectOf(container).height).toBe(55);
  });
});
