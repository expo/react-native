/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import type {RNTesterModule} from '../../types/RNTesterTypes';

import {
  DEMO_BOX_COLOR,
  DemoContent,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {useRef} from 'react';
import {View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

// Key rects publish to globalThis.__displayVerify for CDP assertions
// (scripts/css-display-cdp-verify.js).

const atomicBoxStyle = {
  display: 'inline' as const,
  width: 30,
  height: 40,
  backgroundColor: DEMO_BOX_COLOR,
  borderRadius: 4,
};

function AtomicInlineCase(): React.Node {
  const inlineContainerRef = useRef<React.ElementRef<typeof View> | null>(null);
  const inlineBoxRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    inlineContainer: inlineContainerRef,
    inlineBox: inlineBoxRef,
  });
  return (
    <View ref={inlineContainerRef} style={{display: 'block'}}>
      before <View ref={inlineBoxRef} style={atomicBoxStyle} /> after — the box
      sits between the words like an inline{' '}
      {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
      <b>img</b>
    </View>
  );
}

function FlexContrastCase(): React.Node {
  const flexContrastRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({flexContrast: flexContrastRef});
  return (
    <View ref={flexContrastRef}>
      before <View style={atomicBoxStyle} /> after — three stacked items,
      exactly like the web
    </View>
  );
}

export default {
  title: 'Display: inline',
  category: 'UI',
  description:
    "display:'inline' on Views: atomic inline boxes flowing in a block " +
    "container's text (sized, like a replaced element) and span-like flow " +
    '(un-sized with all-inline contents); blockified into regular flex items ' +
    'in flex containers (css-display-3 §2.7).',
  examples: [
    {
      title: 'Atomic inline box in the text flow',
      description:
        'A sized inline View joins the surrounding run as an atomic inline box (like an inline <img>); the line grows to fit it.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  before <View style={{display: 'inline',\n" +
            '    width: 30, height: 40}} /> after\n' +
            '</View>'
          }>
          <AtomicInlineCase />
        </DemoContent>
      ),
    },
    {
      title: 'Un-sized inline View: contents flow like a <span>',
      description:
        'With auto size and all-inline contents, the contents join the surrounding flow with the inline View’s inheritable text props applied; taps target the inner View.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  a <View style={{display: 'inline', color: 'tomato'}}>\n" +
            '    flowing <b>inline</b> contents\n' +
            '  </View> b\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            a{' '}
            {/* $FlowExpectedError[incompatible-type] inheritable color cascades to the flow */}
            <View style={{display: 'inline', color: 'tomato'}}>
              flowing{' '}
              {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
              <b>inline</b> contents
            </View>{' '}
            b — one wrapping line
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Flow and atomic boxes nest',
      description:
        'An atomic (sized) inline box inside a span-like flow box is placed in the run at its inline offset.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  a <View style={{display: 'inline'}}>\n" +
            "    x <View style={{display: 'inline', width: 30, height: 40}} />\n" +
            '  </View> b\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            a{' '}
            <View style={{display: 'inline'}}>
              x <View style={atomicBoxStyle} />
            </View>{' '}
            b
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Blockified in flex containers (css-display-3 §2.7)',
      description:
        "The same inline View in a default (flex) container computes to a regular flex item — identical to omitting display:'inline'.",
      render: (): React.Node => (
        <DemoContent
          code={
            '<View>{/* flex */}\n' +
            "  before <View style={{display: 'inline', …}} /> after\n" +
            '</View>'
          }>
          <FlexContrastCase />
        </DemoContent>
      ),
    },
    {
      title: "position:'absolute' blockifies (CSS2 §9.7)",
      description:
        'An absolutely-positioned inline View leaves the flow: the text stays one line and the box positions at its insets.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  ab <View style={{display: 'inline',\n" +
            "    position: 'absolute', top: 0, right: 0,\n" +
            '    width: 12, height: 12}} />\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            the text stays one line; the box is positioned at its insets
            <View
              style={{
                display: 'inline',
                position: 'absolute',
                top: 0,
                right: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: DEMO_BOX_COLOR,
              }}
            />
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'A user-agent inline element is taken out of flow too',
      description:
        'The same rule from the other side. `position: absolute` blockifies ' +
        '(css-display-3 §2.7) and removes the box from flow (CSS2 §9.7), so ' +
        'it contributes nothing to the line — and that has to hold for an ' +
        'element that is inline by USER-AGENT default, not only for one that ' +
        'opted in with display:\'inline\'. A <span> took the other code path ' +
        'and stayed in the run however it was positioned, which is how the ' +
        'canonical visually-hidden block — position:absolute on a 1x1 clipped ' +
        'box, the way a component says "assistive technology only" — ended up ' +
        'laying its screen-reader text out as visible words and squeezing the ' +
        'real label until it wrapped. Both lines below must be the same width.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>Cart</View>\n" +
            "<View style={{display: 'block'}}>\n" +
            '  Cart\n' +
            "  <span style={{position: 'absolute', width: 1, height: 1,\n" +
            "                overflow: 'hidden'}}>completed</span>\n" +
            '</View>'
          }>
          <View style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
          </View>
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
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
