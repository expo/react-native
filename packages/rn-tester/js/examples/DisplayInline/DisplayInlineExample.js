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
      name: 'baseline',
      title: 'Baseline alignment of an atomic inline',
      description:
        'An atomic inline box — inline-block, inline-flex, an <img> — is ' +
        'baseline-aligned by default. Its baseline here is its bottom border ' +
        'edge, so that edge should sit ON the text baseline, and the line has ' +
        'to stay tall enough for the text’s descender BELOW it. The text is ' +
        'all x-height characters, so the bottom of the glyphs is the ' +
        'baseline; the box bottom should line up with it exactly.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  {'xxx '}\n" +
            "  <span style={{display: 'inline-block', width: 24, height: 40,\n" +
            "                backgroundColor: '#c33'}} />\n" +
            "  {' xxx'}\n" +
            '</View>'
          }>
          <View style={{gap: 10}}>
            <View style={{display: 'block'}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  width: 24,
                  height: 40,
                  backgroundColor: '#c33',
                }}
              />
              {' xxx'}
            </View>
            {/* With in-flow text the baseline is that text's, not the bottom
                edge (CSS2 §10.8.1): the inner glyphs must sit on the SAME
                baseline as the outer ones. */}
            <View style={{display: 'block'}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  paddingHorizontal: 4,
                  paddingTop: 16,
                  backgroundColor: '#39c',
                }}>
                {'xxx'}
              </span>
              {' xxx'}
            </View>
            {/* A third offset, deliberately unlike the other two: padding
                BELOW the text pushes the box's baseline well above its bottom
                edge. Two probes cannot tell a correct formula from a wrong one
                when one of them has a zero offset — the empty box's baseline IS
                its bottom edge, so every candidate agrees on it. */}
            <View style={{display: 'block'}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  paddingHorizontal: 4,
                  paddingBottom: 24,
                  backgroundColor: '#7a3',
                }}>
                {'xxx'}
              </span>
              {' xxx'}
            </View>
            {/* The case that actually stresses the placement: a box SHORTER
                than the text beside it. In the probes above the box is the
                tallest thing on its line, so its top coincides with the line
                fragment's top and several different formulas would agree by
                accident. Here the text sets the line's ascent instead. */}
            {/* $FlowExpectedError[incompatible-type] `fontSize` on a View is
                honoured at runtime — text attributes cascade to text children —
                but ViewStyle does not model inherited text properties yet.
                DOM-CSS-LIMITATION(view-style-text-inheritance) */}
            <View style={{display: 'block', fontSize: 40}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  backgroundColor: '#93c',
                }}
              />
              {' xxx'}
            </View>
            {/* Both at once: shorter than the line AND a non-zero baseline
                offset. The two cases above each vary only one of those, so
                each still leaves one term of the placement untested. */}
            {/* $FlowExpectedError[incompatible-type] `fontSize` on a View is
                honoured at runtime — text attributes cascade to text children —
                but ViewStyle does not model inherited text properties yet.
                DOM-CSS-LIMITATION(view-style-text-inheritance) */}
            <View style={{display: 'block', fontSize: 40}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  paddingHorizontal: 4,
                  paddingBottom: 6,
                  backgroundColor: '#c39',
                }}>
                {'xxx'}
              </span>
              {' xxx'}
            </View>
            {/* overflow other than `visible` is the rule's second escape hatch
                (CSS2 §10.8.1): the box aligns by its bottom edge whatever its
                content, because a clipped line box is not something you can
                sensibly align a line to. This pink box has the SAME content and
                padding as the one above it, so the only thing that may move it
                is the overflow. Its bottom should sit on the baseline. */}
            <View style={{display: 'block'}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
              <span
                style={{
                  display: 'inline-block',
                  paddingHorizontal: 4,
                  paddingBottom: 24,
                  overflow: 'hidden',
                  backgroundColor: '#f80',
                }}>
                {'xxx'}
              </span>
              {' xxx'}
            </View>
            {/* A replaced element. CSS2 §10.8.1 gives an inline replaced box
                the same treatment as a box with no line boxes: its baseline is
                its bottom margin edge, so the image's bottom should sit on the
                text baseline exactly as the empty red box does. A data URI so
                the probe never depends on the network. */}
            <View style={{display: 'block'}}>
              {'xxx '}
              {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
              <img
                source={{
                  uri:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' +
                    'CAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                }}
                style={{width: 30, height: 30, backgroundColor: '#333'}}
              />
              {' xxx'}
            </View>
          </View>
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
        'real label until it wrapped. Both lines below must be the same width, ' +
        'and the word "completed" must not appear on either — it is there, and ' +
        'invisible, which is the whole point: assistive technology still reads ' +
        'it. TalkBack lists it as its own node beside the two "Cart"s.',
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
