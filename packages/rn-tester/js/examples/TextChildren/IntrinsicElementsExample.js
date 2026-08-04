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
  DEMO_THEME,
  DemoContent,
  tappableAreaStyle,
  usePublishRects,
} from './TextChildrenShared';
import * as React from 'react';
import {useRef, useState} from 'react';
import {Text, View} from 'react-native';

import 'react-native/Libraries/DomElements';
// External-module proof: registers `<native-switch>` mapped to RN's native <Switch>
// with no C++/ShadowNode (see NativeIntrinsics.js).
import '../../NativeIntrinsics';

// The `<native-switch>` intrinsic (registered by the external NativeIntrinsics
// module) resolves to RN's real native <Switch> — a UISwitch on iOS — via a
// pure view-config alias, no C++. Rendered as the raw host component, so it
// takes the native prop names (`value` / `onChange` with `nativeEvent.value`).
function NativeSwitchDemo(): React.Node {
  const [on, setOn] = useState(true);
  return (
    // $FlowExpectedError[not-a-component] hyphenated intrinsic aliased to native <Switch>
    <native-switch
      value={on}
      onChange={(e: {nativeEvent: {value: boolean}}) =>
        setOn(e.nativeEvent.value)
      }
      style={{alignSelf: 'flex-start', margin: 6}}
    />
  );
}

// DOM-like click events (matches the web mirror's <b onclick>): tapping the
// inline <b> fires its onClick AND bubbles to the container's onClick (both
// counters bump); tapping bare text hits only the container. Requires W3C
// pointer events (enabled in the RNTester AppDelegate).
function HitTestCase(): React.Node {
  const [inlineTaps, setInlineTaps] = useState(0);
  const [containerTaps, setContainerTaps] = useState(0);
  const counter = {
    marginTop: 2,
    fontSize: 13,
    color: DEMO_THEME.muted,
    fontVariant: ['tabular-nums'] as ReadonlyArray<'tabular-nums'>,
  };
  return (
    <View>
      {/* $FlowExpectedError[not-a-component] intrinsic <div> tag (block container) */}
      <div
        // $FlowExpectedError[incompatible-type] onClick (W3C pointer/click) + view styles on a div
        onClick={() => setContainerTaps(v => v + 1)}
        style={tappableAreaStyle()}>
        tap the bare text here, or the{' '}
        {/* $FlowExpectedError[not-a-component] intrinsic <b> tag (defaults to bold) */}
        <b onClick={() => setInlineTaps(v => v + 1)} style={{color: '#0a0'}}>
          BOLD WORD
        </b>{' '}
        here.
      </div>
      <View style={{marginTop: 10}}>
        <Text style={counter}>
          {'inline <b> clicks: '}
          {inlineTaps}
        </Text>
        <Text style={counter}>
          {'container <div> clicks: '}
          {containerTaps}
        </Text>
      </View>
    </View>
  );
}

// DOM event + target API: the click event's `target` is the exact node tapped —
// a ReactNativeElement exposing DOM node fields (tagName, textContent) — just
// like the web.
function describeTarget(t: unknown): string {
  if (t == null) {
    return '(null)';
  }
  if (typeof t === 'number') {
    return 'reactTag ' + String(t);
  }
  if (typeof t === 'object') {
    // ReactNativeElement / ReadOnlyText expose DOM node fields.
    // $FlowFixMe[prop-missing]
    const text = t.textContent;
    // $FlowFixMe[prop-missing]
    const name = t.tagName ?? t.nodeName ?? t.constructor?.name;
    // RN prefixes intrinsic tags ("RN:B"); strip it for web-parity (<b>).
    const tag =
      name != null ? String(name).toLowerCase().replace(/^rn:/, '') : null;
    return (
      (tag != null ? '<' + tag + '>' : 'node') +
      (text != null ? ' “' + String(text) + '”' : '')
    );
  }
  return String(t);
}

function TargetCase(): React.Node {
  const [target, setTarget] = useState('(tap something)');
  return (
    <View>
      {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
      <div
        // $FlowExpectedError[incompatible-type] onClick handler + view styles; read event.target
        onClick={(event: {target?: unknown}) =>
          setTarget(describeTarget(event?.target))
        }
        style={tappableAreaStyle()}>
        tap {/* $FlowExpectedError[not-a-component] */}
        <b>alpha</b>, {/* $FlowExpectedError[not-a-component] */}
        <span style={{color: '#06c'}}>beta</span>, or bare text
      </div>
      {/* Printed OUTSIDE the tappable div — otherwise a bare-text tap reads
          back its own output via textContent and compounds on every tap. */}
      <Text style={{marginTop: 10, fontSize: 13, color: DEMO_THEME.muted}}>
        event.target: {target}
      </Text>
    </View>
  );
}

// The inline-axis advance (box-model-scope.md G3) made measurable on device:
// two otherwise identical runs, one whose <span> carries horizontal padding.
// Both blocks shrink to their content, so the width delta is exactly the space
// the padding reserves — nothing else differs. The <b> publishes its own rect,
// which is the platform per-fragment-rect path (T14). Read by
// scripts/android-inline-metrics-verify.js.
const INLINE_BOX_ADVANCE_PADDING = 10;

function InlineBoxAdvanceCase(): React.Node {
  const plainRef = useRef<React.ElementRef<typeof View> | null>(null);
  const axisRef = useRef<React.ElementRef<typeof View> | null>(null);
  const allRef = useRef<React.ElementRef<typeof View> | null>(null);
  const edgesRef = useRef<React.ElementRef<typeof View> | null>(null);
  const boldRef = useRef<React.ElementRef<typeof View> | null>(null);
  const plainSpanRef = useRef<React.ElementRef<typeof View> | null>(null);
  const axisSpanRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    intrinsicPlainRun: plainRef,
    intrinsicAxisRun: axisRef,
    intrinsicAllRun: allRef,
    intrinsicEdgesRun: edgesRef,
    intrinsicBold: boldRef,
    intrinsicPlainSpan: plainSpanRef,
    intrinsicAxisSpan: axisSpanRef,
  });
  const p = INLINE_BOX_ADVANCE_PADDING;
  const block = {display: 'block', alignSelf: 'flex-start'} as const;
  return (
    <View style={{marginTop: 12}}>
      <View ref={plainRef} style={block}>
        before
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span ref={plainSpanRef}>SPAN</span>
        after
      </View>
      <View ref={axisRef} style={block}>
        before
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span ref={axisSpanRef} style={{paddingHorizontal: p}}>SPAN</span>
        after
      </View>
      <View ref={allRef} style={block}>
        before
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{padding: p}}>SPAN</span>
        after
      </View>
      <View ref={edgesRef} style={block}>
        before
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{paddingLeft: p, paddingRight: p}}>SPAN</span>
        after
      </View>
      <View style={block}>
        before
        {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
        <b ref={boldRef}>BOLD</b>
        after
      </View>
    </View>
  );
}

export default {
  title: 'Intrinsic Elements',
  category: 'Basic',
  description:
    'Lowercase intrinsic tags with their web-standard display: the block ' +
    '<div>, the inline text elements <b>/<i>/<span>/<u>, the inline replaced ' +
    '<img>, HTMLUnknownElement fallback, and DOM click/target semantics.',
  examples: [
    {
      title: '<div> with inline elements: one wrapping paragraph',
      description:
        'A <div> is block-outer/block-inner: bare text and inline elements join a single wrapping inline flow, like the web.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<div>\n' +
            '  a <b>bold</b> <i>italic</i>\n' +
            '  <span> span and text flowing inline in one\n' +
            '  wrapping paragraph, </span>\n' +
            '  just like a web div.\n' +
            '</div>'
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            a {/* $FlowExpectedError[not-a-component] */}
            <b>bold</b> {/* $FlowExpectedError[not-a-component] */}
            <i>italic</i>
            {/* $FlowExpectedError[not-a-component] */}
            <span>
              {' '}
              span and text flowing inline in one wrapping paragraph,{' '}
            </span>
            just like a web div.
          </div>
        </DemoContent>
      ),
    },
    {
      title: '<u> — a lazily-registered intrinsic',
      description:
        'Wired via the LAZY on-demand descriptor seam only (no core registry entry).',
      render: (): React.Node => (
        <DemoContent
          code={'<div>\n' + '  plain and <u>underlined</u> text\n' + '</div>'}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            plain and{' '}
            {/* $FlowExpectedError[not-a-component] intrinsic <u> tag (underline) */}
            <u>underlined</u> text
          </div>
        </DemoContent>
      ),
    },
    {
      title: '<native-switch> — external-module intrinsic',
      description:
        "An app module maps a hyphenated intrinsic to RN's native <Switch> via a view-config alias (no C++, no babel changes).",
      render: (): React.Node => (
        <DemoContent
          code={
            '// NativeIntrinsics.js (app module, not RN core):\n' +
            'import Switch from ".../SwitchNativeComponent";\n' +
            'registerIntrinsic("native-switch", Switch);\n\n' +
            '<native-switch value={on} onChange={e => setOn(e.nativeEvent.value)} />'
          }>
          <NativeSwitchDemo />
        </DemoContent>
      ),
    },
    {
      title: 'Inline box decorations (padding, border, outline)',
      description:
        'An inline element carries the CSS box model: inline-axis ' +
        'margin/border/padding add to the advance, block-axis padding paints ' +
        'without changing line height, and a wrapped box draws one fragment ' +
        'per line with only the first/last getting the leading/trailing edge ' +
        '(CSS2 §8.6 slice).',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  before{' '}\n" +
            '  <span style={{paddingHorizontal: 6, paddingVertical: 2,\n' +
            "                borderWidth: 1, borderColor: '#0a7',\n" +
            "                outlineWidth: 1, outlineColor: '#f90',\n" +
            '                outlineOffset: 2}}>\n' +
            '    decorated inline\n' +
            "  </span>{' '}after\n" +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            before{' '}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderWidth: 1,
                borderColor: '#00aa77',
                outlineWidth: 1,
                outlineColor: '#ff9900',
                outlineOffset: 2,
              }}>
              decorated inline
            </span>{' '}
            after.
          </View>
          <InlineBoxAdvanceCase />
          <View style={{display: 'block', marginTop: 12}}>
            wrapped:{' '}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderWidth: 1,
                borderColor: '#0077aa',
                outlineWidth: 1,
                outlineColor: '#ff9900',
                outlineOffset: 2,
              }}>
              this decorated inline box is deliberately long enough that it
              breaks across more than one line, so the leading edge should be
              drawn only on the first fragment and the trailing edge only on the
              last
            </span>{' '}
            done.
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Unknown tags behave like HTMLUnknownElement',
      description:
        'An unregistered lowercase tag renders inline and unstyled; its content joins the flow (nodeName reports the authored tag).',
      render: (): React.Node => (
        <DemoContent code={'<div>\n  a<foo>b</foo>c\n</div>'}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            a{/* $FlowExpectedError[not-a-component] unknown tag */}
            <foo>b</foo>c
          </div>
        </DemoContent>
      ),
    },
    {
      title: 'Inline <img> flows with the caption text',
      description:
        'The lowercase <img> is an inline replaced element: it flows inside the inline formatting context as an attachment, unlike the block-level RN <Image>.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<div>\n' +
            "  <img source={{uri: 'https://reactnative.dev/img/tiny_logo.png'}}\n" +
            '       style={{width: 32, height: 32}} />\n' +
            "  {' a bare-text caption next to an inline image'}\n" +
            '</div>'
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
            <img
              source={{uri: 'https://reactnative.dev/img/tiny_logo.png'}}
              style={{width: 32, height: 32}}
            />
            {' a bare-text caption next to an inline image'}
          </div>
        </DemoContent>
      ),
    },
    {
      title: 'Click events fire and bubble like the DOM',
      description:
        'Tapping the inline <b onClick> fires it AND bubbles to the container; tapping bare text hits only the container (text nodes are not event targets).',
      render: (): React.Node => (
        <DemoContent
          code={
            '<div onClick={() => setContainerTaps(n => n + 1)}>\n' +
            "  tap the bare text here, or the{' '}\n" +
            '  <b onClick={() => setInlineTaps(n => n + 1)}>BOLD WORD</b>\n' +
            '  here.\n' +
            '</div>'
          }>
          <HitTestCase />
        </DemoContent>
      ),
    },
    {
      title: 'event.target is the tapped DOM node',
      description:
        'The click target is a ReactNativeElement with tagName + textContent — the inline element you tapped, or the container for bare text.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<div onClick={e => setTarget(describeTarget(e.target))}>\n' +
            '  tap <b>alpha</b>, <span>beta</span>, or bare text\n' +
            '</div>'
          }>
          <TargetCase />
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
