/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/**
 * `white-space` is a shorthand over three independent behaviours (css-text-3
 * §3), so the six values are checked one AXIS at a time rather than one value
 * at a time: a value that gets newlines right and spaces wrong is a different
 * bug from one that gets the wrapping wrong, and a per-value test would only
 * be able to say "pre-line is broken".
 *
 * The expectations are not read off the spec text. They were measured in
 * Safari 26.5 through safaridriver — the same probe strings in a monospace
 * box, reported as character counts and line counts. Where this file and a
 * browser disagree, the browser is right.
 */

// Shrink-to-fit, for the probes asking "how many characters survived?". A
// block box would just report its container's width.
const SHRINK = {alignSelf: 'flex-start'};
// Block-level in a 400pt parent — 40 characters at the deterministic
// measurer's 10pt per character — for the probes asking "did it wrap?".
const BLOCK = {display: 'block'};

// 49 characters into a 40-character box.
const LONG = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';

/*
 * The type size these probes are calibrated against, stated rather than
 * inherited.
 *
 * The helpers below divide a measured box by 10pt per character and 20pt per
 * line, and those figures are the deterministic measurer's output *at this
 * size* — not constants. Left to the document's default they moved the day the
 * default did (React Native's 14 became the platform's own body size), and
 * `linesTall` started returning 2.3 where it wanted 2. Nothing about
 * white-space processing depends on the type size, so pinning it here is what
 * makes these tests about the thing they are named for.
 */
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CHAR_WIDTH = 10;

function boxOf(whiteSpace: string, text: string, style: {...}) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400, fontSize: FONT_SIZE}}>
        {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
        <div ref={ref} style={{...style, whiteSpace}}>
          {text}
        </div>
      </View>,
    );
  });
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

// A width in characters and a height in lines, which is what the probes below
// actually assert. At FONT_SIZE the measurer bills CHAR_WIDTH per character and
// lays out LINE_HEIGHT lines, so both divide exactly.
const charsWide = (whiteSpace: string, text: string) =>
  boxOf(whiteSpace, text, SHRINK).width / CHAR_WIDTH;
const linesTall = (whiteSpace: string, text: string) =>
  boxOf(whiteSpace, text, BLOCK).height / LINE_HEIGHT;

describe('white-space: the spaces and tabs axis', () => {
  // Safari: 'a   b' is 5 characters under pre/pre-wrap/break-spaces, 3 under
  // normal/nowrap/pre-line.
  for (const whiteSpace of ['pre', 'pre-wrap', 'break-spaces']) {
    it(`${whiteSpace} keeps a run of spaces`, () => {
      expect(charsWide(whiteSpace, 'a   b')).toBe(5);
    });

    it(`${whiteSpace} keeps leading whitespace`, () => {
      expect(charsWide(whiteSpace, '   ab')).toBe(5);
    });
  }

  for (const whiteSpace of ['normal', 'nowrap', 'pre-line']) {
    it(`${whiteSpace} collapses a run of spaces to one`, () => {
      expect(charsWide(whiteSpace, 'a   b')).toBe(3);
    });

    it(`${whiteSpace} trims leading whitespace`, () => {
      expect(charsWide(whiteSpace, '   ab')).toBe(2);
    });
  }
});

describe('white-space: the newlines axis', () => {
  // Safari: 'aa\nbb' is two lines under everything but normal and nowrap,
  // where it collapses to the single line 'aa bb' — 5 characters.
  for (const whiteSpace of ['pre', 'pre-wrap', 'pre-line', 'break-spaces']) {
    it(`${whiteSpace} keeps a newline as a line break`, () => {
      expect(linesTall(whiteSpace, 'aa\nbb')).toBe(2);
    });
  }

  for (const whiteSpace of ['normal', 'nowrap']) {
    it(`${whiteSpace} collapses a newline to a space`, () => {
      expect(linesTall(whiteSpace, 'aa\nbb')).toBe(1);
      expect(charsWide(whiteSpace, 'aa\nbb')).toBe(5);
    });
  }
});

describe('white-space: the wrapping axis', () => {
  for (const whiteSpace of ['normal', 'pre-wrap', 'pre-line', 'break-spaces']) {
    it(`${whiteSpace} wraps a line that does not fit`, () => {
      expect(linesTall(whiteSpace, LONG)).toBeGreaterThan(1);
    });
  }

  for (const whiteSpace of ['pre', 'nowrap']) {
    it(`${whiteSpace} overflows instead of wrapping`, () => {
      expect(linesTall(whiteSpace, LONG)).toBe(1);
    });
  }

  // The two axes are independent, and this is where that shows: `nowrap`
  // collapses the newline AND refuses to wrap, so a string that breaks once
  // under `pre` does not break at all under `nowrap`.
  it('nowrap does not break even where pre does', () => {
    const text = 'aa\ncccc dddd eeee ffff gggg hhhh iiii jjjj';
    expect(linesTall('pre', text)).toBe(2);
    expect(linesTall('nowrap', text)).toBe(1);
  });
});

describe('white-space: pre-line, where the axes disagree', () => {
  // The value that makes a two-value model impossible: it preserves segment
  // breaks while still collapsing spaces, so it is neither `pre` nor `normal`
  // on any single reading. Before this it was treated as `normal`, which threw
  // the newlines away.
  it('keeps the newline but collapses the spaces around it', () => {
    // Safari: 'aa  \n  bb' lays out as two lines, 'aa' and 'bb'. The spaces
    // before the break would end a line and the ones after would lead the
    // next, so both are dropped rather than collapsed to one.
    expect(linesTall('pre-line', 'aa  \n  bb')).toBe(2);
    expect(charsWide('pre-line', 'aa  \n  bb')).toBe(2);
  });

  it('still wraps, unlike pre', () => {
    expect(linesTall('pre-line', LONG)).toBeGreaterThan(1);
    expect(linesTall('pre', LONG)).toBe(1);
  });
});

describe('white-space: every value is understood', () => {
  // A value that fails to parse falls back to the default, which would make
  // one of the rows above quietly test `normal` a second time. This asserts
  // the parsing itself: each value's three axes together, against the row the
  // browser produced.
  const TABLE = {
    normal: '3/1/wraps',
    pre: '5/2/overflows',
    nowrap: '3/1/overflows',
    'pre-wrap': '5/2/wraps',
    'pre-line': '3/2/wraps',
    'break-spaces': '5/2/wraps',
  };

  for (const whiteSpace of Object.keys(TABLE)) {
    it(`${whiteSpace} matches the browser on all three axes`, () => {
      const spaces = charsWide(whiteSpace, 'a   b');
      const newlines = linesTall(whiteSpace, 'aa\nbb');
      const wrapping = linesTall(whiteSpace, LONG) > 1 ? 'wraps' : 'overflows';
      expect(`${spaces}/${newlines}/${wrapping}`).toBe(TABLE[whiteSpace]);
    });
  }
});

describe('a segment break and the space before it', () => {
  /*
   * css-text-3 §4.1.1 removes a collapsible space next to a segment break, and
   * it says so about the inline formatting context, not about a text node. The
   * space and the break can therefore sit in different fragments — `a ` followed
   * by an inline element whose text starts with a newline — and the space still
   * goes.
   *
   * Measured against the same markup with no space to remove, because an inline
   * element contributes width of its own and only the DIFFERENCE is the space.
   * Safari renders both of these at one character wide.
   */
  function widthOf(children: React.Node): number {
    const ref = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{width: 400, fontSize: FONT_SIZE}}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div ref={ref} style={{...SHRINK, whiteSpace: 'pre-line'}}>
            {children}
          </div>
        </View>,
      );
    });
    const width = ensureInstance(
      ref.current,
      ReactNativeElement,
    ).getBoundingClientRect().width;
    root.destroy();
    return width;
  }

  it('removes it when both are in one text node', () => {
    expect(widthOf('a \nb') / CHAR_WIDTH).toBe(1);
  });

  it('removes it when the break is in a later fragment', () => {
    // $FlowExpectedError[not-a-component] intrinsic <b> tag
    const withSpace = widthOf([
      <React.Fragment key="a">{'a '}</React.Fragment>,
      <b key="b">{'\nb'}</b>,
    ]);
    // $FlowExpectedError[not-a-component] intrinsic <b> tag
    const without = widthOf([
      <React.Fragment key="a">{'a'}</React.Fragment>,
      <b key="b">{'\nb'}</b>,
    ]);
    expect(withSpace).toBe(without);
  });
});
