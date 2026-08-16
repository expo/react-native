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
  BASE_FONT_SIZE,
  DEMO_BAR_COLOR,
  DEMO_THEME,
  DemoContent,
  usePublishRects,
} from './TextChildrenShared';
import * as React from 'react';
import {useRef, useState} from 'react';
import {Text, View} from 'react-native';

// Every JSX shape that yields a bare string child should render as text.
function Greeting(): React.Node {
  return 'string returned by a user component';
}

function NumberComponent(): React.Node {
  return 7;
}

function FragmentComponent(): React.Node {
  return (
    <>
      {'frag '}
      {'pieces'}
    </>
  );
}

function PassThrough({children}: {children: React.Node}): React.Node {
  return <View>{children}</View>;
}

function ToggleStringChild(): React.Node {
  const [on, setOn] = useState(true);
  return (
    <View>
      <View style={{minHeight: 20}}>
        {on ? 'a string child you can toggle' : null}
      </View>
      <Text
        onPress={() => setOn(v => !v)}
        style={{color: '#06c', marginTop: 4}}>
        {on ? 'tap to remove it' : 'tap to add it back'}
      </Text>
    </View>
  );
}

/*
 * css-text-3 §3–4 processing, made measurable on device.
 *
 * Every box shrinks to its content, so WIDTH carries the collapsing signal and
 * HEIGHT carries the segment-break signal. The checks are relative — collapsed
 * against an already-collapsed control, preserved against the same — so they
 * hold under any font, which is the point of running them against the real
 * text engines rather than the deterministic measurer.
 */
function WhitespaceVerifyCase(): React.Node {
  const collapsed = useRef<React.ElementRef<typeof View> | null>(null);
  const control = useRef<React.ElementRef<typeof View> | null>(null);
  const preserved = useRef<React.ElementRef<typeof View> | null>(null);
  const newlineNormal = useRef<React.ElementRef<typeof View> | null>(null);
  const newlinePreLine = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    wsCollapsed: collapsed,
    wsControl: control,
    wsPreserved: preserved,
    wsNewlineNormal: newlineNormal,
    wsNewlinePreLine: newlinePreLine,
  });
  const box = {display: 'block', alignSelf: 'flex-start'} as const;
  return (
    <View>
      {/* Three collapsible spaces; must render as one. */}
      <View ref={collapsed} style={box}>
        {'a   b'}
      </View>
      {/* The already-collapsed control it must equal. */}
      <View ref={control} style={box}>
        {'a b'}
      </View>
      {/* The same source under `pre`: preserved, so strictly wider. */}
      {/* $FlowExpectedError[incompatible-type] whiteSpace is a new style key */}
      <View ref={preserved} style={{...box, whiteSpace: 'pre'}}>
        {'a   b'}
      </View>
      {/* A newline becomes a space under `normal` — one line. */}
      <View ref={newlineNormal} style={box}>
        {'a\nb'}
      </View>
      {/* ...and is preserved under `pre-line` — two lines. */}
      {/* $FlowExpectedError[incompatible-type] whiteSpace is a new style key */}
      <View ref={newlinePreLine} style={{...box, whiteSpace: 'pre-line'}}>
        {'a\nb'}
      </View>
    </View>
  );
}

export default {
  title: 'String Children',
  category: 'Basic',
  description:
    'Bare strings as View children, the DOM/CSS way (enableStringChildren): ' +
    'anonymous text runs at the layout level, CSS white-space collapsing, ' +
    'inheritable text styles, and paint order — with explicit <Text> untouched.',
  examples: [
    {
      title: 'Bare string under a View',
      description: 'Renders as text without an explicit <Text> wrapper.',
      render: (): React.Node => (
        <DemoContent code={'<View>hello from a bare string</View>'}>
          <View>hello from a bare string</View>
        </DemoContent>
      ),
    },
    {
      title: 'Runs split around a block child',
      description:
        'Contiguous text forms anonymous runs; a block-level sibling stacks between them.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<View>\n' +
            '  before\n' +
            "  <View style={{height: 8, backgroundColor: '#6ea8fe'}} />\n" +
            '  after\n' +
            '</View>'
          }>
          <View>
            before
            <View style={{height: 8, backgroundColor: DEMO_BAR_COLOR}} />
            after
          </View>
        </DemoContent>
      ),
    },
    {
      // Published for scripts/whitespace-verify.js: the same assertions the
      // Fantom suites make about css-text-3 processing, but measured through
      // the REAL platform text engine (CoreText / android.text.Layout) rather
      // than the deterministic measurer.
      title: 'Whitespace processing (verified on device)',
      render: (): React.Node => <WhitespaceVerifyCase />,
    },
    {
      title: 'Whitespace collapses (white-space: normal)',
      description:
        'Runs of whitespace collapse to one space across text/element boundaries inside anonymous runs; explicit <Text> keeps RN verbatim whitespace.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  one two three{'   '}\n" +
            '  <b> four </b>\n' +
            '  five\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            one two three{'   '}
            {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b> four </b>
            five
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Newline collapses to one space; emoji renders',
      render: (): React.Node => (
        <DemoContent code={"<View>{'line one\\nline two 🎉'}</View>"}>
          <View>{'line one\nline two 🎉'}</View>
        </DemoContent>
      ),
    },
    {
      title: 'Styling: color + fontSize cascade to bare text',
      description:
        'Inheritable text styles on Views cascade to descendant bare text (element-tree cascade, like CSS inheritance).',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{color: '#c2185b', fontSize: 18}}>\n" +
            '  inherited pink 18pt bare text\n' +
            '</View>'
          }>
          {/* $FlowExpectedError[incompatible-type] inherited color/size */}
          <View style={{color: '#c2185b', fontSize: 18}}>
            inherited pink 18pt bare text
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Explicit <Text> opts OUT of the cascade',
      description:
        'The back-compat exception: authored <Text> keeps its own color; bare text next to it inherits.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{color: '#c2185b'}}>\n" +
            '  <Text>explicit Text keeps its own color</Text>\n' +
            '  bare text goes pink\n' +
            '</View>'
          }>
          {/* $FlowExpectedError[incompatible-type] View color cascades to bare text only */}
          <View style={{color: '#c2185b'}}>
            <Text style={{fontSize: BASE_FONT_SIZE, color: DEMO_THEME.fg}}>
              explicit Text keeps its own color
            </Text>
            bare text goes pink
          </View>
        </DemoContent>
      ),
    },
    {
      title: '<Text> blocks mix with bare runs',
      description:
        'An authored <Text> stays its own block-level paragraph; surrounding bare strings flow as separate runs.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            '  <Text>a Text block (its own paragraph)</Text>\n' +
            '  then bare strings flow as a separate run\n' +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            <Text style={{fontSize: BASE_FONT_SIZE, color: DEMO_THEME.fg}}>
              a Text block (its own paragraph)
            </Text>
            then bare strings flow as a separate run
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Paint order interleaves text with mounted children',
      description:
        'Text authored before an overlapping child paints under it; text after paints over — CSS painting order.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{flexDirection: 'row'}}>\n" +
            '  <View style={{width: 120, height: 24}}>\n' +
            '    UNDER\n' +
            "    <View style={{position: 'absolute', top: 0, left: 0,\n" +
            "                  right: 0, bottom: 0, backgroundColor: '#f88'}} />\n" +
            '  </View>\n' +
            '  <View style={{width: 120, height: 24}}>\n' +
            "    <View style={{position: 'absolute', top: 0, left: 0,\n" +
            "                  right: 0, bottom: 0, backgroundColor: '#8f8'}} />\n" +
            '    <Text>OVER</Text>\n' +
            '  </View>\n' +
            '</View>'
          }>
          <View style={{flexDirection: 'row'}}>
            <View style={{width: 120, height: 24, marginRight: 8}}>
              UNDER
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: '#f88',
                }}
              />
            </View>
            <View style={{width: 120, height: 24}}>
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: '#8f8',
                }}
              />
              <Text style={{color: '#000', fontWeight: '700'}}>OVER</Text>
            </View>
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Sources: numbers, arrays, fragments, components',
      description:
        'Every JSX shape yielding a string child renders as text: {42} and {0}, adjacent strings coalescing, arrays, fragments, and components returning strings/numbers/fragments.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<View>{42} and {0}</View>\n' +
            "<View>{'a'} {'b'} → one run</View>\n" +
            "<View>{['one, ', 'two, ', 'three'].map(s => s)}</View>\n" +
            "<View><>{'text inside a fragment'}</></View>\n" +
            '<View><Greeting /></View>\n' +
            '<View><NumberComponent /></View>\n' +
            '<View><FragmentComponent /></View>\n' +
            '<PassThrough>passed through a wrapper</PassThrough>'
          }>
          <View>
            {42} and {0}
          </View>
          <View>
            {'a'} {'b'} → one run
          </View>
          <View>{['one, ', 'two, ', 'three'].map(s => s)}</View>
          <View>
            <>{'text inside a fragment'}</>
          </View>
          <View>
            <Greeting />
          </View>
          <View>
            <NumberComponent />
          </View>
          <View>
            <FragmentComponent />
          </View>
          <PassThrough>passed through a wrapper</PassThrough>
        </DemoContent>
      ),
    },
    {
      title: 'Falsy guards render nothing',
      description: 'null / false / empty string → empty box, never a crash.',
      render: (): React.Node => (
        <DemoContent code={"<View>\n  {null}\n  {false}\n  {''}\n</View>"}>
          <View>
            {null}
            {false}
            {''}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Toggle a string child on/off',
      description: 'Text-content updates dirty layout and re-measure runs.',
      render: (): React.Node => (
        <DemoContent
          code={
            'const [on, setOn] = useState(true);\n' +
            '<View>{on ? "a string child you can toggle" : null}</View>'
          }>
          <ToggleStringChild />
        </DemoContent>
      ),
    },
    {
      title: 'Selectable text (userSelect)',
      description:
        'Long-press the first block to get the Copy menu; the second opts out. ' +
        'Matches <Text selectable> on this platform.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{userSelect: 'text'}}>long-press to copy me</View>\n" +
            '<View>long-press does nothing here</View>'
          }>
          <View style={{userSelect: 'text', marginBottom: 8}}>
            long-press to copy me
          </View>
          <View style={{marginBottom: 8}}>long-press does nothing here</View>
          <View style={{userSelect: 'text'}}>
            two runs
            <View style={{height: 8, backgroundColor: DEMO_BAR_COLOR}} />
            copy takes both, in reading order
          </View>
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
