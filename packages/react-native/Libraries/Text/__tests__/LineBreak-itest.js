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

function heightOf(children: React.Node): number {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        ref={ref}
        collapsable={false}
        style={{display: 'block', width: 400}}>
        {children}
      </View>,
    );
  });
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect()
    .height;
}

describe('<br> forces a line break', () => {
  it('makes a one-line run into two lines', () => {
    const oneLine = heightOf('aa bb');
    const twoLines = heightOf(
      <>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'bb'}
      </>,
    );
    expect(twoLines).toBe(oneLine * 2);
  });

  // The reason this needs anything beyond emitting "\n": an ordinary newline
  // in source text is collapsible whitespace and becomes a single space
  // (css-text-3 §3). A <br>'s break is content and must survive that pass.
  it('survives whitespace collapsing, where a literal newline does not', () => {
    const withLiteralNewline = heightOf('aa\nbb');
    const withBreakElement = heightOf(
      <>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'bb'}
      </>,
    );
    // The literal newline collapses to a space and stays on one line.
    expect(withBreakElement).toBeGreaterThan(withLiteralNewline);
  });

  it('breaks more than once', () => {
    const oneLine = heightOf('aa');
    const threeLines = heightOf(
      <>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'bb'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'cc'}
      </>,
    );
    expect(threeLines).toBe(oneLine * 3);
  });

  // Whitespace after a break sits at the start of the new line, and CSS drops
  // leading whitespace on a line — so the second line must not be indented by
  // the space in the source.
  it('drops whitespace immediately after the break', () => {
    const tight = heightOf(
      <>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'bb'}
      </>,
    );
    const spaced = heightOf(
      <>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <br> tag */}
        <br />
        {'   bb'}
      </>,
    );
    expect(spaced).toBe(tight);
  });
});
