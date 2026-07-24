/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ColorValue} from 'react-native';

import * as React from 'react';
import {useState} from 'react';
import {PlatformColor, ScrollView, Text, View} from 'react-native';

import 'react-native/Libraries/DomElements';

// Canonical demo for the implicit-text feature, organized by CONTAINER × CHILD
// TYPE so the layout model each section isolates is obvious, and matched 1:1 to
// the web mirror (implicit-text-web-mirror.html) for side-by-side comparison:
//
//   §1 <div>  — block container (one inline formatting context)
//        div with strings   — bare text + <b>/<i>/<span>/<img> flow inline
//        div with <Text>     — explicit <Text> blocks inside the flow
//   §2 <View> — flex container (children become flex items)
//        View with strings  — bare text + inline become stacked items
//        View with <Text>    — explicit <Text> as flex items
//
// Styling (inheritance) and events (DOM click + bubbling) live in the section
// whose layout they exercise. Base font size (15) matches the web mirror.

const BASE_FONT_SIZE = 15;

// Application-level theming via the OS's semantic system colors (iOS UIColor
// selectors), so the whole demo follows the system light/dark theme.
type Theme = {
  bg: ColorValue,
  fg: ColorValue,
  border: ColorValue,
  muted: ColorValue,
};
const SYSTEM_THEME: Theme = {
  bg: PlatformColor('systemBackgroundColor'),
  fg: PlatformColor('labelColor'),
  border: PlatformColor('separatorColor'),
  muted: PlatformColor('secondaryLabelColor'),
};
const ThemeContext: React.Context<Theme> = React.createContext(SYSTEM_THEME);

function Section({title, desc}: {title: string, desc: string}): React.Node {
  const theme = React.useContext(ThemeContext);
  return (
    <View style={{marginTop: 22}}>
      <Text style={{fontSize: 15, fontWeight: '700', color: theme.fg}}>
        {title}
      </Text>
      <Text style={{fontSize: 12, color: theme.muted}}>{desc}</Text>
    </View>
  );
}

function SubSection({title}: {title: string}): React.Node {
  const theme = React.useContext(ThemeContext);
  return (
    <Text
      style={{
        fontSize: 13,
        fontWeight: '600',
        color: theme.muted,
        marginTop: 12,
      }}>
      {title}
    </Text>
  );
}

// Minimal JSX syntax highlighter — no dependency. Tokenizes the source string
// and colors each span with the VS Code "Dark+" default palette, rendered on a
// dark editor-style block (fixed dark bg regardless of app light/dark theme, the
// way a code block reads in docs).
const VSCODE = {
  bg: '#34343d', // softer than VS Code's #1e1e1e so it doesn't clash with the light card
  fg: '#eaeaea', // brighter default text for contrast on the lighter bg
  bracket: '#9a9a9a', // < > / punctuation
  tag: '#6cb6ff', // lowercase html-ish tags (div, b, span)
  comp: '#5fd7bf', // Uppercase components (View, Text)
  string: '#e0a075', // '...'
  number: '#bfdba0', // 42, 0
  attr: '#a6dcff', // style=, source=
  brace: '#eaeaea', // { }
};
function HighlightedCode({code}: {code: string}): React.Node {
  // Order matters: strings first (so '<' inside a string isn't seen as a tag).
  const re =
    /('[^']*'|"[^"]*"|`[^`]*`)|(<\/?)([A-Za-z][\w.]*)|(\/?>)|([{}])|(\b\d+(?:\.\d+)?\b)|([a-zA-Z][\w]*=)/g;
  const spans: Array<React.Node> = [];
  let last = 0;
  let key = 0;
  const push = (text: string, color: string) =>
    spans.push(
      <Text key={key++} style={{color}}>
        {text}
      </Text>,
    );
  while (true) {
    const m = re.exec(code);
    if (m == null) {
      break;
    }
    if (m.index > last) {
      push(code.slice(last, m.index), VSCODE.fg);
    }
    if (m[1] != null) {
      push(m[1], VSCODE.string);
    } else if (m[2] != null) {
      push(m[2], VSCODE.bracket);
      push(m[3], /^[A-Z]/.test(m[3]) ? VSCODE.comp : VSCODE.tag);
    } else if (m[4] != null) {
      push(m[4], VSCODE.bracket);
    } else if (m[5] != null) {
      push(m[5], VSCODE.brace);
    } else if (m[6] != null) {
      push(m[6], VSCODE.number);
    } else if (m[7] != null) {
      push(m[7], VSCODE.attr);
    }
    last = re.lastIndex;
  }
  if (last < code.length) {
    push(code.slice(last), VSCODE.fg);
  }
  return (
    <Text
      style={{
        fontFamily: 'Menlo',
        fontSize: 11,
        lineHeight: 17,
        marginTop: 6,
      }}>
      {spans}
    </Text>
  );
}

function Case({
  label,
  code,
  children,
}: {
  label: string,
  code?: string,
  children: React.Node,
}): React.Node {
  const theme = React.useContext(ThemeContext);
  const sectionTag = {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    color: theme.muted,
  };
  return (
    <View
      style={{
        marginVertical: 10,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: PlatformColor('secondarySystemBackgroundColor'),
      }}>
      <Text
        style={{
          fontSize: 11,
          color: theme.muted,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}>
        {label}
      </Text>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.bg,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}>
        <View
          // $FlowExpectedError[incompatible-type] color + fontSize cascade to bare text
          style={{
            color: theme.fg,
            fontSize: BASE_FONT_SIZE,
          }}>
          {children}
        </View>
      </View>
      {code != null ? (
        <View
          style={{
            borderTopWidth: 1,
            borderColor: theme.border,
            backgroundColor: VSCODE.bg,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}>
          <Text style={[sectionTag, {color: '#b0b0b0'}]}>code</Text>
          <HighlightedCode code={code} />
        </View>
      ) : null}
    </View>
  );
}

// Shared style for an interactive area: a bordered, tinted card that clearly
// reads as tappable and is >= 44pt in each dimension per Apple's HIG.
function tappableAreaStyle(theme: Theme): {...} {
  return {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    backgroundColor: PlatformColor('secondarySystemBackgroundColor'),
    padding: 12,
    minHeight: 44,
  };
}

// DOM-like click events (matches the web mirror's <b onclick>): tapping the
// inline <b> fires its onClick AND bubbles to the container's onClick (both
// counters bump); tapping bare text hits only the container. Requires W3C
// pointer events (enabled in the RNTester AppDelegate).
function HitTestCase(): React.Node {
  const theme = React.useContext(ThemeContext);
  const [inlineTaps, setInlineTaps] = useState(0);
  const [containerTaps, setContainerTaps] = useState(0);
  const counter = {
    marginTop: 2,
    fontSize: 13,
    color: theme.muted,
    fontVariant: ['tabular-nums'] as ReadonlyArray<'tabular-nums'>,
  };
  return (
    <View>
      {/* The tappable area is its own bordered, tinted card so it's obvious what
          you can tap, distinct from the read-out below, and >=44pt tall (HIG). */}
      {/* $FlowExpectedError[not-a-component] intrinsic <div> tag (block container) */}
      <div
        // $FlowExpectedError[incompatible-type] onClick (W3C pointer/click) + view styles on a div
        onClick={() => setContainerTaps(v => v + 1)}
        style={tappableAreaStyle(theme)}>
        tap the bare text here, or the{' '}
        {/* $FlowExpectedError[not-a-component] intrinsic <b> tag (defaults to bold) */}
        <b onClick={() => setInlineTaps(v => v + 1)} style={{color: '#0a0'}}>
          BOLD WORD
        </b>{' '}
        here.
      </div>
      {/* Read-only counters, separated from the tap target above and worded in
          parallel (element › event › count); tabular-nums so they don't reflow. */}
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
// like the web. Tapping the inline <b>/<span> reports that element; tapping bare
// text reports the container. (The web mirror uses container.addEventListener,
// but ReactNativeElement.addEventListener is gated behind enableImperativeEvents
// /enableNativeEventTargetEventDispatching, which need React 19.3.0; until then
// onClick's event.target is the equivalent working path.)
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
  const theme = React.useContext(ThemeContext);
  const [target, setTarget] = useState('(tap something)');
  return (
    <View>
      {/* Same bordered, >=44pt tappable card as the case above, distinct from the
          read-out below. */}
      {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
      <div
        // $FlowExpectedError[incompatible-type] onClick handler + view styles; read event.target (the tapped inline node, or the div for bare text)
        onClick={(event: {target?: unknown}) =>
          setTarget(describeTarget(event?.target))
        }
        style={tappableAreaStyle(theme)}>
        tap {/* $FlowExpectedError[not-a-component] */}
        <b>alpha</b>, {/* $FlowExpectedError[not-a-component] */}
        <span style={{color: '#06c'}}>beta</span>, or bare text
      </div>
      {/* Printed on its own line, OUTSIDE the tappable div — otherwise a bare-text
          tap resolves event.target to the div and reads back its whole textContent
          (including this output), which would compound on every tap. */}
      <Text style={{marginTop: 10, fontSize: 13, color: theme.muted}}>
        event.target: {target}
      </Text>
    </View>
  );
}

function Greeting(): React.Node {
  return 'string returned by a user component';
}

// More string-child sources — every shape below should render as text.
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

export default function ImplicitTextDemo(): React.Node {
  const theme = SYSTEM_THEME;
  return (
    <ThemeContext.Provider value={theme}>
      {/* No <SafeAreaView>: its inset needs a native→JS round-trip, so on launch
          the first frame renders under the status bar and then jumps down once
          the inset arrives. A full-screen ScrollView with
          contentInsetAdjustmentBehavior="automatic" insets the content for the
          safe area in the native layout pass instead — no launch relayout. */}
      <ScrollView
        style={{flex: 1, backgroundColor: theme.bg, paddingHorizontal: 12}}
        contentContainerStyle={{paddingTop: 12, paddingBottom: 48}}
        contentInsetAdjustmentBehavior="automatic">
        <Text style={{fontWeight: '700', fontSize: 17, color: theme.fg}}>
          Implicit text demo
        </Text>
        <Text style={{fontSize: 12, color: theme.muted}}>
          Grouped by container × child type; mirrors the web page. RN
          &lt;View&gt; ≈ flex &lt;div&gt;, block/&lt;div&gt; ≈ display:block,
          &lt;Text&gt; ≈ &lt;p&gt;, inline ≈ &lt;b&gt;/&lt;i&gt;/&lt;span&gt;.
        </Text>

        {/* ============ §1 <div> — block container ============ */}
        <Section
          title="<div> — block container"
          desc="one inline formatting context; children flow inline / stack as blocks"
        />

        <SubSection title="div with strings — bare text + inline elements flow inline" />

        <Case
          label="a <b>bold</b> <i>italic</i> <span>span</span>… → one wrapping paragraph"
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
        </Case>

        <Case
          label="inline <img> flows with the caption text"
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
        </Case>

        <Case
          label="whitespace collapses across text/element boundaries (white-space: normal)"
          code={
            '<div>\n' +
            "  one two three{'   '}\n" +
            '  <b> four </b>\n' +
            '  five\n' +
            '</div>'
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            one two three{'   '}
            {/* $FlowExpectedError[not-a-component] */}
            <b> four </b>
            five
          </div>
        </Case>

        <Case
          label="styling: color + font-size cascade to the bare text (inheritance)"
          code={
            "<div style={{color: '#c2185b', fontSize: 18}}>\n" +
            '  inherited pink 18pt bare text\n' +
            '</div>'
          }>
          {/* $FlowExpectedError[incompatible-type] intrinsic <div> + inherited color/size */}
          <div style={{color: '#c2185b', fontSize: 18}}>
            inherited pink 18pt bare text
          </div>
        </Case>

        <Case
          label="events: tapping inline <b onClick> fires + bubbles; bare text hits only the div"
          code={
            '<div onClick={() => setContainerTaps(n => n + 1)}>\n' +
            "  tap the bare text here, or the{' '}\n" +
            '  <b onClick={() => setInlineTaps(n => n + 1)}>BOLD WORD</b>\n' +
            '  here.\n' +
            '</div>'
          }>
          <HitTestCase />
        </Case>

        <Case
          label="DOM target API: event.target is the tapped node (ReactNativeElement) with tagName + textContent"
          code={
            '<div onClick={e => setTarget(describeTarget(e.target))}>\n' +
            '  tap <b>alpha</b>, <span>beta</span>, or bare text\n' +
            '</div>'
          }>
          <TargetCase />
        </Case>

        <Case
          label="paint order: text before a box paints under (hidden); text after paints over (visible)"
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
        </Case>

        <SubSection title="div with <Text> — explicit text blocks inside the flow" />

        <Case
          label="two <Text> blocks stack (each is block-level)"
          code={
            '<div>\n' +
            '  <Text>first Text block</Text>\n' +
            '  <Text>second Text block</Text>\n' +
            '</div>'
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              first Text block
            </Text>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              second Text block
            </Text>
          </div>
        </Case>

        <Case
          label="a <Text> block, then bare strings continue as their own run below"
          code={
            '<div>\n' +
            '  <Text>a Text block (its own paragraph)</Text>\n' +
            '  then bare strings flow as a separate run\n' +
            '</div>'
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              a Text block (its own paragraph)
            </Text>
            then bare strings flow as a separate run
          </div>
        </Case>

        {/* ============ §2 <View> — flex container ============ */}
        <Section
          title="<View> — flex container"
          desc="children become flex items (align-items: stretch)"
        />

        <SubSection title="View with strings — bare text + inline become stacked items" />

        <Case
          label="bare string under a View sizes like text"
          code={'<View>hello from a bare string</View>'}>
          <View>hello from a bare string</View>
        </Case>

        <Case
          label="a<b>b</b>c → three STACKED items (flex blockifies each run) — contrast with the div above"
          code={'<View>\n  a<b>b</b>c\n</View>'}>
          <View>
            a{/* $FlowExpectedError[not-a-component] */}
            <b>b</b>c
          </View>
        </Case>

        <Case
          label="runs split around a block child (before / block / after)"
          code={
            '<View>\n' +
            '  before\n' +
            "  <View style={{height: 8, backgroundColor: '#6ea8fe'}} />\n" +
            '  after\n' +
            '</View>'
          }>
          <View>
            before
            <View style={{height: 8, backgroundColor: '#6ea8fe'}} />
            after
          </View>
        </Case>

        <Case
          label="component-produced string"
          code={
            "const Greeting = () => 'string returned by a user component';\n<View>\n  <Greeting />\n</View>"
          }>
          <View>
            <Greeting />
          </View>
        </Case>

        <Case
          label="styling: color + font-size cascade from the View to bare text"
          code={
            "<View style={{color: '#c2185b', fontSize: 18}}>\n" +
            '  inherited pink 18pt bare text\n' +
            '</View>'
          }>
          {/* $FlowExpectedError[incompatible-type] inherited color/size */}
          <View style={{color: '#c2185b', fontSize: 18}}>
            inherited pink 18pt bare text
          </View>
        </Case>

        <SubSection title="View with <Text> — explicit text as flex items" />

        <Case
          label="two <Text> flex items stack"
          code={
            '<View>\n' +
            '  <Text>first Text item</Text>\n' +
            '  <Text>second Text item</Text>\n' +
            '</View>'
          }>
          <View>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              first Text item
            </Text>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              second Text item
            </Text>
          </View>
        </Case>

        <Case
          label="explicit <Text> next to bare text — RN <Text> opts OUT of the View color cascade (keeps its own color), bare text inherits"
          code={
            "<View style={{color: '#c2185b'}}>\n" +
            '  <Text>explicit Text keeps its own color</Text>\n' +
            '  bare text goes pink\n' +
            '</View>'
          }>
          {/* $FlowExpectedError[incompatible-type] View color cascades to bare text only */}
          <View style={{color: '#c2185b'}}>
            <Text style={{fontSize: BASE_FONT_SIZE, color: theme.fg}}>
              explicit Text keeps its own color
            </Text>
            bare text goes pink
          </View>
        </Case>

        <Section
          title="string children — sources & edge cases"
          desc="Every JSX shape that yields a bare string child of a <View> should render as text (or nothing, for falsy)."
        />
        <SubSection title="how the string arises" />

        <Case
          label="number children — 42 and 0 both render"
          code={'<View>\n  {42} and {0}\n</View>'}>
          <View>
            {42} and {0}
          </View>
        </Case>

        <Case
          label="adjacent strings coalesce into one run"
          code={"<View>\n  {'a'} {'b'} → one run\n</View>"}>
          <View>
            {'a'} {'b'} → one run
          </View>
        </Case>

        <Case
          label="array / .map() of strings"
          code={"<View>{['one, ', 'two, ', 'three'].map(s => s)}</View>"}>
          <View>{['one, ', 'two, ', 'three'].map(s => s)}</View>
        </Case>

        <SubSection title="transparent wrappers" />

        <Case
          label="React fragment child"
          code={"<View>\n  <>{'text inside a fragment'}</>\n</View>"}>
          <View>
            <>{'text inside a fragment'}</>
          </View>
        </Case>

        <Case
          label="component returns a string"
          code={
            "const Greeting = () => 'string returned by a user component';\n<View>\n  <Greeting />\n</View>"
          }>
          <View>
            <Greeting />
          </View>
        </Case>

        <Case
          label="component returns a number"
          code={
            'const NumberComponent = () => 7;\n<View>\n  <NumberComponent />\n</View>'
          }>
          <View>
            <NumberComponent />
          </View>
        </Case>

        <Case
          label="component returns a fragment of strings"
          code={
            "const FragmentComponent = () => <>{'frag '}{'pieces'}</>;\n<View>\n  <FragmentComponent />\n</View>"
          }>
          <View>
            <FragmentComponent />
          </View>
        </Case>

        <Case
          label="children passed through a wrapper component"
          code={
            'const PassThrough = ({children}) => <View>{children}</View>;\n<PassThrough>passed through a wrapper</PassThrough>'
          }>
          <PassThrough>passed through a wrapper</PassThrough>
        </Case>

        <SubSection title="falsy guards — render nothing, never crash" />

        <Case
          label="null / false / empty-string children → empty box"
          code={"<View>\n  {null}\n  {false}\n  {''}\n</View>"}>
          <View>
            {null}
            {false}
            {''}
          </View>
        </Case>

        <SubSection title="content + dynamics" />

        <Case
          label="newline collapses to one space (white-space:normal), not a line break; emoji renders"
          code={"<View>{'line one\\nline two 🎉'}</View>"}>
          <View>{'line one\nline two 🎉'}</View>
        </Case>

        <Case
          label="toggle a string child on/off"
          code={
            'const [on, setOn] = useState(true);\n' +
            '<View>{on ? "a string child you can toggle" : null}</View>'
          }>
          <ToggleStringChild />
        </Case>
      </ScrollView>
    </ThemeContext.Provider>
  );
}
