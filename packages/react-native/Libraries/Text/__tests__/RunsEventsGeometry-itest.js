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

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import ReadOnlyText from 'react-native/src/private/webapis/dom/nodes/ReadOnlyText';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
// The element catalog, for the intrinsic <span> in the fragment-rect case.
import '@react-native/expo-intrinsics-poc';

/*
 * DOM-spec behavior of events and geometry for bare-text runs and inline
 * elements: dispatch and bubbling through inline elements (DOM Events §2.8),
 * fragment geometry from getBoundingClientRect (CSSOM View), and the DOM
 * tree shape around anonymous boxes (CSS 2.1 §9.2.1.1: anonymous boxes exist
 * in LAYOUT only — the node tree never shows them).
 */

const CHAR = 10;
const LINE = 20;

test('a click on an inline element fires its handler and bubbles to the container', () => {
  const events: Array<string> = [];
  const innerRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', width: 400}}
        onClick={() => {
          events.push('container');
        }}>
        {'before '}
        <View
          ref={innerRef}
          style={{display: 'inline'}}
          onClick={() => {
            events.push('inline');
          }}>
          press me
        </View>
        {' after'}
      </View>,
    );
  });

  const inner = ensureInstance(innerRef.current, ReactNativeElement);
  Fantom.runOnUIThread(() => {
    Fantom.dispatchNativeEvent(inner, 'click');
  });
  Fantom.runWorkLoop();

  // DOM Events order: target first, then the ancestor (bubbling phase).
  expect(events).toEqual(['inline', 'container']);
});

test('a text-vocabulary inline element mid-run reports its fragment rect', () => {
  const spanRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', alignSelf: 'flex-start'}}>
        {'abc '}
        {/* $FlowExpectedError[not-a-component] catalog element */}
        <span ref={spanRef}>span</span>
        {' xyz'}
      </View>,
    );
  });

  const rect = ensureInstance(
    spanRef.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  // Preceded by "abc " (4 characters); its own text is "span" (4 characters);
  // one line tall. CSSOM View: the border box union of the element's
  // fragments.
  expect(rect.x).toBe(4 * CHAR);
  expect(rect.width).toBe(4 * CHAR);
  expect(rect.height).toBe(LINE);
});

test('a span-like inline-flow View reports its fragment rect (gap closed)', () => {
  // A `display:'inline'` View folds its contents into the surrounding run;
  // per CSSOM View its getBoundingClientRect is the border-box union of its
  // fragments — same rule as the text-vocabulary elements above.
  const inlineRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', alignSelf: 'flex-start'}}>
        {'abc '}
        <View ref={inlineRef} style={{display: 'inline'}}>
          span
        </View>
        {' xyz'}
      </View>,
    );
  });

  const rect = ensureInstance(
    inlineRef.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  expect(rect.x).toBe(4 * CHAR);
  expect(rect.width).toBe(4 * CHAR);
  expect(rect.height).toBe(LINE);
});

test('an inline-flow View wrapping a bold element reports the union', () => {
  const outerRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', alignSelf: 'flex-start'}}>
        {'ab'}
        <View ref={outerRef} style={{display: 'inline'}}>
          {'cd'}
          {/* $FlowExpectedError[not-a-component] catalog element */}
          <b>ef</b>
        </View>
      </View>,
    );
  });

  const rect = ensureInstance(
    outerRef.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  // 'cd' (2x10) + bold 'ef' (2x12) = 44 wide, starting after 'ab' (20).
  expect(rect.x).toBe(2 * CHAR);
  expect(rect.width).toBe(2 * CHAR + 24);
});

test('a SIZED inline View stays atomic: attachment frame, not a stamped union', () => {
  const boxRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', alignSelf: 'flex-start'}}>
        {'ab'}
        <View ref={boxRef} style={{display: 'inline', width: 30, height: 40}} />
        {'cd'}
      </View>,
    );
  });

  const rect = ensureInstance(
    boxRef.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  // Atomic inline: its own 30x40 box, positioned by attachment layout —
  // Yoga's metrics, never overwritten by the fragment stamp.
  expect(rect.width).toBe(30);
  expect(rect.height).toBe(40);
});

test('anonymous boxes never appear in the DOM tree (CSS 2.1 §9.2.1.1)', () => {
  const containerRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} ref={containerRef} style={{width: 400}}>
        {'text one'}
        <View collapsable={false} style={{height: 8}} />
        {'text two'}
      </View>,
    );
  });

  const container = ensureInstance(containerRef.current, ReactNativeElement);
  const childNodes = container.childNodes;
  // The container's DOM children are exactly what the author wrote — two
  // text nodes and an element — even though layout wraps the text in
  // anonymous run boxes.
  expect(childNodes.length).toBe(3);
  const first = ensureInstance(childNodes[0], ReadOnlyText);
  expect(first.nodeName).toBe('#text');
  expect(first.textContent).toBe('text one');
  expect(childNodes[1]).toBeInstanceOf(ReactNativeElement);
  const last = ensureInstance(childNodes[2], ReadOnlyText);
  expect(last.textContent).toBe('text two');
});

test('a bare text node under a plain View is a real DOM text node', () => {
  const containerRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} ref={containerRef}>
        just text
      </View>,
    );
  });

  const container = ensureInstance(containerRef.current, ReactNativeElement);
  const textNode = ensureInstance(container.childNodes[0], ReadOnlyText);
  // DOM: Text : CharacterData, nodeType 3.
  expect(textNode.nodeType).toBe(3);
  expect(textNode.nodeName).toBe('#text');
  expect(textNode.textContent).toBe('just text');
  expect(textNode.parentElement).toBe(container);
});
