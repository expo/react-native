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

function boxOf(whiteSpace: string, text: string, style: {...}) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
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
// actually assert. The measurer bills 10pt per character and lays out 20pt
// lines, so both divide exactly.
const charsWide = (whiteSpace: string, text: string) =>
  boxOf(whiteSpace, text, SHRINK).width / 10;
const linesTall = (whiteSpace: string, text: string) =>
  boxOf(whiteSpace, text, BLOCK).height / 20;

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
