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
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import {uaStyleFor} from '@react-native/expo-intrinsics-poc/src/uaStyles';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

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
          <View
            collapsable={false}
            ref={strongRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {/* $FlowExpectedError[not-a-component] */}
            <strong>abcd</strong>
          </View>
          <View
            collapsable={false}
            ref={bRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {/* $FlowExpectedError[not-a-component] */}
            <b>abcd</b>
          </View>
          <View
            collapsable={false}
            ref={emRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {/* $FlowExpectedError[not-a-component] */}
            <em>abcd</em>
          </View>
          <View
            collapsable={false}
            ref={spanRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
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
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <p style={{marginBlock: 0}}>ab</p>
          {/* $FlowExpectedError[not-a-component] */}
          <p style={{marginBlock: 0}}>cd</p>
        </View>,
      );
    });

    // Two block lines, not one inline run: 40 tall and only as wide as one.
    // The UA block margins are zeroed so this measures block-ness alone; they
    // have their own test below.
    expect(rectOf(ref).height).toBe(40);
    expect(rectOf(ref).width).toBe(20);
  });

  it('<button>, <a> and <label> flow inline like <span>', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {/* $FlowExpectedError[not-a-component] */}
          <button>ab</button>
          {/* $FlowExpectedError[not-a-component] */}
          <a>cd</a>
          {/* $FlowExpectedError[not-a-component] */}
          <label>ef</label>
        </View>,
      );
    });

    /*
     * All three joined one inline run, on a single line.
     *
     * 6 characters at this runner's 10pt grid is 60, plus `<button>`'s
     * user-agent content inset on the inline axis. The inset is READ FROM THE
     * SHEET rather than restated: it is each platform's own (Fantom runs the
     * Android branch — Material's 24dp), pinned against the platform
     * measurements in `buttonMetrics-test.js`, and restating it here is how
     * this assertion went stale the last time the chrome changed.
     *
     * The line is TALLER than the strut because the button box is: its
     * user-agent minimum is the platform touch target, and a line box is the
     * union of the strut and everything on it. `toBeCloseTo` because the
     * Material label tracking (0.1, not binary-representable) contributes
     * sub-pixel float jitter.
     */
    const buttonUA = uaStyleFor('button');
    const inset = Number(buttonUA.paddingInline) * 2;
    expect(rectOf(ref).width).toBeCloseTo(60 + inset, 0);
    /*
     * The line grows past the strut by the button's block padding. The
     * user-agent `minHeight` (the platform touch target) is deliberately NOT
     * asserted here: this runner's deterministic inline-box measurer sizes an
     * inline element from its text plus padding and does not consult
     * min-height, so the assertion would report the harness. On a device the
     * button measures through its real component, minimum included — the
     * device conformance harness is the authority for that half.
     */
    expect(rectOf(ref).height).toBeGreaterThanOrEqual(
      20 + Number(buttonUA.paddingBlock) * 2,
    );
  });

  it('an inline element still takes its own box props', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {/* $FlowExpectedError[not-a-component] */}
          <button style={{paddingInline: 6}}>ab</button>
        </View>,
      );
    });

    // 20 for 'ab' on the grid, 6 per side of authored padding (the user-agent
    // padding withdraws when the author states any), within the tracking
    // jitter of the Material label typography.
    expect(rectOf(ref).width).toBeCloseTo(32, 0);
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
        <View
          collapsable={false}
          style={{display: 'block', fontSize: FONT_SIZE}}>
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
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
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
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
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
          <View
            collapsable={false}
            ref={atomicRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'ab'}
            <View style={{display: 'inline-flex', paddingBlock: 10}}>
              {'cd'}
            </View>
          </View>
          <View
            collapsable={false}
            ref={spanLikeRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
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

// A UA default is a default, not a forced value — the author wins, as in any
// cascade. `display:'flex'` on a <div> is Astryx's single most common style.
describe('<div> display is a default the author can override', () => {
  it('defaults to block', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <div>
            <View style={{width: 30, height: 10}} />
            <View style={{width: 20, height: 10}} />
          </div>
        </View>,
      );
    });
    // Block: children stack, so the box is as wide as the widest child.
    expect(rectOf(ref).width).toBe(30);
    expect(rectOf(ref).height).toBe(20);
  });

  it('honors an authored display:flex', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <div style={{display: 'flex', flexDirection: 'row'}}>
            <View style={{width: 30, height: 10}} />
            <View style={{width: 20, height: 10}} />
          </div>
        </View>,
      );
    });
    // Flex row: children sit side by side and the box is 50 wide, 10 tall.
    expect(rectOf(ref).width).toBe(50);
    expect(rectOf(ref).height).toBe(10);
  });
});

// Box generation follows computed `display`, not the tag: a <span> is the
// cheap text-backed component while it folds into an inline formatting
// context, and a real box when its display establishes one.
describe("display selects an element's backing box", () => {
  it('a <span> with display:inline-flex lays its children out with flex', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {/* $FlowExpectedError[not-a-component] */}
          <span style={{display: 'inline-flex', flexDirection: 'row'}}>
            <View style={{width: 30, height: 10}} />
            <View style={{width: 20, height: 10}} />
          </span>
        </View>,
      );
    });

    // A text-backed <span> could not lay these out at all — it is not a Yoga
    // node. 50 wide means it became a real flex box.
    expect(rectOf(ref).width).toBe(50);
  });

  it('a plain <span> still folds into the surrounding text run', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'ab'}
          {/* $FlowExpectedError[not-a-component] */}
          <span>cd</span>
          {'ef'}
        </View>,
      );
    });

    // One 6-character run on one line: still the cheap text flavor.
    expect(rectOf(ref).width).toBe(60);
    expect(rectOf(ref).height).toBe(20);
  });

  it('a box-flavored element still reports its own tagName', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{display: 'block', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <span ref={ref} style={{display: 'inline-flex'}}>
            <View style={{width: 10, height: 10}} />
          </span>
        </View>,
      );
    });

    // Backed by `element-box`, but it is still a <span>.
    // $FlowFixMe[prop-missing] DOM tagName
    expect(ref.current?.tagName).toBe('RN:span');
  });
});

// The user-agent stylesheet: element defaults live in a table (uaStyles.js)
// and are merged beneath the author's style, which is the cascade's UA origin.
describe('user-agent styles', () => {
  it('<p> carries the UA default block margins', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <p>ab</p>
        </View>,
      );
    });

    /*
     * One 20pt line, plus `p { margin-block: 1em }` above and below.
     *
     * The `em` is the paragraph's own computed font size, which it inherits
     * from the View around it — so it is FONT_SIZE, not the root's size. That
     * distinction is the whole assertion: this read 52 while the sheet was
     * sending the root's 16pt regardless of context, and reads 48 now that the
     * paragraph resolves its margin against the 14pt it is actually set in.
     */
    expect(rectOf(ref).height).toBe(20 + 2 * FONT_SIZE);
  });

  it('an author style beats the UA default', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={ref}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <p style={{marginBlock: 0}}>ab</p>
        </View>,
      );
    });

    // The author zeroed the margins, so the line is all that remains.
    expect(rectOf(ref).height).toBe(20);
  });
});

// The catalog: with the UA sheet in place, an element is a table row plus a
// registration, so these assert the sheet is actually reaching each of them.
describe('the wider element catalog', () => {
  it('headings are bold and carry their UA margins', () => {
    const h1 = createRef<HostInstance>();
    const plain = createRef<HostInstance>();
    const noMargin = createRef<HostInstance>();
    const withMargin = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] */}
          <h1 ref={h1} style={{alignSelf: 'flex-start', marginBlock: 0}}>
            ab
          </h1>
          {/* $FlowExpectedError[not-a-component] */}
          <div
            ref={plain}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'ab'}
          </div>
          {/* Margins are measured on the *parent*: an element's own rect is
              its border box, which never includes them. */}
          <View
            collapsable={false}
            ref={noMargin}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {/* $FlowExpectedError[not-a-component] */}
            <h1 style={{marginBlock: 0}}>ab</h1>
          </View>
          <View
            collapsable={false}
            ref={withMargin}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {/* $FlowExpectedError[not-a-component] */}
            <h1>ab</h1>
          </View>
        </>,
      );
    });

    // Bold measures wider than the plain baseline. Heading *font sizes* are in
    // the sheet but cannot be asserted here: the deterministic measurer is a
    // fixed 10pt per character regardless of fontSize.
    expect(rectOf(h1).width).toBeGreaterThan(rectOf(plain).width);
    /*
     * The margin the sheet declares, above and below — read FROM the sheet
     * rather than written out here.
     *
     * What this test is for is that the user-agent style reaches the element at
     * all. Whether the value is the right one is a different question, and it is
     * answered somewhere else: `HeadingMargins-itest` pins all six headings
     * against real Safari's computed styles. Naming the number in both places
     * means the wrong one gets copied — this assertion used to read `21.44`,
     * which was twice `0.67 × root` back when the sheet resolved heading margins
     * against the root instead of against the heading's own font-size. It went
     * on passing after that was fixed only because nobody re-derived it.
     *
     * The sheet states `em` FACTORS now, not lengths — both sizes come from the
     * renderer, so both multiplications happen there. The factors are read back
     * from the sheet here for the same reason the length used to be: so that
     * this asserts the style ARRIVING, and `HeadingMargins-itest` remains the
     * one place that says what the values should be.
     *
     * Two multiplications, because the two `em`s resolve one step apart: the
     * heading's size is `2em` of what it INHERITED (FONT_SIZE, from the View
     * around it), and its margin is `0.67em` of that result.
     *
     * Compared loosely because layout rounds to the pixel grid.
     */
    const ownFontSize = Number(uaStyleFor('h1').uaFontSizeEm) * FONT_SIZE;
    const declared = Number(uaStyleFor('h1').uaMarginBlockEm) * ownFontSize;
    expect(rectOf(withMargin).height - rectOf(noMargin).height).toBeCloseTo(
      2 * declared,
      0,
    );
  });

  it('a list indents by the UA marker gutter', () => {
    const plain = createRef<HostInstance>();
    const list = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] */}
          <div
            ref={plain}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'ab'}
          </div>
          {/* $FlowExpectedError[not-a-component] */}
          <ul ref={list} style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'ab'}
          </ul>
        </>,
      );
    });

    // Shrink-to-fit, or both blocks would fill the root and the padding would
    // not show up in the outer width at all.
    // 40pt of padding-inline-start, and the UA block margins above/below.
    expect(rectOf(list).width - rectOf(plain).width).toBe(40);
  });

  it('inline elements take their UA styling and keep their tag', () => {
    const code = createRef<HostInstance>();
    const strong = createRef<HostInstance>();
    const span = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{display: 'block', fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] */}
          <code ref={code}>ab</code>
          {/* $FlowExpectedError[not-a-component] */}
          <strong ref={strong}>ab</strong>
          {/* $FlowExpectedError[not-a-component] */}
          <span ref={span}>ab</span>
        </View>,
      );
    });

    // <strong>'s bold now comes from the UA sheet rather than from aliasing
    // <b>, so it must still measure wider than an unstyled <span>.
    expect(rectOf(strong).width).toBeGreaterThan(rectOf(span).width);
    // $FlowFixMe[prop-missing] DOM tagName
    expect(code.current?.tagName).toBe('RN:code');
    // $FlowFixMe[prop-missing] DOM tagName
    expect(strong.current?.tagName).toBe('RN:strong');
  });
});

describe('list markers (css-lists-3 §3)', () => {
  // An `inside` marker is measured with the content, so its text is visible in
  // the item's width: the deterministic measurer bills 10pt per UTF-8 byte, and
  // every marker below is ASCII plus a 2-byte no-break space gap.
  function widthOfItems(
    listProps: {
      tag: string,
      listStyleType?: string,
      start?: number,
    },
    items: Array<string>,
  ): Array<number> {
    const refs = items.map(() => createRef<HostInstance>());
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[not-a-component] intrinsic <ol>/<ul> tag
        <listProps.tag
          style={{
            alignSelf: 'flex-start',
            paddingInlineStart: 0,
            listStyleType: listProps.listStyleType,
            listStylePosition: 'inside',
          }}
          start={listProps.start}>
          {items.map((text, i) => (
            // $FlowExpectedError[not-a-component] intrinsic <li> tag
            <li
              key={String(i)}
              ref={refs[i]}
              style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
              {text}
            </li>
          ))}
        </listProps.tag>,
      );
    });
    return refs.map(ref => rectOf(ref).width);
  }

  // 'x' is 1 byte; the gap after a marker is a 2-byte no-break space.
  const TEXT = 10;
  const GAP = 20;

  it('an unordered list marks every item with a bullet', () => {
    const [a, b] = widthOfItems({tag: 'ul'}, ['x', 'x']);
    // The bullet is a 3-byte glyph, so both items are the same width and wider
    // than the bare text.
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(TEXT + GAP);
  });

  it('an ordered list counts its items', () => {
    const widths = widthOfItems({tag: 'ol'}, ['x', 'x', 'x']);
    // "1." "2." "3." are all 2 bytes, so the widths match...
    expect(widths[0]).toBe(widths[1]);
    expect(widths[0]).toBe(TEXT + GAP + 20);
  });

  it('the counter reaches two digits', () => {
    const widths = widthOfItems(
      {tag: 'ol'},
      Array.from({length: 10}, () => 'x'),
    );
    // ...until "10.", which is one byte wider than "9.".
    expect(widths[9] - widths[8]).toBe(10);
  });

  it('<ol start> seeds the counter', () => {
    const [first] = widthOfItems({tag: 'ol', start: 9}, ['x', 'x']);
    const [plain] = widthOfItems({tag: 'ol'}, ['x', 'x']);
    // "9." is the same width as "1."; the second item is "10." and wider.
    expect(first).toBe(plain);
    const [, second] = widthOfItems({tag: 'ol', start: 9}, ['x', 'x']);
    expect(second - first).toBe(10);
  });

  it('lower-alpha counts a, b, c and carries to aa', () => {
    const widths = widthOfItems(
      {tag: 'ol', listStyleType: 'lower-alpha'},
      Array.from({length: 27}, () => 'x'),
    );
    expect(widths[0]).toBe(TEXT + GAP + 20); // "a."
    expect(widths[25]).toBe(widths[0]); // "z."
    expect(widths[26] - widths[25]).toBe(10); // "aa."
  });

  it('roman numerals use the subtractive pairs', () => {
    const widths = widthOfItems(
      {tag: 'ol', listStyleType: 'upper-roman'},
      Array.from({length: 9}, () => 'x'),
    );
    expect(widths[0]).toBe(TEXT + GAP + 20); // "I."
    expect(widths[2] - widths[0]).toBe(20); // "III." is two wider than "I."
    expect(widths[3]).toBe(widths[1]); // "IV." matches "II."
    expect(widths[8]).toBe(widths[1]); // "IX." too
  });

  /*
   * The rest of the predefined counter styles reach the marker through the
   * real pipeline. The measurer bills 10pt per UTF-8 BYTE, which is what makes
   * these assertions sharp: a Devanagari digit is 3 bytes where an ASCII one
   * is 1, and an ideographic-comma suffix is 3 where a full stop is 1. So a
   * style that silently fell back to `decimal` could not produce these widths.
   *
   * The exact marker STRINGS are pinned in ListStyleTest.cpp; this is the
   * end-to-end half — that the keyword parses and the marker is measured.
   */
  it('the predefined numeric styles reach the marker', () => {
    // "१." — a 3-byte digit plus a 1-byte suffix.
    const [devanagari] = widthOfItems(
      {tag: 'ol', listStyleType: 'devanagari'},
      ['x'],
    );
    expect(devanagari).toBe(TEXT + GAP + 40);

    // "๑." — Thai digits are 3 bytes too.
    const [thai] = widthOfItems({tag: 'ol', listStyleType: 'thai'}, ['x']);
    expect(thai).toBe(devanagari);

    // "01." — decimal-leading-zero pads its own range to two digits.
    const zeroPadded = widthOfItems(
      {tag: 'ol', listStyleType: 'decimal-leading-zero'},
      Array.from({length: 10}, () => 'x'),
    );
    expect(zeroPadded[0]).toBe(TEXT + GAP + 30); // "01."
    expect(zeroPadded[9]).toBe(zeroPadded[0]); // "10." is the same width

    // "一、" — a 3-byte digit AND a 3-byte ideographic comma.
    const [cjk] = widthOfItems({tag: 'ol', listStyleType: 'cjk-decimal'}, [
      'x',
    ]);
    expect(cjk).toBe(TEXT + GAP + 60);
  });

  it('the predefined alphabetic styles carry bijectively', () => {
    // "α." (2-byte Greek + 1-byte suffix), through ω at 24, carrying to "αα."
    const greek = widthOfItems(
      {tag: 'ol', listStyleType: 'lower-greek'},
      Array.from({length: 25}, () => 'x'),
    );
    expect(greek[0]).toBe(TEXT + GAP + 30); // "α."
    expect(greek[23]).toBe(greek[0]); // "ω." — still one letter
    expect(greek[24] - greek[23]).toBe(20); // "αα." — one more 2-byte letter

    // "あ、" — 3-byte kana and a 3-byte suffix, carrying after 48.
    const kana = widthOfItems(
      {tag: 'ol', listStyleType: 'hiragana'},
      Array.from({length: 49}, () => 'x'),
    );
    expect(kana[0]).toBe(TEXT + GAP + 60);
    expect(kana[47]).toBe(kana[0]); // "ん、"
    expect(kana[48] - kana[47]).toBe(30); // "ああ、"
  });

  it('list-style-type: none suppresses the marker', () => {
    const [withNone] = widthOfItems({tag: 'ul', listStyleType: 'none'}, ['x']);
    expect(withNone).toBe(TEXT);
  });

  it('an unknown list-style-type falls back rather than breaking', () => {
    const [unknown] = widthOfItems(
      {tag: 'ol', listStyleType: 'cjk-earthly-branch'},
      ['x'],
    );
    const [decimal] = widthOfItems({tag: 'ol'}, ['x']);
    expect(unknown).toBe(decimal);
  });

  it('a non-list block gets no marker', () => {
    const divRef = createRef<HostInstance>();
    const pRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div
            ref={divRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            abc
          </div>
          {/* $FlowExpectedError[not-a-component] intrinsic <p> tag */}
          <p ref={pRef} style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            abc
          </p>
        </>,
      );
    });
    expect(rectOf(divRef).width).toBe(rectOf(pRef).width);
  });

  it('an outside marker leaves the content box where it is', () => {
    // The CSS initial value. It must NOT be measured, or the content could not
    // hang past it — that is the whole point of `outside`.
    const outsideRef = createRef<HostInstance>();
    const insideRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic <ul> tag */}
          <ul style={{alignSelf: 'flex-start', paddingInlineStart: 0}}>
            {/* $FlowExpectedError[not-a-component] */}
            <li
              ref={outsideRef}
              style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
              x
            </li>
          </ul>
          {/* $FlowExpectedError[not-a-component] intrinsic <ul> tag */}
          <ul
            style={{
              alignSelf: 'flex-start',
              paddingInlineStart: 0,
              listStylePosition: 'inside',
            }}>
            {/* $FlowExpectedError[not-a-component] */}
            <li
              ref={insideRef}
              style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
              x
            </li>
          </ul>
        </>,
      );
    });
    expect(rectOf(outsideRef).width).toBe(TEXT);
    expect(rectOf(insideRef).width).toBeGreaterThan(TEXT);
  });
});

describe('nested lists', () => {
  it('each level indents by its own gutter and steps the bullet', () => {
    const l1 = createRef<HostInstance>();
    const l2 = createRef<HostInstance>();
    const l3 = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // The same shape as the intrinsics demo and the web reference page.
        // $FlowExpectedError[not-a-component] intrinsic <ul> tag
        <ul>
          {/* $FlowExpectedError[not-a-component] */}
          <li ref={l1}>x</li>
          {/* $FlowExpectedError[not-a-component] */}
          <ul>
            {/* $FlowExpectedError[not-a-component] */}
            <li ref={l2}>x</li>
            {/* $FlowExpectedError[not-a-component] */}
            <ul>
              {/* $FlowExpectedError[not-a-component] */}
              <li ref={l3}>x</li>
            </ul>
          </ul>
        </ul>,
      );
    });

    // Each `<ul>` contributes the UA's 40pt marker gutter, so an item's text
    // starts 40 further in at every level — the same staircase the browser
    // draws, and the number to compare the web reference against.
    const a = rectOf(l1).x;
    const b = rectOf(l2).x;
    const c = rectOf(l3).x;
    expect(b - a).toBe(40);
    expect(c - b).toBe(40);
  });
});
