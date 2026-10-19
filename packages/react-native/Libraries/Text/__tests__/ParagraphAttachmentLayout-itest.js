/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The type size the measurements are calibrated against; the document default
// is the platform's body size and differs per platform
const FONT_SIZE = 14;

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('paragraph attachment layout', () => {
  it('keeps current DOM children and inline boxes after attachment layout', () => {
    const paragraphRef = createRef<HostInstance>();
    const inlineRef = createRef<HostInstance>();
    const attachmentRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    const render = (width: number) => {
      Fantom.runTask(() => {
        root.render(
          <View style={{width, flexDirection: 'row'}}>
            <Text
              ref={paragraphRef}
              style={{fontSize: FONT_SIZE, flexShrink: 1}}>
              {'aaaa '}
              <Text ref={inlineRef} style={{fontWeight: 'bold'}}>
                bbb
              </Text>
              <View
                ref={attachmentRef}
                collapsable={false}
                style={{width: 32, height: 16}}
              />
              {' cc'}
            </Text>
          </View>,
        );
      });
    };

    render(400);
    const paragraph = ensureInstance(paragraphRef.current, ReactNativeElement);
    const inline = inlineRef.current;
    const attachment = attachmentRef.current;
    const children = paragraph.childNodes;
    const snapshot = rectOf(inlineRef);
    const initialSnapshot = snapshot.toJSON();
    const attachmentWidth = rectOf(attachmentRef).width;
    const wide = rectOf(paragraphRef).width;
    expect(snapshot.width).toBe(36);

    for (const width of [80, 400, 100, 400]) {
      render(width);
      expect(inlineRef.current).toBe(inline);
      expect(attachmentRef.current).toBe(attachment);
      expect(Array.from(children)).toContain(inline);
      expect(Array.from(children)).toContain(attachment);
      expect(rectOf(inlineRef).width).toBe(36);
      expect(rectOf(attachmentRef).width).toBe(attachmentWidth);
      expect(rectOf(paragraphRef).width).toBeLessThanOrEqual(width);
      if (width === 400) {
        expect(rectOf(paragraphRef).width).toBe(wide);
      }
    }
    // CSSOM View returns a snapshot, while childNodes follows the current DOM.
    expect(snapshot.toJSON()).toEqual(initialSnapshot);
  });
});
