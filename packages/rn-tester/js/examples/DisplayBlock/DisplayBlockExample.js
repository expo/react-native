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

import '@react-native/expo-intrinsics-poc';

// RNTester enables the native Yoga block formatting context
// (enableYogaDisplayBlock via the AppDelegate override), so these cases
// exercise real YGDisplayBlock layout, not the flex emulation. Key rects
// publish to globalThis.__displayVerify for CDP assertions
// (scripts/css-display-cdp-verify.js).

/*
 * The block container's own edge.
 *
 * These cases are about where BOXES end up, so each box is labelled and
 * outlined; otherwise there is no way to tell, on screen, which rectangle a
 * `<View style={{display: 'block'}}>` is.
 *
 * Drawn with `outline` rather than `borderWidth` on purpose. A border between
 * a parent and its first child is exactly what STOPS their margins collapsing
 * (CSS2 §8.3.1) — which is the subject of two of the cases below — so a border
 * added to make the container visible would have quietly changed the result it
 * was added to explain. An outline is painted outside the box and takes part
 * in no layout at all.
 */
const CONTAINER_EDGE = {
  outlineWidth: 1,
  outlineStyle: 'dashed' as 'dashed',
  outlineColor: '#8a8a8e',
};

function MarginSiblingsCase(): React.Node {
  const marginSiblingsRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({marginSiblings: marginSiblingsRef});
  return (
    <View ref={marginSiblingsRef} style={{display: 'block', ...CONTAINER_EDGE}}>
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
    <View ref={escapeOuterRef} style={{display: 'block', ...CONTAINER_EDGE}}>
      <View
        ref={escapeMidRef}
        style={{
          display: 'block',
          backgroundColor: DEMO_THEME.border,
          ...CONTAINER_EDGE,
        }}>
        <View
          style={{height: 10, marginTop: 20, backgroundColor: DEMO_BAR_COLOR}}
        />
      </View>
    </View>
  );
}

function FloatOrderCase(): React.Node {
  const floatContainerRef = useRef<React.ElementRef<typeof View> | null>(null);
  const floatRightRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    floatContainer: floatContainerRef,
    floatRight: floatRightRef,
  });
  return (
    <View
      ref={floatContainerRef}
      style={{display: 'block', width: 100, ...CONTAINER_EDGE}}>
      <View
        style={{
          float: 'left',
          width: 60,
          height: 10,
          backgroundColor: DEMO_BAR_COLOR,
        }}
      />
      <View
        style={{
          float: 'left',
          width: 60,
          height: 30,
          backgroundColor: DEMO_THEME.border,
        }}
      />
      <View
        ref={floatRightRef}
        style={{
          float: 'right',
          width: 30,
          height: 10,
          backgroundColor: DEMO_BOX_COLOR,
        }}
      />
    </View>
  );
}

function ClearanceCase(): React.Node {
  const clearContainerRef = useRef<React.ElementRef<typeof View> | null>(null);
  const clearParentRef = useRef<React.ElementRef<typeof View> | null>(null);
  const clearChildRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    clearContainer: clearContainerRef,
    clearParent: clearParentRef,
    clearChild: clearChildRef,
  });
  return (
    <View
      ref={clearContainerRef}
      style={{display: 'block', width: 100, ...CONTAINER_EDGE}}>
      <View
        style={{
          float: 'left',
          width: 50,
          height: 30,
          backgroundColor: DEMO_THEME.border,
        }}
      />
      <View
        ref={clearParentRef}
        style={{display: 'block', marginTop: 10, ...CONTAINER_EDGE}}>
        <View
          ref={clearChildRef}
          style={{
            clear: 'left',
            marginTop: 20,
            height: 10,
            backgroundColor: DEMO_BAR_COLOR,
          }}
        />
      </View>
      <View style={{height: 5, backgroundColor: DEMO_BAR_COLOR}} />
    </View>
  );
}

function ContiguityCase(): React.Node {
  const contigAbsRef = useRef<React.ElementRef<typeof View> | null>(null);
  const contigControlRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({contigAbs: contigAbsRef, contigControl: contigControlRef});
  return (
    <>
      <View ref={contigAbsRef} style={{display: 'block', ...CONTAINER_EDGE}}>
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
      <View
        ref={contigControlRef}
        style={{display: 'block', ...CONTAINER_EDGE}}>
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
    'YGDisplayBlock, Safari-pinned behavior. Each dashed outline is a block ' +
    "container — the View the code writes as display:'block' — and the solid " +
    'bars inside are its children. The outline is drawn rather than a border ' +
    'because a border would stop the very margin collapsing these show.',
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
          <View style={{display: 'block', ...CONTAINER_EDGE}}>
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
          <View style={{display: 'block', ...CONTAINER_EDGE}}>
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
    {
      title: 'Floats never rise above an earlier float',
      description:
        'The second left float does not fit beside the first and drops below it. The right float then fits beside the first one, but CSS2 §9.5.1 rule 5 keeps a float from sitting higher than an earlier float, so it lines up with the second: 10pt down, as in Chrome.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block', width: 100}}>\n" +
            "  <View style={{float: 'left', width: 60, height: 10}} />\n" +
            "  <View style={{float: 'left', width: 60, height: 30}} />\n" +
            "  <View style={{float: 'right', width: 30, height: 10}} />\n" +
            '</View>  // the right float sits at y=10, not 0'
          }>
          <FloatOrderCase />
        </DemoContent>
      ),
    },
    {
      title: "Clearance keeps a child's margin inside its parent",
      description:
        "A first child that clears a float does not collapse its top margin with its parent's (CSS2 §8.3.1). The parent keeps its own 10pt margin and the child lands at the float's bottom, 30pt down, as in Chrome.",
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block', width: 100}}>\n" +
            "  <View style={{float: 'left', width: 50, height: 30}} />\n" +
            "  <View style={{display: 'block', marginTop: 10}}>\n" +
            "    <View style={{clear: 'left', marginTop: 20, height: 10}} />\n" +
            '  </View>\n' +
            '</View>  // parent at y=10, child at y=30'
          }>
          <ClearanceCase />
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
