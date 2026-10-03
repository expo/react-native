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
 * Inline-level Views in a block container, with no text anywhere: atomic
 * inlines (`inline-block`, `inline-flex`) sit side by side in line boxes and
 * wrap when the line is full, and a span-like `inline` View flows its own
 * inline-level children into the same lines (CSS2 §9.2.1.1, §9.4.2).
 *
 * The test environment lays lines out on a deterministic grid: a line's strut
 * is the default font size plus 6 tall with a fifth of it below the baseline,
 * an atomic inline with no line boxes of its own sits on the baseline by its
 * bottom edge (CSS2 §10.8.1), and boxes wrap by width.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

type Rect = {x: number, y: number, width: number, height: number};

const DEFAULT_FONT_SIZE = 17;
// How far a line's strut hangs below its baseline
const STRUT_DESCENT = (DEFAULT_FONT_SIZE + 6) * 0.2;

// Rounds a length to the 1/3pt pixel grid layout snaps to in this environment
function pixels(value: number): number {
  return Math.round(value * 3) / 3;
}

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

describe('atomic inlines in a block container', () => {
  it('sit side by side on one line', () => {
    const container = createRef<HostInstance>();
    const refs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        {refs.map((ref, index) => (
          <View
            key={index}
            ref={ref}
            style={{display: 'inline-block', width: 80, height: 30}}
          />
        ))}
      </View>,
    );
    expect(refs.map(ref => relativeRect(ref, container))).toEqual([
      {x: 0, y: 0, width: 80, height: 30},
      {x: 80, y: 0, width: 80, height: 30},
      {x: 160, y: 0, width: 80, height: 30},
    ]);
    // The boxes' bottoms sit on the baseline and the strut's descent hangs
    // below it, so the line is that much taller than the boxes
    expect(rectOf(container).height).toBeCloseTo(pixels(30 + STRUT_DESCENT), 3);
  });

  it('wrap onto the next line when the line is full', () => {
    const container = createRef<HostInstance>();
    const refs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    render(
      <View ref={container} style={{display: 'block', width: 250}}>
        {refs.map((ref, index) => (
          <View
            key={index}
            ref={ref}
            style={{display: 'inline-block', width: 100, height: 30}}
          />
        ))}
      </View>,
    );
    const rects = refs.map(ref => relativeRect(ref, container));
    expect(rects[0]).toEqual({x: 0, y: 0, width: 100, height: 30});
    expect(rects[1]).toEqual({x: 100, y: 0, width: 100, height: 30});
    expect(rects[2].x).toBe(0);
    expect(rects[2].y).toBeGreaterThanOrEqual(30);
    expect(rectOf(container).height).toBeGreaterThanOrEqual(60);
  });

  it('grow the container by every line they wrap onto', () => {
    // Each box is wider than half the line, so each one takes a line of its
    // own: three lines, not the two that the boxes' total width would fill
    const container = createRef<HostInstance>();
    const refs = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        {refs.map((ref, index) => (
          <View
            key={index}
            ref={ref}
            style={{display: 'inline-block', width: 200, height: 30}}
          />
        ))}
      </View>,
    );
    const rects = refs.map(ref => relativeRect(ref, container));
    // A line is the 30pt box above the baseline plus the strut's descent
    const line = 30 + STRUT_DESCENT;
    rects.forEach((rect, index) => {
      expect(rect.y).toBeCloseTo(index * line, 3);
    });
    // Within half a point, because each line snaps to the pixel grid on its
    // own; two lines would be a whole line short
    expect(rectOf(container).height).toBeCloseTo(3 * line, 0);
  });

  it('align by their bottom edges when they have no line boxes', () => {
    const container = createRef<HostInstance>();
    const short = createRef<HostInstance>();
    const tall = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View
          ref={short}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
        <View
          ref={tall}
          style={{display: 'inline-block', width: 50, height: 50}}
        />
      </View>,
    );
    const shortRect = relativeRect(short, container);
    const tallRect = relativeRect(tall, container);
    expect(shortRect.y + shortRect.height).toBe(tallRect.y + tallRect.height);
    expect(tallRect.y).toBe(0);
  });

  it('take their inline-axis margins on the line', () => {
    const container = createRef<HostInstance>();
    const first = createRef<HostInstance>();
    const second = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View
          ref={first}
          style={{
            display: 'inline-block',
            width: 50,
            height: 20,
            marginRight: 10,
          }}
        />
        <View
          ref={second}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
      </View>,
    );
    expect(relativeRect(second, container).x).toBe(60);
  });

  it('lay out on one line with block-level siblings before and after', () => {
    const container = createRef<HostInstance>();
    const before = createRef<HostInstance>();
    const inline = createRef<HostInstance>();
    const after = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View ref={before} style={{height: 10}} />
        <View
          ref={inline}
          style={{display: 'inline-block', width: 50, height: 30}}
        />
        <View ref={after} style={{height: 10}} />
      </View>,
    );
    expect(relativeRect(before, container).y).toBe(0);
    expect(relativeRect(inline, container)).toEqual({
      x: 0,
      y: 10,
      width: 50,
      height: 30,
    });
    // The anonymous block around the inline is one line tall: the box plus
    // the strut's descent
    expect(relativeRect(after, container).y).toBeCloseTo(
      pixels(10 + 30 + STRUT_DESCENT),
      3,
    );
  });

  it('are blockified in a flex container', () => {
    const container = createRef<HostInstance>();
    const first = createRef<HostInstance>();
    const second = createRef<HostInstance>();
    render(
      <View ref={container} style={{width: 300}}>
        <View
          ref={first}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
        <View
          ref={second}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
      </View>,
    );
    expect(relativeRect(first, container)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 20,
    });
    expect(relativeRect(second, container)).toEqual({
      x: 0,
      y: 20,
      width: 50,
      height: 20,
    });
  });

  it('keep the run together across a display: none sibling', () => {
    const container = createRef<HostInstance>();
    const first = createRef<HostInstance>();
    const second = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View
          ref={first}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
        <View style={{display: 'none'}} />
        <View
          ref={second}
          style={{display: 'inline-block', width: 50, height: 20}}
        />
      </View>,
    );
    expect(relativeRect(first, container).y).toBe(0);
    expect(relativeRect(second, container)).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 20,
    });
  });
});

describe('the baseline of an inline-block', () => {
  it('is the baseline of its last line box', () => {
    const container = createRef<HostInstance>();
    const withText = createRef<HostInstance>();
    const tall = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View ref={withText} style={{display: 'inline-block', width: 60}}>
          {/* <Text> clips by default, and a clipped box offers its bottom
              edge instead of its line box */}
          <Text style={{overflow: 'visible', fontSize: 14}}>abc</Text>
        </View>
        <View
          ref={tall}
          style={{display: 'inline-block', width: 50, height: 40}}
        />
      </View>,
    );
    // The paragraph's baseline is 16pt below its top. The 40pt box has no
    // line boxes, so it sits on the baseline by its bottom edge, which puts
    // the baseline 40pt down the line and the paragraph's box 24pt down.
    expect(relativeRect(tall, container).y).toBe(0);
    expect(relativeRect(withText, container).y).toBe(24);
  });

  it('is the baseline of the LAST line when its text wraps', () => {
    const container = createRef<HostInstance>();
    const wrapped = createRef<HostInstance>();
    const tall = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View ref={wrapped} style={{display: 'inline-block', width: 40}}>
          <Text style={{overflow: 'visible', fontSize: 14}}>abc def</Text>
        </View>
        <View
          ref={tall}
          style={{display: 'inline-block', width: 50, height: 50}}
        />
      </View>,
    );
    // Two 20pt lines, so the last baseline is 36pt below the box's top. The
    // 50pt box puts the line's baseline 50pt down, and the text's box 14pt
    // down. Aligning by the first line would put it 34pt down instead.
    expect(relativeRect(wrapped, container).height).toBe(40);
    expect(relativeRect(wrapped, container).y).toBe(14);
  });

  it('is its bottom edge when it clips its contents', () => {
    const container = createRef<HostInstance>();
    const clipped = createRef<HostInstance>();
    const tall = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View
          ref={clipped}
          style={{display: 'inline-block', width: 60, overflow: 'hidden'}}>
          <Text>abc</Text>
        </View>
        <View
          ref={tall}
          style={{display: 'inline-block', width: 50, height: 40}}
        />
      </View>,
    );
    const clippedRect = relativeRect(clipped, container);
    const tallRect = relativeRect(tall, container);
    expect(clippedRect.y + clippedRect.height).toBe(
      tallRect.y + tallRect.height,
    );
  });
});

describe('a span-like inline View', () => {
  it('flows its inline-block children into the surrounding line', () => {
    const container = createRef<HostInstance>();
    const before = createRef<HostInstance>();
    const nested = createRef<HostInstance>();
    const after = createRef<HostInstance>();
    render(
      <View ref={container} style={{display: 'block', width: 300}}>
        <View
          ref={before}
          style={{display: 'inline-block', width: 40, height: 20}}
        />
        <View style={{display: 'inline'}}>
          <View
            ref={nested}
            style={{display: 'inline-block', width: 40, height: 20}}
          />
        </View>
        <View
          ref={after}
          style={{display: 'inline-block', width: 40, height: 20}}
        />
      </View>,
    );
    expect(relativeRect(before, container).x).toBe(0);
    expect(relativeRect(nested, container).x).toBe(40);
    expect(relativeRect(after, container).x).toBe(80);
    expect(relativeRect(after, container).y).toBe(0);
  });
});
