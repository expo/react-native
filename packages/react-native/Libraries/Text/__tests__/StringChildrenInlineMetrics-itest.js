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
 * `getBoundingClientRect()` on an inline element returns the box it occupies.
 * Inline elements are never laid out by Yoga: the text engine reports a rect
 * per fragment, fragments carry their owning element, and the containing
 * paragraph stamps the union onto the element. Deterministic measurer:
 * 10pt/char (+2 bold, +1 italic), 20pt lines; on device the rects come from
 * CoreText, and the union and stamping rules under test are shared.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
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

describe('inline elements report their box', () => {
  it('an inline element in a bare-text run reports offset and width', () => {
    const containerRef = createRef<HostInstance>();
    const boldRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'ab'}
          {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
          <b ref={boldRef}>cd</b>
          {'ef'}
        </View>,
      );
    });

    // 'ab' (2x10) + bold 'cd' (2x12) + 'ef' (2x10) = 64.
    expect(rectOf(containerRef).width).toBe(64);
    // The element starts after 'ab' and is exactly as wide as it contributes.
    expect(rectOf(boldRef).x - rectOf(containerRef).x).toBe(20);
    expect(rectOf(boldRef).width).toBe(24);
    expect(rectOf(boldRef).height).toBe(20);
  });

  it('a nested inline element reports its own narrower box', () => {
    const spanRef = createRef<HostInstance>();
    const innerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <span ref={spanRef}>
            {'xx'}
            {/* $FlowExpectedError[not-a-component] intrinsic tags */}
            <b ref={innerRef}>yy</b>
          </span>
        </View>,
      );
    });

    // The span covers 'xx' (20) + bold 'yy' (24) = 44; the nested bold covers
    // only its own 24, starting 20 in.
    expect(rectOf(spanRef).width).toBe(44);
    expect(rectOf(innerRef).width).toBe(24);
    expect(rectOf(innerRef).x - rectOf(spanRef).x).toBe(20);
  });

  it('a nested element is placed relative to its parent element', () => {
    // `getBoundingClientRect` sums frame origins up the node tree while the
    // boxes are computed in the run's space, so a nested element's ancestor
    // offset is applied twice unless the stamp subtracts it; the leading text
    // makes that visible
    const containerRef = createRef<HostInstance>();
    const spanRef = createRef<HostInstance>();
    const innerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'aaa'}
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <span ref={spanRef}>
            {'xx'}
            {/* $FlowExpectedError[not-a-component] intrinsic tags */}
            <b ref={innerRef}>yy</b>
          </span>
        </View>,
      );
    });

    const container = rectOf(containerRef);
    // 'aaa' is 30 wide, then the span's own 'xx' is 20, so the bold starts 50
    // in — not 80, which is what double-counting the span's own offset gives.
    expect(rectOf(spanRef).x - container.x).toBe(30);
    expect(rectOf(innerRef).x - container.x).toBe(50);
    expect(rectOf(innerRef).width).toBe(24);
  });

  it('an unchanged element follows the run when a resize rewraps it', () => {
    // Nothing about the <b> changes when its container narrows, so React never
    // re-clones it, but it has still moved; the owner must clone the path to
    // the sealed element rather than report its previous rect
    const containerRef = createRef<HostInstance>();
    const boldRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const render = (width: number) => {
      Fantom.runTask(() => {
        root.render(
          <View
            collapsable={false}
            ref={containerRef}
            style={{display: 'block', width, fontSize: FONT_SIZE}}>
            {'aaaaaaaaaa '}
            {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b ref={boldRef}>bbb</b>
          </View>,
        );
      });
      return rectOf(boldRef).x - rectOf(containerRef).x;
    };

    // Wide enough for one line: the bold sits after the 110pt of text.
    const wide = render(400);
    expect(wide).toBe(110);

    // Too narrow: the bold wraps, so it starts the next line.
    expect(render(120)).toBe(0);

    // And back
    expect(render(400)).toBe(wide);
  });

  it('an element that wraps reports the union of its lines', () => {
    const containerRef = createRef<HostInstance>();
    const boldRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 40, fontSize: FONT_SIZE}}>
          {'aa'}
          {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
          <b ref={boldRef}>bbbb</b>
        </View>,
      );
    });

    // Wraps at 4 chars/line: the bold spans the end of line 1 and start of
    // line 2, so its box is two lines tall — the same union the web reports.
    expect(rectOf(boldRef).height).toBe(40);
    expect(rectOf(boldRef).x).toBe(rectOf(containerRef).x);
  });

  it('bare text has no element, so nothing is stamped for it', () => {
    // Only elements get metrics; a run of bare text must not pick up the
    // container's box
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'abcd'}
        </View>,
      );
    });

    expect(rectOf(containerRef).width).toBe(40);
  });

  it('an element with no text of its own still has a box on the line', () => {
    // An empty inline is a zero-WIDTH box, not a missing one: it sits at its
    // position on the line and is as tall as the line, which is what the web
    // reports and what makes an empty <span> usable as a measurement anchor.
    const containerRef = createRef<HostInstance>();
    const emptyRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'ab'}
          {/* $FlowExpectedError[not-a-component] intrinsic */}
          <span ref={emptyRef} />
          {'cd'}
        </View>,
      );
    });

    const container = rectOf(containerRef);
    const empty = rectOf(emptyRef);
    expect(empty.width).toBe(0);
    // 20pt lines, 10pt per character: after "ab", before "cd".
    expect(empty.height).toBe(20);
    expect(empty.x - container.x).toBe(20);
    expect(empty.y - container.y).toBe(0);
  });
});

describe('authored <Text> keeps its layout behavior', () => {
  it('a nested <Text> reports its box without changing the paragraph', () => {
    const outerRef = createRef<HostInstance>();
    const nestedRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View style={{position: 'absolute', left: 10, top: 20}}>
          <Text
            style={{width: 100, height: 50, fontSize: FONT_SIZE}}
            ref={outerRef}>
            Hello
            <Text ref={nestedRef} style={{fontSize: FONT_SIZE}}>
              {' '}
              World
            </Text>
          </Text>
        </View>,
      );
    });

    // The paragraph itself is untouched: still exactly its styled box.
    expect(rectOf(outerRef).width).toBe(100);
    expect(rectOf(outerRef).height).toBe(50);

    // ' World' starts after 'Hello' and wraps at 10 chars/line, so its union
    // spans both lines
    const nested = rectOf(nestedRef);
    expect(nested.width).toBe(100);
    expect(nested.height).toBe(40);
    expect(nested.x).toBe(10);
    expect(nested.y).toBe(20);
  });
});

describe('re-layout of an already-committed paragraph', () => {
  // Layout runs again on subtrees that were not re-cloned, so a state update
  // elsewhere re-lays out this paragraph while its inline children belong to
  // the previous, sealed generation; stamping them would trip
  // `Sealable::ensureUnsealed` and abort a debug build
  it('does not mutate sealed children when something else re-renders', () => {
    const inlineRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    function Case({extra}: {extra: number}) {
      return (
        <>
          <View
            collapsable={false}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b ref={inlineRef}>bc</b>
            {'d'}
          </View>
          {/* An unrelated sibling whose change forces a new commit, and with
              it a layout pass over the untouched paragraph above. */}
          <View style={{width: extra, height: 10}} />
        </>
      );
    }

    Fantom.runTask(() => {
      root.render(<Case extra={10} />);
    });

    const before = rectOf(inlineRef);
    expect(before.width).toBeGreaterThan(0);

    Fantom.runTask(() => {
      root.render(<Case extra={20} />);
    });
    Fantom.runTask(() => {
      root.render(<Case extra={30} />);
    });

    // The element still reports the same box it did on the first commit
    const after = rectOf(inlineRef);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});
