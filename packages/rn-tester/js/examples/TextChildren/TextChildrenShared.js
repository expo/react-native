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
 * Shared building blocks for the text-children / css-display example screens
 * (String Children, Intrinsic Elements, Display: block, Display: inline —
 * split from the original monolithic IntrinsicsDemo, see
 * text-children-plan.md):
 *
 *  - `DemoContent` — wraps a case's live content, cascading the base text
 *    color/size to bare text like the web mirror's body styles.
 *  - `CodeBlock` — the case's JSX source with lightweight syntax coloring.
 *  - `tappableAreaStyle` — bordered, >=44pt tappable card (HIG).
 *  - `usePublishRects` — publishes measured rects to
 *    `globalThis.__displayVerify` so layout can be asserted from outside over
 *    CDP (scripts/css-display-cdp-verify.js) without screenshots.
 */

import type {ColorValue} from 'react-native';

import * as React from 'react';
import {Platform, PlatformColor, Text, View} from 'react-native';

// iOS exposes UIKit semantic colors via PlatformColor; those names don't
// resolve on Android, so fall back to matching light-theme hex there.
export const semanticColor = (
  iosName: string,
  androidHex: string,
): ColorValue =>
  Platform.select({ios: PlatformColor(iosName), default: androidHex});

// Base font size for demo text (matches the web mirror).
export const BASE_FONT_SIZE = 15;

export type DemoTheme = {
  bg: ColorValue,
  fg: ColorValue,
  border: ColorValue,
  muted: ColorValue,
};

export const DEMO_THEME: DemoTheme = {
  bg: semanticColor('systemBackgroundColor', '#ffffff'),
  fg: semanticColor('labelColor', '#000000'),
  border: semanticColor('separatorColor', '#c6c6c8'),
  muted: semanticColor('secondaryLabelColor', '#8e8e93'),
};

// Accent colors for layout demos (bars/boxes whose sizes carry the meaning).
export const DEMO_BAR_COLOR = '#6ea8fe';
export const DEMO_BOX_COLOR = '#f0a15c';

// Minimal JSX syntax highlighter — no dependency. Tokenizes the source string
// and colors each span with the VS Code "Dark+" default palette on a dark
// editor-style block (fixed dark bg regardless of the app theme, the way a
// code block reads in docs).
const VSCODE = {
  bg: '#34343d',
  fg: '#eaeaea',
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

export function CodeBlock({code}: {code: string}): React.Node {
  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: 8,
        backgroundColor: VSCODE.bg,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}>
      <Text
        style={{
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.8,
          color: '#b0b0b0',
        }}>
        CODE
      </Text>
      <HighlightedCode code={code} />
    </View>
  );
}

/**
 * Wraps a case's live demo content: cascades the base text color/size to bare
 * text (inheritable text props, text-children-plan.md §3.D) and renders the
 * optional JSX source below it.
 */
export function DemoContent({
  children,
  code,
}: {
  children: React.Node,
  code?: string,
}): React.Node {
  return (
    <View>
      <View
        // $FlowExpectedError[incompatible-type] color + fontSize cascade to bare text
        style={{color: DEMO_THEME.fg, fontSize: BASE_FONT_SIZE}}>
        {children}
      </View>
      {code != null ? <CodeBlock code={code} /> : null}
    </View>
  );
}

/**
 * A surface that pins its own background regardless of the app's appearance,
 * for demos whose SUBJECT is unstyled text.
 *
 * React Native gives text with no `color` an opaque black
 * (`RCTAttributedTextUtils.mm`: `?: [UIColor blackColor]`) rather than a
 * semantic label color, so an unstyled `<Text>` does not follow dark mode. The
 * demos that exist to show exactly that cannot theme their way out of it — the
 * text being unstyled is the thing under test — so they pin a light surface
 * instead and stay legible in both appearances. `CodeBlock` does the same in
 * reverse, staying dark the way a code block does in docs.
 *
 * Do NOT use this to paper over a demo that simply forgot to theme itself:
 * `DemoContent` already cascades `DEMO_THEME.fg` onto its content, bare text
 * included.
 */
export function pinnedLightSurface(): {...} {
  return {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8d8dc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  };
}

/**
 * States on-screen what a demo's colors are expected to do, so a reader in
 * dark mode can tell a deliberate choice from a bug.
 */
export function ThemingNote({children}: {children: string}): React.Node {
  return (
    <Text
      style={{
        fontSize: 12,
        lineHeight: 18,
        color: DEMO_THEME.muted,
        marginBottom: 16,
      }}>
      {children}
    </Text>
  );
}

// Shared style for an interactive area: a bordered, tinted card that clearly
// reads as tappable and is >= 44pt in each dimension per Apple's HIG.
export function tappableAreaStyle(): {...} {
  return {
    borderWidth: 1,
    borderColor: DEMO_THEME.border,
    borderRadius: 8,
    backgroundColor: semanticColor('secondarySystemBackgroundColor', '#f2f2f7'),
    padding: 12,
    minHeight: 44,
  };
}

type Rect = {x: number, y: number, w: number, h: number};

/**
 * Publishes the measured window rects of the given refs into
 * `globalThis.__displayVerify` (merged across screens) for external CDP
 * assertions. Publishes after layout settles, and once more in case
 * images/fonts move things late.
 */
export function usePublishRects(refs: {
  [name: string]: {current: React.ElementRef<typeof View> | null},
}): void {
  React.useEffect(() => {
    const publish = () => {
      for (const name of Object.keys(refs)) {
        const node = refs[name].current;
        if (node != null) {
          node.measureInWindow((x, y, w, h) => {
            // $FlowFixMe[prop-missing] ad-hoc global for external CDP reads
            const existing: {[string]: Rect} = globalThis.__displayVerify ?? {};
            existing[name] = {x, y, w, h};
            // $FlowFixMe[prop-missing] ad-hoc global for external CDP reads
            globalThis.__displayVerify = existing;
          });
        }
      }
    };
    const t1 = setTimeout(publish, 500);
    const t2 = setTimeout(publish, 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
