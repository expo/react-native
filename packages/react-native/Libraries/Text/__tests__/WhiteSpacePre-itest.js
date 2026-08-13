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

/*
 * The type size these measurements were calibrated against.
 *
 * Stated rather than inherited: the document's default font size is the
 * platform's own body size (17pt on iOS, 16sp on Android) rather than React
 * Native's historical 14, so a fixture that leaves it unset measures a
 * different number of points on each platform and moved the day that default
 * did. Nothing here is about the type size, so pinning it is what keeps these
 * assertions about the property they name.
 */
const FONT_SIZE = 14;

// The element under test is measured directly and made shrink-to-fit: a block
// container otherwise fills its parent, so every reading would be the parent's
// width rather than the text's.
function boxOf(render: ({current: HostInstance | null}) => React.Node) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400, fontSize: FONT_SIZE}}>
        {render(ref)}
      </View>,
    );
  });
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

const SHRINK = {alignSelf: 'flex-start'};

// The deterministic measurer bills 10pt per character, so a width is a
// character count — which is exactly what "did the whitespace survive?" asks.
/*
 * One line of `<pre>`, measured rather than assumed.
 *
 * `<pre>` carries its own `font-size: 0.8125em` from the user-agent sheet, so
 * its line height follows the document root — which is the platform's body
 * size, not a fixed 16. Asserting `40` for two lines silently encoded one
 * platform's root; asserting `2 × this` says what the test means, which is that
 * the newline produced a second line.
 */
const PRE_LINE = (): number =>
  boxOf(ref => (
    // $FlowExpectedError[not-a-component] intrinsic <pre> tag
    <pre ref={ref} style={SHRINK}>
      {'aa'}
    </pre>
  )).height;

describe('white-space: pre preserves what normal collapses', () => {
  it('keeps a run of spaces instead of collapsing it to one', () => {
    // "a   b" is 5 characters preserved, 3 when collapsed to "a b".
    const collapsed = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={SHRINK}>
        {'a   b'}
      </div>
    ));
    const preserved = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {'a   b'}
      </pre>
    ));
    expect(collapsed.width).toBe(30);
    expect(preserved.width).toBe(50);
  });

  it('keeps a newline as a line break instead of a space', () => {
    const collapsed = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={SHRINK}>
        {'aa\nbb'}
      </div>
    ));
    const preserved = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {'aa\nbb'}
      </pre>
    ));
    // Collapsed: one line of "aa bb". Preserved: two lines of "aa".
    expect(collapsed.height).toBe(20);
    expect(preserved.height).toBeCloseTo(2 * PRE_LINE(), 1);
  });

  it('keeps leading whitespace that a block would trim', () => {
    const collapsed = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={SHRINK}>
        {'  ab'}
      </div>
    ));
    const preserved = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {'  ab'}
      </pre>
    ));
    expect(collapsed.width).toBe(20);
    expect(preserved.width).toBe(40);
  });

  // white-space is an inherited property, so a nested element inside <pre>
  // keeps it rather than reverting to collapsing.
  it('inherits into nested inline elements', () => {
    const preserved = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {'a  '}
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span>{'b  c'}</span>
      </pre>
    ));
    // Every space survives on both sides of the <span>: "a  " + "b  c" = 7
    // characters. Deliberately not a <b>: the measurer bills bold at 12pt a
    // character rather than 10, which makes the sum say more about the
    // measurer than about inheritance.
    expect(preserved.width).toBe(70);
  });

  it('an author can set it directly, not only via <pre>', () => {
    const preserved = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{...SHRINK, whiteSpace: 'pre'}}>
        {'a   b'}
      </div>
    ));
    expect(preserved.width).toBe(50);
  });
});

describe('white-space: pre does not wrap', () => {
  // The other half of `pre`. Preserving whitespace but still folding long
  // lines gets the characters right and the layout wrong — and it is the half
  // that is invisible unless a line is long enough to wrap.
  it('keeps a long line on one line where normal text wraps', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
    const wrapped = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={SHRINK}>
        {long}
      </div>
    ));
    // Shrink-to-fit so the reading is the CONTENT's width. A block-level <pre>
    // is as wide as its container and its content overflows — which is what
    // the web does, and why the box alone cannot show whether it wrapped.
    const unwrapped = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {long}
      </pre>
    ));
    // 49 characters at 10pt each is 490 — well past the 400 container.
    expect(wrapped.height).toBeGreaterThan(PRE_LINE());
    expect(unwrapped.height).toBeCloseTo(PRE_LINE(), 1);
    expect(unwrapped.width).toBe(490);
  });

  it('still breaks where the author wrote a newline', () => {
    // No wrapping does not mean no breaks: an explicit newline is preserved
    // content and still ends the line.
    const box = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <pre> tag
      <pre ref={ref} style={SHRINK}>
        {'aaaaaaaa\nbb'}
      </pre>
    ));
    expect(box.height).toBeCloseTo(2 * PRE_LINE(), 1);
    expect(box.width).toBe(80);
  });
});
