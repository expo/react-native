/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {PageViewport} from '../src/NativePageScroll';
import type {HostInstance} from 'react-native';

import NativePageScroll from '../src/NativePageScroll';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

function page(automaticInsets: $FlowFixMe = true, options: $FlowFixMe = {}) {
  const scroll = createRef<HostInstance>();
  const content = createRef<HostInstance>();
  const root = Fantom.createRoot({
    viewportWidth: 466,
    viewportHeight: 678,
    safeAreaInsets: {right: 84, bottom: 34},
  });
  Fantom.runTask(() => {
    root.render(
      <NativePageScroll
        ref={scroll}
        automaticInsets={automaticInsets}
        {...options}>
        <View ref={content} style={{height: 100}} />
      </NativePageScroll>,
    );
  });
  return {
    root,
    scroll: () => nullthrows(scroll.current),
    rect: () => nullthrows(content.current).getBoundingClientRect(),
    setLocalInsets: (left: number, right: number, top: number = 0) => {
      const viewport = nullthrows(scroll.current).parentElement;
      Fantom.dispatchNativeEvent(nullthrows(viewport), 'safeAreaInsetsChange', {
        insets: {top, left, bottom: 34, right},
      });
    },
  };
}

describe('a full-size page fits its content between native side insets', () => {
  it('narrows the first layout for a side status bar', () => {
    const test = page();
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(382);
  });

  it('handles different left and right insets when the viewport changes', () => {
    const test = page();
    test.setLocalInsets(73, 11);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(382);
    test.setLocalInsets(0, 84);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(382);
  });

  it('does not reserve the window inset again inside a safe column', () => {
    const test = page();
    test.setLocalInsets(0, 0);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(466);
  });

  it('can deliberately let content extend into the unsafe area', () => {
    const test = page(false);
    test.setLocalInsets(73, 11);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(466);
  });

  it('adds authored padding inside the safe column', () => {
    const test = page(true, {contentContainerStyle: {paddingHorizontal: 16}});
    test.setLocalInsets(73, 11);
    expect(test.rect().x).toBe(16);
    expect(test.rect().width).toBe(350);
  });

  it('adds authored side insets without adding them as padding', () => {
    const test = page(true, {contentInset: {left: 12, right: 8}});
    test.setLocalInsets(73, 11);
    expect(test.scroll().getBoundingClientRect().width).toBe(466);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(362);
  });

  it('declares one document rectangle and its remaining environment', () => {
    const reports: Array<PageViewport> = [];
    const test = page(
      {bottom: false},
      {
        onContentViewportChange: (viewport: PageViewport) =>
          reports.push(viewport),
      },
    );
    test.setLocalInsets(73, 11, 82);
    expect(reports[reports.length - 1]).toEqual({
      x: 73,
      y: 82,
      width: 382,
      height: 596,
      safeAreaInsets: {top: 0, left: 0, right: 0, bottom: 34},
      hostSafeAreaInsets: {top: 82, left: 73, right: 11, bottom: 34},
    });
    test.setLocalInsets(0, 0, 52);
    expect(reports[reports.length - 1]).toEqual({
      x: 0,
      y: 52,
      width: 466,
      height: 626,
      safeAreaInsets: {top: 0, left: 0, right: 0, bottom: 34},
      hostSafeAreaInsets: {top: 52, left: 0, right: 0, bottom: 34},
    });
  });

  it('retains an unreserved edge in the document environment', () => {
    const reports: Array<PageViewport> = [];
    const test = page(
      {left: false, bottom: false},
      {
        onContentViewportChange: (viewport: PageViewport) =>
          reports.push(viewport),
      },
    );
    test.setLocalInsets(73, 11);
    expect(test.rect().x).toBe(0);
    expect(test.rect().width).toBe(455);
    expect(reports[reports.length - 1]).toEqual({
      x: 0,
      y: 0,
      width: 455,
      height: 678,
      safeAreaInsets: {top: 0, left: 73, right: 0, bottom: 34},
      hostSafeAreaInsets: {top: 0, left: 73, right: 11, bottom: 34},
    });
  });
});
