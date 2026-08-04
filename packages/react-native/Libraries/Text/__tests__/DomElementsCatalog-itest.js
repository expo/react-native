/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The intrinsic element catalog: each registered tag renders with its
 * web-standard display and default styling.
 *
 * <strong>/<em>/<button>/<a>/<label>/<p> carry no native code of their own —
 * they alias an existing intrinsic's view config — so these assertions are what
 * pin that the alias points somewhere with the right *behaviour*, not merely
 * that the tag resolves.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

function rectOf(ref: {current: HostInstance | null}) {
  const node = ref.current;
  if (node == null) {
    throw new Error('expected a mounted node');
  }
  return node.getBoundingClientRect();
}

// The deterministic measurer is 10pt per character, +2 for bold, +1 for
// italic, with 20pt lines — so width alone distinguishes the font defaults.
describe('intrinsic element catalog', () => {
  it('<strong> is bold like <b>, <em> is italic like <i>', () => {
    const strongRef = createRef<HostInstance>();
    const bRef = createRef<HostInstance>();
    const emRef = createRef<HostInstance>();
    const spanRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={strongRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <strong>abcd</strong>
          </View>
          <View collapsable={false} ref={bRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <b>abcd</b>
          </View>
          <View collapsable={false} ref={emRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <em>abcd</em>
          </View>
          <View collapsable={false} ref={spanRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <span>abcd</span>
          </View>
        </>,
      );
    });

    expect(rectOf(strongRef).width).toBe(rectOf(bRef).width);
    expect(rectOf(emRef).width).toBe(rectOf(spanRef).width + 4);
    // …and bold is genuinely wider than the unstyled baseline, so the
    // comparison above cannot pass by both being unstyled.
    expect(rectOf(strongRef).width).toBeGreaterThan(rectOf(spanRef).width);
  });

  it('<p> is block-level: siblings stack instead of flowing inline', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{alignSelf: 'flex-start'}}>
          {/* $FlowExpectedError[not-a-component] */}
          <p>ab</p>
          {/* $FlowExpectedError[not-a-component] */}
          <p>cd</p>
        </View>,
      );
    });

    // Two block lines, not one inline run: 40 tall and only as wide as one.
    expect(rectOf(ref).height).toBe(40);
    expect(rectOf(ref).width).toBe(20);
  });

  it('<button>, <a> and <label> flow inline like <span>', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
          {/* $FlowExpectedError[not-a-component] */}
          <button>ab</button>
          {/* $FlowExpectedError[not-a-component] */}
          <a>cd</a>
          {/* $FlowExpectedError[not-a-component] */}
          <label>ef</label>
        </View>,
      );
    });

    // All three joined one inline run: 6 chars on a single 20pt line.
    expect(rectOf(ref).width).toBe(60);
    expect(rectOf(ref).height).toBe(20);
  });

  it('an inline element still takes its own box props', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
          {/* $FlowExpectedError[not-a-component] */}
          <button style={{paddingInline: 6}}>ab</button>
        </View>,
      );
    });

    expect(rectOf(ref).width).toBe(32);
  });
});

describe('DOM identity', () => {
  it('an aliased element keeps its own tagName', () => {
    const strongRef = createRef<HostInstance>();
    const bRef = createRef<HostInstance>();
    const buttonRef = createRef<HostInstance>();
    const spanRef = createRef<HostInstance>();
    const unknownRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{display: 'block'}}>
          {/* $FlowExpectedError[not-a-component] */}
          <mytag ref={unknownRef}>u</mytag>
          {/* $FlowExpectedError[not-a-component] */}
          <strong ref={strongRef}>a</strong>
          {/* $FlowExpectedError[not-a-component] */}
          <b ref={bRef}>b</b>
          {/* $FlowExpectedError[not-a-component] */}
          <button ref={buttonRef}>c</button>
          {/* $FlowExpectedError[not-a-component] */}
          <span ref={spanRef}>d</span>
        </View>,
      );
    });

    // <strong> renders through <b>'s native component and <button> through
    // <span>'s, but each must still identify as itself.
    const tagOf = (ref: {current: HostInstance | null}) =>
      // $FlowFixMe[prop-missing] DOM tagName on the element
      ref.current?.tagName;
    expect(tagOf(unknownRef)).toBe('RN:mytag');
    expect(tagOf(strongRef)).toBe('RN:strong');
    expect(tagOf(bRef)).toBe('RN:b');
    expect(tagOf(buttonRef)).toBe('RN:button');
    expect(tagOf(spanRef)).toBe('RN:span');
  });
});

// `inline-flex` is the second most common display in Astryx (78 uses, behind
// only plain flex) — a badge/chip/button that sits in a line of text while
// laying its own contents out with flex.
describe('inline-level displays that establish a formatting context', () => {
  it('display:inline-flex is inline-level: it sits in the text flow', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
          {'ab'}
          <View style={{display: 'inline-flex'}}>
            <View style={{width: 30, height: 10}} />
          </View>
          {'cd'}
        </View>,
      );
    });

    // One line: 2 chars + the 30pt box + 2 chars. If it were block-level the
    // text would be split across lines instead.
    expect(rectOf(ref).width).toBe(70);
    expect(rectOf(ref).height).toBe(20);
  });

  it('inline-flex lays its own children out with flex, not as text', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
          <View style={{display: 'inline-flex', flexDirection: 'row'}}>
            <View style={{width: 30, height: 10}} />
            <View style={{width: 20, height: 10}} />
          </View>
        </View>,
      );
    });

    // Children are flex items laid out by the box itself (a row, 50 wide),
    // not folded into the surrounding inline flow. `flexDirection` is explicit
    // because RN's default is column, unlike CSS's row — a pre-existing
    // divergence that inline-flex does not change.
    expect(rectOf(ref).width).toBe(50);
  });

  it('inline-flex is atomic: block-axis padding grows the line box', () => {
    const atomicRef = createRef<HostInstance>();
    const spanLikeRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={atomicRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'ab'}
            <View style={{display: 'inline-flex', paddingBlock: 10}}>{'cd'}</View>
          </View>
          <View collapsable={false} ref={spanLikeRef} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'ab'}
            <View style={{display: 'inline', paddingBlock: 10}}>{'cd'}</View>
          </View>
        </>,
      );
    });

    // This is the observable consequence of atomic vs span-like. An atomic box
    // is a box in the line: its own block-axis padding is part of its height,
    // so the line grows to 40. A span-like box folds into the surrounding run,
    // where block-axis padding overflows the line box instead of growing it
    // (CSS2 §10.6.1), leaving the line at 20.
    expect(rectOf(atomicRef).height).toBe(40);
    expect(rectOf(spanLikeRef).height).toBe(20);
  });
});
