/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * An absolutely-positioned inline element is out of flow.
 *
 * `position: absolute` blockifies (css-display-3 §2.7) and removes the box
 * from flow entirely (CSS2 §9.7), so it contributes nothing to the line it was
 * written in — no advance, no effect on where the surrounding words sit.
 *
 * The rule was already stated for an element that opted IN to inline layout
 * with `display: 'inline'`, and NOT for one that is inline by user-agent
 * default. A `<span>` therefore took the other path and joined the text run
 * however it was positioned, which is the half that was wrong.
 *
 * The case that found it is the canonical visually-hidden block — `position:
 * absolute` on a 1x1 clipped box, which is how a component says "assistive
 * technology only". Astryx's `VisuallyHidden` renders a `<span>`, so a
 * stepper's screen-reader-only "completed" was laying out in the line as
 * visible words and squeezing the step's label until it wrapped mid-word.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

function widthOf(ref: {current: HostInstance | null}): number {
  const node = ref.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  return node.getBoundingClientRect().width;
}

describe('an absolutely positioned inline element', () => {
  it('does not lengthen the line it was written in', () => {
    const plain = createRef<HostInstance | null>();
    const withHidden = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          {/* The same visible words, once alone and once beside an
              absolutely-positioned span. Out of flow means the second line is
              no longer than the first. */}
          <View ref={plain} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
          </View>
          <View
            ref={withHidden}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
              }}>
              {'completed'}
            </span>
          </View>
        </View>,
      );
    });

    expect(widthOf(withHidden)).toBe(widthOf(plain));
  });

  it('keeps the hidden text in the tree, since that is what it is for', () => {
    // The other half of the rule, and the half that would regress silently.
    // "Contributes nothing to the line" is one step from "is not mounted", and
    // a visually-hidden span that stops being mounted still passes every
    // layout assertion here while destroying the only reason it exists: the
    // text is invisible so that assistive technology, and nothing else, reads
    // it. On a device this shows up as a TalkBack node beside the label.
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          <View style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
              }}>
              {'completed'}
            </span>
          </View>
        </View>,
      );
    });

    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '',
    ).toContain('completed');
  });

  it('still lays out in the line when it is not positioned', () => {
    // The control: without `position: absolute` the same span is ordinary
    // inline content and DOES lengthen the line, so the test above is
    // measuring the positioning rather than the span being ignored.
    const plain = createRef<HostInstance | null>();
    const withSpan = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          <View ref={plain} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
          </View>
          <View
            ref={withSpan}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span>{'completed'}</span>
          </View>
        </View>,
      );
    });

    expect(widthOf(withSpan)).toBeGreaterThan(widthOf(plain));
  });
});
