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
 * Layout metrics for inline elements (T14): `getBoundingClientRect()` on a
 * `<b>`/`<span>`/nested `<Text>` returns the box it actually occupies, as on
 * the web (text-children-plan.md §3.G).
 *
 * Inline elements are still never laid out by Yoga. The text engine reports a
 * rect per fragment, fragments carry their owning element, and the containing
 * Paragraph/View stamps the union onto the element. Nothing here feeds back
 * into measuring or painting — authored `<Text>` lays out exactly as before,
 * which the baseline suites guard.
 *
 * Deterministic measurer: 10pt/char (+2 bold, +1 italic), 20pt lines.
 *
 * These assertions run against the cxx measurer. The iOS text layout manager
 * supplies the same `fragmentRects` from `boundingRectForGlyphRange:` (which
 * already unions a range that wraps), so the on-device numbers come from
 * CoreText rather than this grid — the semantics under test are the union and
 * stamping rules, which are shared.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

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
          style={{display: 'block', alignSelf: 'flex-start'}}>
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
          style={{display: 'block', alignSelf: 'flex-start'}}>
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

  it('an element that wraps reports the union of its lines', () => {
    const containerRef = createRef<HostInstance>();
    const boldRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', width: 40}}>
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
    // Regression guard: only elements get metrics; a run of bare text is not
    // an element and must not pick up the container's box.
    const containerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={containerRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'abcd'}
        </View>,
      );
    });

    expect(rectOf(containerRef).width).toBe(40);
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
          <Text style={{width: 100, height: 50}} ref={outerRef}>
            Hello
            <Text ref={nestedRef}> World</Text>
          </Text>
        </View>,
      );
    });

    // The paragraph itself is untouched: still exactly its styled box.
    expect(rectOf(outerRef).width).toBe(100);
    expect(rectOf(outerRef).height).toBe(50);

    // ' World' starts after 'Hello' and wraps at 10 chars/line, so its union
    // spans both lines — previously this reported an all-zero rect.
    const nested = rectOf(nestedRef);
    expect(nested.width).toBe(100);
    expect(nested.height).toBe(40);
    expect(nested.x).toBe(10);
    expect(nested.y).toBe(20);
  });
});
