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

// A UA default is a default, not a forced value — the author wins, as in any
// cascade. `display:'flex'` on a <div> is Astryx's single most common style.
describe('<div> display is a default the author can override', () => {
  it('defaults to block', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{alignSelf: 'flex-start'}}>
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
        <View collapsable={false} ref={ref} style={{alignSelf: 'flex-start'}}>
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
describe('display selects an element\'s backing box', () => {
  it('a <span> with display:inline-flex lays its children out with flex', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
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
        <View collapsable={false} ref={ref} style={{display: 'block', alignSelf: 'flex-start'}}>
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
        <View collapsable={false} style={{display: 'block'}}>
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
        <View collapsable={false} ref={ref} style={{alignSelf: 'flex-start'}}>
          {/* $FlowExpectedError[not-a-component] */}
          <p>ab</p>
        </View>,
      );
    });

    // One 20pt line plus 16pt of margin above and below.
    expect(rectOf(ref).height).toBe(52);
  });

  it('an author style beats the UA default', () => {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={ref} style={{alignSelf: 'flex-start'}}>
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
          <h1 ref={h1} style={{alignSelf: 'flex-start', marginBlock: 0}}>ab</h1>
          {/* $FlowExpectedError[not-a-component] */}
          <div ref={plain} style={{alignSelf: 'flex-start'}}>{'ab'}</div>
          {/* Margins are measured on the *parent*: an element's own rect is
              its border box, which never includes them. */}
          <View collapsable={false} ref={noMargin} style={{alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <h1 style={{marginBlock: 0}}>ab</h1>
          </View>
          <View collapsable={false} ref={withMargin} style={{alignSelf: 'flex-start'}}>
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
    // h1's UA margin is 0.67em = 10.72 above and below. Compared loosely
    // because layout rounds to the pixel grid.
    expect(
      rectOf(withMargin).height - rectOf(noMargin).height,
    ).toBeCloseTo(21.44, 0);
  });

  it('a list indents by the UA marker gutter', () => {
    const plain = createRef<HostInstance>();
    const list = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] */}
          <div ref={plain} style={{alignSelf: 'flex-start'}}>{'ab'}</div>
          {/* $FlowExpectedError[not-a-component] */}
          <ul ref={list} style={{alignSelf: 'flex-start'}}>{'ab'}</ul>
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
        <View collapsable={false} style={{display: 'block'}}>
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
            <li key={String(i)} ref={refs[i]} style={{alignSelf: 'flex-start'}}>
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
    const widths = widthOfItems({tag: 'ol'}, Array.from({length: 10}, () => 'x'));
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
          <div ref={divRef} style={{alignSelf: 'flex-start'}}>
            abc
          </div>
          {/* $FlowExpectedError[not-a-component] intrinsic <p> tag */}
          <p ref={pRef} style={{alignSelf: 'flex-start'}}>
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
            <li ref={outsideRef} style={{alignSelf: 'flex-start'}}>
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
            <li ref={insideRef} style={{alignSelf: 'flex-start'}}>
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
