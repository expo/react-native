/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The element under test is measured directly and made shrink-to-fit: a block
// container otherwise fills its parent, so every reading would be the parent's
// width rather than the text's.
function boxOf(render: ({current: HostInstance | null}) => React.Node) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
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
    expect(preserved.height).toBe(40);
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
