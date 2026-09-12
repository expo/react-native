/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import NativeScroll from '../src/NativeScroll';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

/**
 * What the JavaScript half of `<native:scroll>` is responsible for.
 *
 * That half got much smaller. The element used to be a `ScrollView` with four
 * props set, and these tests used to assert those four props; the defaults now
 * live in the C++ props struct, which is a better place for them — one decision
 * per behaviour, shared by both platforms — and they are asserted through the
 * real renderer in NativeScroll-itest.js rather than here, where a JavaScript
 * assertion could only have restated a JavaScript constant.
 *
 * What is left in JavaScript is the SHAPE: a scrolling container is a viewport
 * with exactly one thing inside it, and that container is what
 * `contentContainerStyle` styles. That is worth pinning because getting it wrong
 * does not throw — it silently scrolls only the first child.
 */
function tree(element: React.MixedElement): $FlowFixMe {
  let renderer: ?$FlowFixMe = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('the renderer did not produce a tree');
  }
  return renderer.toJSON();
}

describe('<native:scroll>’s structure', () => {
  it('wraps its children in exactly one content container', () => {
    const out = tree(
      <NativeScroll>
        <mock-child-a />
        <mock-child-b />
      </NativeScroll>,
    );

    expect(out.type).toBe('native-scroll');
    expect(out.children).toHaveLength(1);
    expect(out.children[0].children.map(child => child.type)).toEqual([
      'mock-child-a',
      'mock-child-b',
    ]);
  });

  it('keeps the content container from being flattened away', () => {
    const out = tree(
      <NativeScroll>
        <mock-child />
      </NativeScroll>,
    );

    // Load-bearing, not defensive. With no style of its own the container has
    // nothing to draw, so the renderer flattens it and mounts the children
    // straight into the scroll view — which then has many children instead of
    // the one the platform containers are built around.
    expect(out.children[0].props.collapsable).toBe(false);
  });

  it('styles the content, not the viewport', () => {
    const out = tree(
      <NativeScroll
        style={{backgroundColor: 'white'}}
        contentContainerStyle={{padding: 16}}>
        <mock-child />
      </NativeScroll>,
    );

    // The two styles address different boxes and are easy to confuse: padding on
    // the viewport would inset the scrollable area rather than the content.
    expect(out.props.style).toEqual({backgroundColor: 'white'});
    expect(out.children[0].props.style).toEqual({padding: 16});
  });

  it('passes everything else straight through to the element', () => {
    const out = tree(
      <NativeScroll avoidsKeyboard={false} contentInset={{bottom: 8}}>
        <mock-child />
      </NativeScroll>,
    );

    expect(out.props.avoidsKeyboard).toBe(false);
    expect(out.props.contentInset).toEqual({bottom: 8});
  });
});
