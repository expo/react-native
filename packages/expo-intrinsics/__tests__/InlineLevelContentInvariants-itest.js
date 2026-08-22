/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The invariants of inline-level layout, tested as principles rather than as
 * the bugs that revealed them.
 *
 * Three separate defects this month came from one mistake: a predicate that
 * asked "is this inline?" and named only *one* of the two kinds of inline-level
 * content. The kinds look nothing alike in the tree — inline *text* content is a
 * `TextShadowNode` with the `InlineText` trait (`<span>`, `<a>`, `#text`), an
 * inline-level *box* is a Yoga node with `displayInline` (`inline-block`,
 * `inline-flex`) — so a half-written test is invisible in review and produces
 * layout that is correct for every tree containing a text node and broken for
 * every tree that has none.
 *
 * Each `describe` below states one principle and tests it in the way that fails
 * if either half is dropped: by asserting that two spellings of the same CSS
 * produce the *same geometry*. A test that only checked one spelling would have
 * passed throughout all three bugs.
 *
 * The browser-truth counterpart is `Conformance-itest.js`, which pins these
 * same principles to real Safari's coordinates.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const BOX = {display: 'inline-block', verticalAlign: 'top'};

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

function mount(element: React.MixedElement) {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
}

describe('inline-level content is two kinds, and both join a run', () => {
  test('a run of only boxes lays out like a run of boxes with text', () => {
    // THE parity test. Before the fix the left tree stacked vertically and the
    // right tree flowed, because a text node was what flagged the container for
    // its inline rebuild. Asserting either tree alone would have missed it;
    // asserting they agree is what makes the principle testable.
    const withoutText = [createRef<HostInstance>(), createRef<HostInstance>()];
    const withText = [createRef<HostInstance>(), createRef<HostInstance>()];

    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span ref={withoutText[0]} style={{...BOX, width: 40, height: 20}} />
        <span ref={withoutText[1]} style={{...BOX, width: 40, height: 20}} />
      </div>,
    );
    const bare = withoutText.map(rectOf);

    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span ref={withText[0]} style={{...BOX, width: 40, height: 20}} />
        <span ref={withText[1]} style={{...BOX, width: 40, height: 20}} />
        {/* A text node, which used to be what made the difference. */}
        {''}
      </div>,
    );
    const texted = withText.map(rectOf);

    // Same line, same x, in both spellings.
    expect(bare[0].y).toBe(bare[1].y);
    expect(bare[1].x).toBe(bare[0].x + bare[0].width);
    expect(bare[0]).toEqual(texted[0]);
    expect(bare[1]).toEqual(texted[1]);
  });

  test('an inline-flex box joins a run of boxes the same way', () => {
    // The other spelling of an inline-level box: it must be recognised by the
    // same predicate, not by a list of display values written somewhere else.
    const before = createRef<HostInstance>();
    const flex = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span ref={before} style={{...BOX, width: 40, height: 20}} />
        <span
          ref={flex}
          style={{
            display: 'inline-flex',
            verticalAlign: 'top',
            width: 40,
            height: 20,
          }}
        />
      </div>,
    );
    expect(rectOf(flex).y).toBe(rectOf(before).y);
    expect(rectOf(flex).x).toBe(rectOf(before).x + rectOf(before).width);
  });
});

describe('an inline box establishes no formatting context', () => {
  test('nesting depth does not move an atomic inline', () => {
    // The principle behind the `<a><img></a>` bug: the children of an inline
    // box are in the *parent's* IFC (CSS2 §9.4.2), so wrapping changes nothing
    // about where they land. Tested as invariance across depth rather than as
    // one expected coordinate, because the coordinate is the thing that would
    // have to be updated if the font or metrics changed — the invariance
    // would not.
    const measured = [];
    for (const depth of [0, 1, 3]) {
      const before = createRef<HostInstance>();
      const inner = createRef<HostInstance>();
      let box: React.Node = (
        // $FlowFixMe[prop-missing] elements from the catalog
        <span ref={inner} style={{...BOX, width: 40, height: 20}} />
      );
      for (let i = 0; i < depth; i++) {
        // $FlowFixMe[prop-missing] elements from the catalog
        box = <span>{box}</span>;
      }
      mount(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
          <span ref={before} style={{...BOX, width: 40, height: 20}} />
          {box}
        </div>,
      );
      measured.push(rectOf(inner));
    }
    expect(measured[1]).toEqual(measured[0]);
    expect(measured[2]).toEqual(measured[0]);
  });

  test('an inline box consumes no advance of its own', () => {
    // A corollary, and the one that catches double-counting: wrapping a box in
    // inline elements must not shift what follows it.
    const plain = createRef<HostInstance>();
    const wrapped = createRef<HostInstance>();

    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span style={{...BOX, width: 40, height: 20}} />
        <span ref={plain} style={{...BOX, width: 40, height: 20}} />
      </div>,
    );
    const withoutWrapper = rectOf(plain);

    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span>
          <span style={{...BOX, width: 40, height: 20}} />
        </span>
        <span ref={wrapped} style={{...BOX, width: 40, height: 20}} />
      </div>,
    );
    expect(rectOf(wrapped)).toEqual(withoutWrapper);
  });
});

describe('an atomic inline is placed relative to its own parent', () => {
  test('a nested box is not offset twice', () => {
    // The mounting layer composes a child's origin onto its parent's, so an
    // attachment written with a run-relative origin inside an inline element
    // that has stamped metrics lands at twice the offset. Pinned as "the inner
    // box starts where the preceding box ends", which is true regardless of
    // what those numbers are.
    const before = createRef<HostInstance>();
    const inner = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span ref={before} style={{...BOX, width: 40, height: 20}} />
        <span>
          <span ref={inner} style={{...BOX, width: 40, height: 20}} />
        </span>
      </div>,
    );
    const b = rectOf(before);
    expect(rectOf(inner).x).toBe(b.x + b.width);
  });
});

describe('a block container with only inline-level boxes still forms one', () => {
  test('the container is one line tall, not one line per box', () => {
    // The visible symptom of the stacking bug, stated as the property that
    // matters: three 20pt boxes on a 300pt line occupy ONE line box.
    const container = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div ref={container} style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span style={{...BOX, width: 40, height: 20}} />
        <span style={{...BOX, width: 40, height: 20}} />
        <span style={{...BOX, width: 40, height: 20}} />
      </div>,
    );
    expect(rectOf(container).height).toBe(20);
  });
});

describe('vertical-align positions an atomic inline on its line', () => {
  /*
   * Stated as relationships rather than coordinates. The exact offsets depend
   * on the strut, and `middle` depends on the parent's x-height — facts about a
   * font file, which differ between WebKit, CoreText and Android. What does not
   * differ is the ORDER and the containment, and those are what CSS actually
   * promises (CSS2 §10.8.1).
   */
  function measureAligned(align: string) {
    const line = createRef<HostInstance>();
    const tall = createRef<HostInstance>();
    const short = createRef<HostInstance>();
    mount(
      // $FlowFixMe[prop-missing] elements from the catalog
      <div ref={line} style={{width: 300, fontSize: 16, lineHeight: 20}}>
        <span ref={tall} style={{...BOX, width: 40, height: 40}} />
        <span
          ref={short}
          style={{
            display: 'inline-block',
            verticalAlign: align,
            width: 40,
            height: 20,
          }}
        />
      </div>,
    );
    return {line: rectOf(line), tall: rectOf(tall), short: rectOf(short)};
  }

  test('top puts the box at the top of the line box', () => {
    const {line, short} = measureAligned('top');
    expect(short.y).toBe(line.y);
  });

  test('bottom puts the box at the bottom of the line box', () => {
    const {line, short} = measureAligned('bottom');
    expect(short.y + short.height).toBe(line.y + line.height);
  });

  test('middle sits strictly between top and bottom', () => {
    // The property that survives every font: it is neither extreme.
    const {line, short} = measureAligned('middle');
    expect(short.y).toBeGreaterThan(line.y);
    expect(short.y + short.height).toBeLessThan(line.y + line.height);
  });

  test('every alignment keeps the box inside the line box', () => {
    // The containment CSS guarantees: the line box is the union of what is on
    // it, so no alignment may push a box out of the line it belongs to. This is
    // what a naive `top`/`bottom` implementation breaks, by positioning against
    // a line whose height was computed as though the box were on the baseline.
    for (const align of ['baseline', 'top', 'bottom', 'middle']) {
      const {line, short} = measureAligned(align);
      expect(short.y).toBeGreaterThanOrEqual(line.y);
      expect(short.y + short.height).toBeLessThanOrEqual(line.y + line.height);
    }
  });

  test('a top-aligned box still makes the line tall enough for it', () => {
    // Alignment changes where a box goes, never whether the line accommodates
    // it. A 60pt box on a 20pt line-height line makes a 60pt line however it is
    // aligned.
    for (const align of ['baseline', 'top', 'bottom', 'middle']) {
      const line = createRef<HostInstance>();
      mount(
        // $FlowFixMe[prop-missing] elements from the catalog
        <div ref={line} style={{width: 300, fontSize: 16, lineHeight: 20}}>
          <span
            style={{
              display: 'inline-block',
              verticalAlign: align,
              width: 40,
              height: 60,
            }}
          />
        </div>,
      );
      expect(rectOf(line).height).toBeGreaterThanOrEqual(60);
    }
  });

  test('alignment does not disturb the horizontal flow', () => {
    // vertical-align is vertical. A differently-aligned box must still take its
    // place in the advance, which is the thing most likely to break if it were
    // implemented by taking the box out of the line and re-placing it.
    for (const align of ['baseline', 'top', 'bottom', 'middle']) {
      const {tall, short} = measureAligned(align);
      expect(short.x).toBe(tall.x + tall.width);
    }
  });
});
