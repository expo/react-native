/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */

/**
 * A flex container sized to fit its content in its main axis (a column whose
 * height its parent's cross axis leaves to it, a row aligned to one side) is as
 * large as its content where that fits the space it is offered (css-sizing-3
 * §5.2, css-flexbox-1 §9.9.1), so its flexible items do not grow into the
 * space; content that does not fit still shrinks to it. Yoga's legacy rule
 * grew the items to the space offered. A container measured at its
 * max-content size with space on offer, as Yoga measures an item whose cross
 * size is a percentage, keeps the space out of its content too, so
 * `justify-content` has none to share out. The rule is Yoga's
 * WebFitContentMainSize feature, on with `enableYogaDisplayBlock`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function sizeOf(ref: {current: HostInstance | null}): string {
  const box = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  return `${box.width}x${box.height}`;
}

function render(element: React.MixedElement): void {
  const root = Fantom.createRoot({viewportWidth: 400, viewportHeight: 800});
  Fantom.runTask(() => {
    root.render(element);
  });
}

describe('a flex container sized by its content', () => {
  it('keeps a flexible item at its content in a column it is centred in', () => {
    // A dialog drawn in the middle of a page's height, its body a flexible
    // item: the dialog had stood as tall as the page
    const column = createRef<HostInstance>();
    const body = createRef<HostInstance>();
    render(
      <View style={{flexDirection: 'row', alignItems: 'center', height: 800}}>
        <View ref={column} style={{width: 300}}>
          <View ref={body} style={{flexGrow: 1, flexShrink: 1}}>
            <View style={{height: 100}} />
          </View>
          <View style={{height: 40}} />
        </View>
      </View>,
    );
    expect(sizeOf(column)).toBe('300x140');
    expect(sizeOf(body)).toBe('300x100');
  });

  it('keeps a flexible item at its content in a row aligned to one side', () => {
    const row = createRef<HostInstance>();
    render(
      <View style={{alignItems: 'flex-start', width: 300}}>
        <View ref={row} style={{flexDirection: 'row'}}>
          <View style={{width: 100, height: 10, flexGrow: 1}} />
        </View>
      </View>,
    );
    expect(sizeOf(row)).toBe('100x10');
  });

  it('keeps a full-width row at its content in a column sized by its content', () => {
    // Astryx's Selector: a Field column around a `width: 100%` trigger whose
    // label and chevron sit at its two ends. Measured against the row it sat
    // in, the trigger spread them over the row, and the Field took all of it.
    for (const justifyContent of ['space-between', 'center', 'flex-end']) {
      const field = createRef<HostInstance>();
      const next = createRef<HostInstance>();
      render(
        <View style={{flexDirection: 'row', alignItems: 'center', width: 300}}>
          <View ref={field}>
            <View style={{width: '100%', flexDirection: 'row', justifyContent}}>
              <View style={{width: 100, height: 10}} />
              <View style={{width: 16, height: 10}} />
            </View>
          </View>
          <View ref={next} style={{width: 50, height: 10}} />
        </View>,
      );
      expect([justifyContent, sizeOf(field)]).toEqual([
        justifyContent,
        '116x10',
      ]);
      expect(
        ensureInstance(next.current, ReactNativeElement).getBoundingClientRect()
          .x,
      ).toBe(116);
    }
  });

  it('shrinks content that does not fit to the space it is offered', () => {
    const row = createRef<HostInstance>();
    const first = createRef<HostInstance>();
    render(
      <View style={{alignItems: 'center', width: 300}}>
        <View ref={row} style={{flexDirection: 'row'}}>
          <View ref={first} style={{width: 200, height: 10, flexShrink: 1}} />
          <View style={{width: 200, height: 10, flexShrink: 1}} />
        </View>
      </View>,
    );
    expect(sizeOf(row)).toBe('300x10');
    expect(sizeOf(first)).toBe('150x10');
  });

  it('grows a flexible item to its own minimum size', () => {
    // A minimum makes the container that tall, and its items share the room
    const column = createRef<HostInstance>();
    const body = createRef<HostInstance>();
    render(
      <View style={{flexDirection: 'row', alignItems: 'center', height: 800}}>
        <View ref={column} style={{width: 300, minHeight: 400}}>
          <View ref={body} style={{flexGrow: 1}}>
            <View style={{height: 100}} />
          </View>
        </View>
      </View>,
    );
    expect(sizeOf(column)).toBe('300x400');
    expect(sizeOf(body)).toBe('300x400');
  });

  it('still fills a height it is given', () => {
    const body = createRef<HostInstance>();
    render(
      <View style={{height: 800}}>
        <View ref={body} style={{flexGrow: 1}}>
          <View style={{height: 100}} />
        </View>
      </View>,
    );
    expect(sizeOf(body)).toBe('400x800');
  });
});
