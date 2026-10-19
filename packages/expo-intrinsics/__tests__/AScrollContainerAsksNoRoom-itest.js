/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {ScrollView} from 'react-native';

import '@react-native/expo-intrinsics-poc';

function height(ref: {current: HostInstance | null}): number {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return r.height;
}

// A screen is a column of a wrapper around a scroll view and a composer. The
// wrapper's automatic minimum (css-flexbox-1 §4.5) is its min-content height,
// and what the scroll view holds is not part of it: that scrolls inside the
// scroll view's own box, which the same rule gives a zero minimum
test('a flex item holding a scroll view is not sized to what scrolls', () => {
  const wrapper = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{height: 100, display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={wrapper}
          style={{display: 'flex', flexDirection: 'column', flex: 1}}>
          <ScrollView style={{flex: 1}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{height: 500}} />
          </ScrollView>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{height: 20}} />
      </div>,
    );
  });
  expect(height(wrapper)).toBe(80);
});

// A wrapper that starts at its content height, as a column item without
// `flex: 1` does, shrinks past the scroll view's content for the same reason
test('a shrinking flex item holding a scroll view yields past its content', () => {
  const wrapper = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{height: 100, display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={wrapper}
          style={{display: 'flex', flexDirection: 'column', flexShrink: 1}}>
          <ScrollView style={{flexShrink: 1}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{height: 500}} />
          </ScrollView>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{height: 20, flexShrink: 0}} />
      </div>,
    );
  });
  expect(height(wrapper)).toBe(80);
});

// The same holds for any box that clips: its content asks no room of an
// ancestor, so a wrapper that shrinks from its content height yields to the
// composer below it
test('a flex item holding a clipping box is not sized to what is clipped', () => {
  const wrapper = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{height: 100, display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={wrapper}
          style={{display: 'flex', flexDirection: 'column', flexShrink: 1}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{flexShrink: 1, overflow: 'hidden', padding: 5}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{height: 500}} />
          </div>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{height: 20, flexShrink: 0}} />
      </div>,
    );
  });
  expect(height(wrapper)).toBe(80);
});

// Visible overflow is the web's: a wrapper around a box that neither scrolls
// nor clips does not shrink below that box's content, however little room
// the column has for it
test('a flex item holding visible overflow stands as tall as the content', () => {
  const wrapper = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{height: 100, display: 'flex', flexDirection: 'column'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={wrapper}
          style={{display: 'flex', flexDirection: 'column', flexShrink: 1}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{flexShrink: 1}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{height: 500}} />
          </div>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{height: 20, flexShrink: 0}} />
      </div>,
    );
  });
  expect(height(wrapper)).toBe(500);
});

function width(ref: {current: HostInstance | null}): number {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return r.width;
}

// In the inline axis a box that clips asks its content's room, as on the web:
// a tab whose label is clipped to an ellipsis stays as wide as its label in a
// row too narrow for it, and the row overflows rather than squeezing the tab
test('a flex item holding a clipped label is as wide as the label', () => {
  const tab = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 100, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={tab}
          style={{display: 'flex', flexDirection: 'row', paddingInline: 5}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{overflow: 'hidden', minWidth: 0}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{width: 120, height: 10}} />
          </div>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 40, height: 10}} />
      </div>,
    );
  });
  expect(width(tab)).toBe(130);
});

// What scrolls asks no room in either axis: a wrapper around a horizontal
// scroll view yields its row to a sibling
test('a flex item holding a horizontal scroll view yields in the inline axis', () => {
  const wrapper = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 100, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={wrapper}
          style={{display: 'flex', flexDirection: 'row', flexShrink: 1}}>
          <ScrollView horizontal={true} style={{flexShrink: 1}}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={{width: 500, height: 10}} />
          </ScrollView>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 40, height: 10, flexShrink: 0}} />
      </div>,
    );
  });
  expect(width(wrapper)).toBe(60);
});
