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
  DEMO_BAR_COLOR,
  DEMO_BOX_COLOR,
  DEMO_THEME,
  DemoContent,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {useRef} from 'react';
import {View} from 'react-native';

import 'react-native/Libraries/DomElements';

// RNTester enables the native Yoga block formatting context
// (enableYogaDisplayBlock via the AppDelegate override), so these cases
// exercise real YGDisplayBlock layout, not the flex emulation. Key rects
// publish to globalThis.__displayVerify for CDP assertions
// (scripts/css-display-cdp-verify.js).

function MarginSiblingsCase(): React.Node {
  const marginSiblingsRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({marginSiblings: marginSiblingsRef});
  return (
    <View ref={marginSiblingsRef} style={{display: 'block'}}>
      <View
        style={{height: 10, marginBottom: 20, backgroundColor: DEMO_BAR_COLOR}}
      />
      <View
        style={{height: 10, marginTop: 30, backgroundColor: DEMO_BAR_COLOR}}
      />
    </View>
  );
}

function MarginEscapeCase(): React.Node {
  const escapeOuterRef = useRef<React.ElementRef<typeof View> | null>(null);
  const escapeMidRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({escapeOuter: escapeOuterRef, escapeMid: escapeMidRef});
  return (
    <View ref={escapeOuterRef} style={{display: 'block'}}>
      <View
        ref={escapeMidRef}
        style={{display: 'block', backgroundColor: DEMO_THEME.border}}>
        <View
          style={{height: 10, marginTop: 20, backgroundColor: DEMO_BAR_COLOR}}
        />
      </View>
    </View>
  );
}

function ContiguityCase(): React.Node {
  const contigAbsRef = useRef<React.ElementRef<typeof View> | null>(null);
  const contigControlRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({contigAbs: contigAbsRef, contigControl: contigControlRef});
  return (
    <>
      <View ref={contigAbsRef} style={{display: 'block'}}>
        one continuous line <View style={{display: 'none', height: 40}} />
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: DEMO_BOX_COLOR,
          }}
        />
        of text — the hidden and absolute Views leave no gap
      </View>
      <View ref={contigControlRef} style={{display: 'block'}}>
        one continuous line of text — the hidden and absolute Views leave no gap
      </View>
    </>
  );
}

export default {
  title: 'Display: block',
  category: 'UI',
  description:
    "display:'block' (and the intrinsic <div>) as a true CSS block " +
    'formatting context: one inline flow, anonymous block boxes around ' +
    'block-level children, and CSS2 §8.3.1 margin collapsing — native ' +
    'YGDisplayBlock, Safari-pinned behavior.',
  examples: [
    {
      title: 'Block container: one inline flow',
      description:
        'All inline-level children — text runs AND inline elements — join a single wrapping flow (CSS2 §9.2.1.1).',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            '  a<b>b</b>c — one wrapping inline flow\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            a{/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b>b</b>c — one wrapping inline flow
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Contrast: flex containers blockify inline elements',
      description:
        'The same children in a default (flex) View: each run and inline element becomes its own stacked flex item (css-flexbox-1 §4).',
      render: (): React.Node => (
        <DemoContent
          code={'<View>\n  a<b>b</b>c — three stacked items\n</View>'}>
          <View>
            a{/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b>b</b>c — three stacked items
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Mixed content: anonymous block boxes',
      description:
        'Contiguous inline sequences between block-level siblings wrap in anonymous block boxes and stack in order.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            '  a<b>b</b>\n' +
            '  <View style={{height: 8}} />\n' +
            '  c<i>d</i>\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            a{/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b>b</b>
            <View style={{height: 8, backgroundColor: DEMO_BAR_COLOR}} />c
            {/* $FlowExpectedError[not-a-component] intrinsic <i> tag */}
            <i>d</i>
          </View>
        </DemoContent>
      ),
    },
    {
      title: "display:'none' and absolute children never split the flow",
      description:
        'Safari-pinned box-generation rules: a none child generates no box; an absolute child is out-of-flow — the text stays one continuous line (compare with the control below it).',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  one continuous line <View style={{display: 'none'}} />\n" +
            "  <View style={{position: 'absolute', …}} /> of text\n" +
            '</View>'
          }>
          <ContiguityCase />
        </DemoContent>
      ),
    },
    {
      title: 'Sibling margins collapse',
      description:
        'marginBottom 20 + marginTop 30 collapse to one 30pt gap (CSS2 §8.3.1): 10 + 30 + 10 = 50pt total. The flex emulation would give 70pt.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            '  <View style={{height: 10, marginBottom: 20}} />\n' +
            '  <View style={{height: 10, marginTop: 30}} />\n' +
            '</View>  // 10+30+10 = 50pt tall (native block)'
          }>
          <MarginSiblingsCase />
        </DemoContent>
      ),
    },
    {
      title: 'Nested blocks: margins escape (collapse through)',
      description:
        "The inner child's marginTop collapses through the middle block's top edge: the middle block stays 10pt tall and sits 20pt down — the web behavior for nested divs.",
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  <View style={{display: 'block'}}>{/* stays 10pt tall */}\n" +
            '    <View style={{height: 10, marginTop: 20}} />\n' +
            '  </View>\n' +
            '</View>  // outer 30pt; margin moved outside the middle block'
          }>
          <MarginEscapeCase />
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
