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

// The type size the measurements are calibrated against; the document default
// is the platform's body size and differs per platform
const FONT_SIZE = 14;

// Shrink-to-fit, so a reading is the text's width rather than the parent's
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
// character count
// One line of <pre>, measured: its line height follows the document root, so
// two lines are asserted as twice this rather than as a number
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
    // characters. Not a <b>, which the measurer bills at 12pt a character.
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
  // The other half of `pre`: no wrapping, invisible unless a line is long
  // enough to wrap
  it('keeps a long line on one line where normal text wraps', () => {
    const long = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
    const wrapped = boxOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={SHRINK}>
        {long}
      </div>
    ));
    // Shrink-to-fit so the reading is the content's width; a block-level <pre>
    // is as wide as its container and its content overflows
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
