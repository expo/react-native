/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import type {RNTesterModule} from '../../types/RNTesterTypes';

import Dialog from '../../astryx/elements/Dialog';
import {resolveAnchorPosition} from '../../astryx/overlay/anchorPosition';
import {useInteractionState} from '../../astryx/useInteractionState';
// $FlowFixMe[cannot-resolve-module]
import {AspectRatio} from '../../astryx/vendor/AspectRatio/AspectRatio';
// A second vendored slice: components whose whole dependency closure is
// already supported, copied from Astryx UNMODIFIED like Card.
// $FlowFixMe[cannot-resolve-module]
import {Badge} from '../../astryx/vendor/Badge/Badge';
// $FlowFixMe[cannot-resolve-module] vendored TypeScript (Metro transforms it)
import {Card} from '../../astryx/vendor/Card/Card';
// $FlowFixMe[cannot-resolve-module]
import {Code} from '../../astryx/vendor/Code/Code';
// $FlowFixMe[cannot-resolve-module]
import {Divider} from '../../astryx/vendor/Divider/Divider';
// $FlowFixMe[cannot-resolve-module]
import {HStack} from '../../astryx/vendor/HStack/HStack';
// $FlowFixMe[cannot-resolve-module]
import {Kbd} from '../../astryx/vendor/Kbd/Kbd';
// $FlowFixMe[cannot-resolve-module]
import {ProgressBar} from '../../astryx/vendor/ProgressBar/ProgressBar';
// $FlowFixMe[cannot-resolve-module]
import {Skeleton} from '../../astryx/vendor/Skeleton/Skeleton';
// $FlowFixMe[cannot-resolve-module]
import {StatusDot} from '../../astryx/vendor/StatusDot/StatusDot';
// $FlowFixMe[cannot-resolve-module]
import {VStack} from '../../astryx/vendor/VStack/VStack';
import {
  DEMO_THEME,
  DemoContent,
  semanticColor,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
// Resolved to js/astryx/stylex-rn.js by the Metro alias — same module the
// vendored sources get, so consumer xstyle overrides use the identical API.
// $FlowFixMe[cannot-resolve-module]
import * as stylex from '@stylexjs/stylex';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {View, useColorScheme, useWindowDimensions} from 'react-native';

// Registers the extra intrinsics Astryx needs (<p>, <button> as div aliases).
import '../../astryx/dom';

// Consumer-side StyleX (the xstyle escape hatch Astryx documents), including
// a token reference and light-dark() — resolved by the RN runtime.
const consumerStyles = stylex.create({
  fancy: {
    borderRadius: 'var(--radius-page)',
    backgroundColor: 'light-dark(#FFF3D6, #4A3A10)',
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: 'var(--color-warning)',
  },
});

// An Astryx-shaped button built the way the design system authors one: styles
// from design tokens with :active/:focus-visible/@media(hover:hover) branches,
// resolved per interaction state. The element is the <button> intrinsic (a
// block container) and the press comes from DOM pointer + click events —
// NO Pressable, NO gesture responder, NO JS gesture recognizer.
const buttonStyles = stylex.create({
  base: {
    // Astryx tokens, resolved by the RN StyleX runtime.
    backgroundColor: 'var(--color-accent)',
    color: 'var(--color-on-accent)',
    borderRadius: 'var(--radius-element)',
    paddingInlineStart: 'var(--spacing-4)',
    paddingInlineEnd: 'var(--spacing-4)',
    paddingBlockStart: 'var(--spacing-2)',
    paddingBlockEnd: 'var(--spacing-2)',
    alignSelf: 'flex-start',
    fontWeight: '600',
    borderWidth: 2,
    borderColor: 'transparent',
    // The declarations Astryx's own Button writes (background-image aside).
    // They pass through the runtime to the renderer, so the :active swap
    // below ANIMATES natively — press and hold to see the fade in, release
    // for the fade back, all off the JS thread.
    transitionProperty: 'background-color, color, opacity, transform',
    transitionDuration: 'var(--duration-fast, 150ms)',
    transitionTimingFunction: 'var(--ease-standard, ease)',
    // Interaction states — the browser's pseudo-classes, resolved from the
    // element's own pointer events.
    ':active': {backgroundColor: 'var(--color-text-blue)'},
    ':focus-visible': {borderColor: 'var(--color-icon-blue)'},
    // Hover is guarded exactly as Astryx guards it; inert on touch.
    '@media (hover: hover)': {
      ':hover': {backgroundColor: 'var(--color-text-accent)'},
    },
  },
  secondary: {
    backgroundColor: 'var(--color-background-muted)',
    color: 'var(--color-text-primary)',
    ':active': {backgroundColor: 'var(--color-overlay-pressed)'},
  },
});

function AstryxButton({
  children,
  onClick,
  secondary,
  buttonRef,
  labelRef,
}: {
  children: React.Node,
  onClick: () => void,
  secondary?: boolean,
  buttonRef?: {current: React.ElementRef<typeof View> | null},
  labelRef?: {current: React.ElementRef<typeof View> | null},
}): React.Node {
  const {state, handlers} = useInteractionState();
  return (
    // $FlowFixMe[not-a-component] <button> intrinsic (block container alias)
    <button
      ref={buttonRef}
      {...handlers}
      onClick={onClick}
      {...stylex.propsWithState(
        state,
        buttonStyles.base,
        secondary === true && buttonStyles.secondary,
      )}>
      {/* A block <div> wrapper so the label box has layout metrics to
          measure (inline elements have none — same as nested <Text> today). */}
      {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
      <div ref={labelRef}>{children}</div>
    </button>
  );
}

function ButtonCase(): React.Node {
  const [count, setCount] = useState(0);
  const buttonRef = useRef<React.ElementRef<typeof View> | null>(null);
  const buttonLabelRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({button: buttonRef, buttonLabel: buttonLabelRef});
  return (
    <View style={{gap: 10}}>
      <AstryxButton
        buttonRef={buttonRef}
        labelRef={buttonLabelRef}
        onClick={() => setCount(c => c + 1)}>
        Press me — no Pressable
      </AstryxButton>
      <AstryxButton secondary onClick={() => setCount(0)}>
        Reset
      </AstryxButton>
      <View
        // $FlowFixMe[incompatible-type] cascade to bare text
        style={{color: DEMO_THEME.muted, fontSize: 13}}>
        clicks: {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{fontVariant: ['tabular-nums']}}>{count}</span> —
        press-and-hold to see the :active token; drag off to cancel, exactly
        like the web.
      </View>
    </View>
  );
}

/**
 * The end-to-end proof: Meta's Astryx <Card> — vendored source, UNMODIFIED —
 * rendering on the fork through the RN StyleX runtime + intrinsic elements
 * (<div>/<p> block containers, bare-text children, inherited text styles).
 * Rects publish to globalThis.__displayVerify: the default card's total
 * content inset must be 16pt — Astryx subtracts the 1px border from the
 * padding via calc(var() - var()) precisely so border + padding equals the
 * 16px padding token — and sized cards must honor width.
 */
// Inline-element geometry on device (T14 platform half): the <b> inside a
// bare-text run publishes its rect, so the CDP check proves iOS is supplying
// per-fragment rects from CoreText rather than leaving them empty.
function InlineMetricsCase(): React.Node {
  const runRef = useRef<React.ElementRef<typeof View> | null>(null);
  const boldRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({inlineRun: runRef, inlineBold: boldRef});
  return (
    <View ref={runRef} style={{display: 'block', alignSelf: 'flex-start'}}>
      {'before '}
      {/* $FlowFixMe[not-a-component] intrinsic <b> tag */}
      <b ref={boldRef}>BOLD</b>
      {' after'}
    </View>
  );
}

function CardCases(): React.Node {
  const cardDefaultRef = useRef<React.ElementRef<typeof View> | null>(null);
  const cardDefaultPRef = useRef<React.ElementRef<typeof View> | null>(null);
  const cardBlueRef = useRef<React.ElementRef<typeof View> | null>(null);
  const cardPad2Ref = useRef<React.ElementRef<typeof View> | null>(null);
  const cardPad2PRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    cardDefault: cardDefaultRef,
    cardDefaultP: cardDefaultPRef,
    cardBlue: cardBlueRef,
    cardPad2: cardPad2Ref,
    cardPad2P: cardPad2PRef,
  });
  // light-dark() resolves at render time; re-render on scheme change.
  useColorScheme();

  return (
    <View style={{gap: 12}}>
      <Card ref={cardDefaultRef}>
        {/* $FlowFixMe[not-a-component] intrinsic <p> tag (Astryx element) */}
        <p ref={cardDefaultPRef}>
          A default Astryx Card: token background, emphasized 1px border, 12px
          radius, and 16px padding inset (border subtracted via calc).
        </p>
        Bare text flows below the paragraph as its own run.
      </Card>

      <Card ref={cardBlueRef} variant="blue" width={300}>
        {/* $FlowFixMe[not-a-component] intrinsic <p> tag */}
        <p>variant="blue" width=300 — tinted token background.</p>
      </Card>

      <Card variant="muted" elevation="med">
        {/* $FlowFixMe[not-a-component] intrinsic <p> tag */}
        <p>variant="muted" elevation="med" — shadow tokens via boxShadow.</p>
      </Card>

      <Card ref={cardPad2Ref} padding={2}>
        {/* $FlowFixMe[not-a-component] intrinsic <p> tag */}
        <p ref={cardPad2PRef}>
          padding=2 — 8px spacing step (total inset stays 8: border +
          calc-reduced padding).
        </p>
      </Card>

      <Card variant="teal" elevation="low" xstyle={consumerStyles.fancy}>
        {/* $FlowFixMe[not-a-component] intrinsic <p> tag */}
        <p>
          xstyle override from the consumer: page radius token, dashed warning
          border, light-dark() background.
        </p>
      </Card>
    </View>
  );
}

// M3: CSS custom-property INHERITANCE across elements — the pattern real
// Astryx components use. `Card` declares --container-padding-inline-start;
// a descendant reads it (Section's negative-margin "escape the parent's
// padding" trick), and a nested element *shadows* it to 0px for its own
// subtree. Nothing here resolves inside a single stylex.props() call: the
// values are finished at each element with its inherited scope, via the
// astryx JSX runtime.
const inheritStyles = stylex.create({
  scopeSetter: {
    '--demo-gutter': '20px',
    paddingInlineStart: 'var(--demo-gutter)',
    paddingInlineEnd: 'var(--demo-gutter)',
    paddingBlockStart: 'var(--spacing-2)',
    paddingBlockEnd: 'var(--spacing-2)',
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-container)',
  },
  // Reads the ancestor's value it cannot know itself, and escapes it —
  // exactly Section's `outer` style.
  escapes: {
    marginInlineStart: 'calc(-1 * var(--demo-gutter, 0px))',
    marginInlineEnd: 'calc(-1 * var(--demo-gutter, 0px))',
    backgroundColor: 'var(--color-background-blue)',
    paddingBlockStart: 'var(--spacing-1)',
    paddingBlockEnd: 'var(--spacing-1)',
    paddingInlineStart: 'var(--demo-gutter)',
  },
  // Shadows the inherited value for its own subtree (Section's `inner`).
  shadows: {
    '--demo-gutter': '0px',
  },
  reader: {
    paddingInlineStart: 'var(--demo-gutter, 99px)',
    backgroundColor: 'var(--color-background-teal)',
  },
});

function InheritanceCase(): React.Node {
  const outerRef = useRef<React.ElementRef<typeof View> | null>(null);
  const escapeRef = useRef<React.ElementRef<typeof View> | null>(null);
  const shadowedRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    inheritOuter: outerRef,
    inheritEscape: escapeRef,
    inheritShadowed: shadowedRef,
  });
  return (
    // $FlowFixMe[not-a-component] intrinsic <div> tag
    <div ref={outerRef} {...stylex.props(inheritStyles.scopeSetter)}>
      {/* $FlowFixMe[not-a-component] intrinsic <p> tag */}
      <p>Ancestor sets --demo-gutter: 20px and pads itself with it.</p>
      {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
      <div ref={escapeRef} {...stylex.props(inheritStyles.escapes)}>
        Descendant reads the INHERITED --demo-gutter to escape that padding
        (negative margins), so this band runs full-bleed.
      </div>
      {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
      <div {...stylex.props(inheritStyles.shadows)}>
        {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
        <div ref={shadowedRef} {...stylex.props(inheritStyles.reader)}>
          A nested element shadowed --demo-gutter to 0px, so this reader gets 0
          padding — not the ancestor 20px, and not its own 99px fallback.
        </div>
      </div>
    </div>
  );
}

// <input> — the web element mapped onto RN's TextInput (js/astryx/elements/
// Input.js), resolved by the Astryx JSX runtime. Astryx's own field
// components render <input> directly, so this is what makes the form family
// reachable. Token styling flows through the same StyleX runtime.
const inputStyles = stylex.create({
  field: {
    borderWidth: 'var(--border-width)',
    borderStyle: 'solid',
    borderColor: 'var(--color-border-emphasized)',
    borderRadius: 'var(--radius-element)',
    paddingInlineStart: 'var(--spacing-3)',
    paddingInlineEnd: 'var(--spacing-3)',
    paddingBlockStart: 'var(--spacing-2)',
    paddingBlockEnd: 'var(--spacing-2)',
    backgroundColor: 'var(--color-background-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 15,
    minHeight: 'var(--size-element-lg)',
  },
});

function InputCase(): React.Node {
  const [text, setText] = useState('');
  const fieldRef = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({inputField: fieldRef});
  return (
    <View style={{gap: 8}}>
      {/* $FlowFixMe[not-a-component] <input> element (mapped to TextInput) */}
      <input
        ref={fieldRef}
        type="email"
        placeholder="you@example.com"
        value={text}
        onChange={(e: {target: {value: string}}) => setText(e.target.value)}
        {...stylex.props(inputStyles.field)}
      />
      {/* $FlowFixMe[not-a-component] <input> element */}
      <input
        type="password"
        placeholder="password (secure entry)"
        {...stylex.props(inputStyles.field)}
      />
      {/* $FlowFixMe[not-a-component] <input> element */}
      <input
        disabled
        placeholder="disabled field"
        {...stylex.props(inputStyles.field)}
      />
      <View
        // $FlowFixMe[incompatible-type] cascade to bare text
        style={{color: DEMO_THEME.muted, fontSize: 13}}>
        value: {text === '' ? '(empty)' : text}
      </View>
    </View>
  );
}

// Overlays: the top layer + CSS anchor positioning, the pair every Astryx
// overlay (Popover, Tooltip, DropdownMenu, Dialog) is built on. The popover
// measures its anchor and resolves a `position-area` with
// `position-try-fallbacks`, flipping when it would leave the viewport; the
// dialog is promoted into the top layer with a backdrop, escaping the
// clipping and stacking of everything around it.
const overlayStyles = stylex.create({
  surface: {
    backgroundColor: 'var(--color-background-popover)',
    borderRadius: 'var(--radius-container)',
    borderWidth: 'var(--border-width)',
    borderStyle: 'solid',
    borderColor: 'var(--color-border-emphasized)',
    paddingInlineStart: 'var(--spacing-4)',
    paddingInlineEnd: 'var(--spacing-4)',
    paddingBlockStart: 'var(--spacing-3)',
    paddingBlockEnd: 'var(--spacing-3)',
    boxShadow: 'var(--shadow-high)',
  },
});

function AnchoredPopover(): React.Node {
  const [open, setOpen] = useState(false);
  const [position, setPosition] =
    useState<?{x: number, y: number, area: string}>(null);
  const anchorRef = useRef<React.ElementRef<typeof View> | null>(null);
  const {height: viewportHeight, width: viewportWidth} = useWindowDimensions();

  const openPopover = () => {
    const node = anchorRef.current;
    // Measure through the DOM box rather than `measureInWindow`. The rect is
    // read synchronously, so opening never depends on a callback firing — the
    // old code called `setOpen` *inside* `measureInWindow`, so any anchor
    // whose callback did not fire left the button doing nothing at all, with
    // no error to go on. An element whose box is not a rectangle also mounts
    // an unsized view on purpose (see `TextShadowNode::getMountedLayoutMetrics`),
    // and `getBoundingClientRect()` reports the real box in that case where a
    // view measurement would report zero.
    // $FlowFixMe[prop-missing] host instances expose the DOM box
    const rect =
      node != null ? (node as $FlowFixMe).getBoundingClientRect() : null;
    const anchor =
      rect != null && rect.width > 0
        ? {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
        : // Last resort: open anchored to the viewport's top-start corner
          // rather than silently not opening.
          {x: 0, y: 0, width: 0, height: 0};
    const resolved = resolveAnchorPosition({
      anchor,
      overlay: {width: 220, height: 92},
      viewport: {width: viewportWidth, height: viewportHeight},
      area: 'block-end span-inline-start',
      fallbacks: ['flip-block'],
      offset: 8,
      inset: 12,
    });
    setPosition({x: resolved.x, y: resolved.y, area: resolved.area});
    setOpen(true);
  };

  return (
    <View>
      <AstryxButton buttonRef={anchorRef} onClick={openPopover}>
        Open popover
      </AstryxButton>
      {open && position != null ? (
        // `Dialog`, not a lowercase `<dialog>`: React resolves lowercase JSX
        // to a host component by name, so the intrinsic spelling never reaches
        // this composite and so never enters the top layer.
        <Dialog
          open
          modal={false}
          onClose={() => setOpen(false)}
          {...stylex.props(overlayStyles.surface)}
          // The surface style has to be merged, not replaced: a bare `style`
          // prop after the spread wins outright, which left the popover
          // unstyled and see-through over the page.
          style={[
            stylex.props(overlayStyles.surface).style,
            {
              position: 'absolute',
              left: position.x,
              top: position.y,
              width: 220,
            },
          ]}>
          Anchored with position-area{'\n'}
          {position.area}
          {'\n'}Tap outside to dismiss.
        </Dialog>
      ) : null}
    </View>
  );
}

function ModalDialog(): React.Node {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <AstryxButton onClick={() => setOpen(true)}>Open modal</AstryxButton>
      {/* The `Dialog` component, NOT a lowercase `<dialog>` intrinsic: React
          resolves lowercase JSX to a host component by name, so `<dialog>`
          fell through to the unknown-element path and never reached
          `useTopLayer` — it painted its surface inline instead of being
          promoted into the top layer, which is why its buttons could not be
          tapped and only the backdrop looked right. */}
      <Dialog
        modal
        open={open}
        {...stylex.props(overlayStyles.surface)}
        // Centred in the viewport, which is what `showModal()` does on the
        // web — `margin: auto` in the UA stylesheet's `dialog:modal` rule. A
        // fixed `top` looked arbitrary, and looked scroll-dependent even
        // though the top layer is viewport-anchored.
        style={[
          stylex.props(overlayStyles.surface).style,
          {
            position: 'absolute',
            left: 24,
            right: 24,
            top: '50%',
            transform: [{translateY: -80}],
          },
        ]}>
        A modal dialog in the top layer, with a backdrop.
        <View style={{marginTop: 12}}>
          <AstryxButton secondary onClick={() => setOpen(false)}>
            Close
          </AstryxButton>
        </View>
      </Dialog>
    </View>
  );
}

/**
 * The second vendored slice, rendered for real. Every component here is
 * byte-identical Astryx source; if any of it misbehaves the fault is ours.
 */
/**
 * color-mix() resolved by the runtime, shown as swatches so the result is
 * checkable by eye as well as by test.
 */
/**
 * `@starting-style` entry animations, riding the renderer's native CSS
 * transitions: first commit renders the block's values, the next drops them.
 * Remounting the subtree replays them, which is the only way to see a
 * first-render animation more than once.
 */
/**
 * `<br>` and `<textarea>`: the last two element gaps.
 */
// One string that exercises all three `white-space` axes at once: a run of
// spaces, a segment break, and a line too long for the container. What each
// value does to it is what tells them apart.
const WHITE_SPACE_SAMPLE =
  'spaced   out\nafter a newline, then a line long enough that it has to wrap somewhere';

const WHITE_SPACE_CASES = [
  // Collapses the spaces and the newline, yet still refuses to wrap — so this
  // is one long line running off the edge. Was treated as plain `normal`.
  {value: 'nowrap', why: 'one line, overflowing'},
  // Keeps the newline but collapses the run of spaces, and wraps. The value a
  // two-value model cannot express at all.
  {value: 'pre-line', why: 'break kept, spaces collapsed'},
  // Keeps everything and still wraps — `pre` without the overflow.
  {value: 'pre-wrap', why: 'all kept, still wraps'},
];

// The tinted surface behind <pre> and the white-space samples. A semantic
// color, so it darkens with the scheme — the hardcoded near-white it replaces
// left dark-mode text (which follows labelColor) illegible on a light box.
const CODE_SURFACE = semanticColor('secondarySystemBackgroundColor', '#f4f4f6');

function ElementGapsCases(): React.Node {
  const [text, setText] = useState('Two lines,\nedited here.');
  return (
    <View style={{gap: 12}}>
      {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
      <div style={{display: 'block'}}>
        {'A forced break splits this run'}
        {/* $FlowFixMe[not-a-component] intrinsic <br> tag */}
        <br />
        {'onto a second line, while a literal'}
        {'\n'}
        {'newline in the source collapses to a space.'}
      </div>
      {/* <pre>: white-space is preserved, so the indentation and the blank
          line below survive exactly as written — and copy that way too. */}
      {/* $FlowFixMe[not-a-component] intrinsic <pre> tag */}
      <pre
        style={{
          backgroundColor: CODE_SURFACE,
          padding: 8,
          borderRadius: 6,
        }}>
        {'function greet(name) {\n    return `hi ${name}`;\n}\n' +
          '// a deliberately long line that would wrap in normal text but must not here'}
      </pre>
      {/* The three `white-space` axes, one case each — the values that a
          two-value model gets wrong. Same string every time, so the only
          thing varying is the property. */}
      {WHITE_SPACE_CASES.map(({value, why}) => (
        <View key={value} style={{gap: 2}}>
          <View
            // $FlowFixMe[incompatible-type] cascade to bare text
            style={{color: DEMO_THEME.muted, fontSize: 12}}>
            {`white-space: ${value} — ${why}`}
          </View>
          {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
          <div
            style={{
              whiteSpace: value,
              backgroundColor: CODE_SURFACE,
              padding: 6,
              borderRadius: 6,
            }}>
            {WHITE_SPACE_SAMPLE}
          </div>
        </View>
      ))}
      {/* $FlowFixMe[not-a-component] intrinsic <textarea> tag */}
      <textarea
        rows={3}
        value={text}
        onChange={(e: $FlowFixMe) => setText(e.target.value)}
        style={{
          borderWidth: 1,
          borderColor: DEMO_THEME.border,
          color: DEMO_THEME.fg,
          borderRadius: 6,
          padding: 8,
        }}
      />
      <View style={{opacity: 0.6}}>{`${text.length} characters`}</View>
    </View>
  );
}

function StartingStyleCases(): React.Node {
  const [generation, setGeneration] = useState(0);
  // Everything lives in the stylex blocks — a literal `style=` attribute after
  // the spread would REPLACE the resolved style, and with `@starting-style`
  // riding native transitions the transition declarations are part of that
  // style. (The old Animated path smuggled the entry values on separate props,
  // which is why the collision never showed before.) Box colors are tokens,
  // light-dark() pairs, so the section rethemes.
  const entry = stylex.create({
    box: {
      // Content-sized, centered by construction. The earlier fixed height
      // plus justifyContent top-aligned the text — correctly: these are
      // block containers, and justify-content is inert in CSS block flow
      // (a browser renders the same markup the same way). The fix is not to
      // force flex behavior but to stop needing vertical centering at all.
      borderRadius: 6,
      paddingInline: 10,
      paddingBlock: 7,
      color: 'var(--color-text-primary)',
      transitionDuration: '600ms',
      transitionTimingFunction: 'ease-out',
    },
    fade: {
      opacity: 1,
      backgroundColor: 'var(--color-background-blue)',
      transitionProperty: 'opacity',
      '@starting-style': {opacity: 0},
    },
    rise: {
      opacity: 1,
      backgroundColor: 'var(--color-background-green)',
      transitionProperty: 'opacity, transform',
      '@starting-style': {opacity: 0, transform: 'translateY(24px)'},
    },
    slide: {
      backgroundColor: 'var(--color-background-orange)',
      transitionProperty: 'transform',
      transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      '@starting-style': {transform: 'translateX(-40px)'},
    },
  });
  return (
    <View style={{gap: 10}}>
      <AstryxButton onClick={() => setGeneration(g => g + 1)}>
        Replay entry animations
      </AstryxButton>
      <View key={generation} style={{gap: 8}}>
        {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
        <div {...stylex.props(entry.box, entry.fade)}>fade in</div>
        {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
        <div {...stylex.props(entry.box, entry.rise)}>rise and fade</div>
        {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
        <div {...stylex.props(entry.box, entry.slide)}>slide from the left</div>
      </View>
    </View>
  );
}

function ColorMixCases(): React.Node {
  const ramp = [0, 25, 50, 75, 100];
  const swatch = {width: 56, height: 40, borderRadius: 6};
  return (
    <View style={{gap: 12}}>
      <View style={{flexDirection: 'row', gap: 6}}>
        {ramp.map(p => (
          <View
            key={`mix-${p}`}
            style={[
              swatch,
              // A ramp between two hex colours: the ends must match the inputs
              // exactly, and the middle must be an even blend.
              stylex.props({
                backgroundColor: `color-mix(in srgb, #2980b9 ${100 - p}%, #e67e22 ${p}%)`,
              }).style,
            ]}
          />
        ))}
      </View>
      <View style={{flexDirection: 'row', gap: 6}}>
        {ramp.map(p => (
          <View
            key={`fade-${p}`}
            style={[
              swatch,
              // Fading toward `transparent`. These must stay RED and only lose
              // alpha — if the mix is not premultiplied they darken toward
              // black instead, which is the bug this guards.
              stylex.props({
                backgroundColor: `color-mix(in srgb, #c0392b ${p}%, transparent)`,
              }).style,
            ]}
          />
        ))}
      </View>
      <View style={{flexDirection: 'row', gap: 6}}>
        {ramp.map(p => (
          <View
            key={`oklab-${p}`}
            style={[
              swatch,
              stylex.props({
                backgroundColor: `color-mix(in oklab, black ${100 - p}%, white ${p}%)`,
              }).style,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function PortedComponents(): React.Node {
  return (
    <VStack gap={3}>
      {/* Badge takes a `label` prop, not children — as does Kbd's `keys`.
          Worth stating because it is the kind of thing a port gets wrong
          silently: rendering children on a component that ignores them
          produces an empty box rather than an error. */}
      <HStack gap={2}>
        <Badge label="neutral" />
        <Badge label="info" variant="info" />
        <Badge label="success" variant="success" />
        <Badge label="error" variant="error" />
      </HStack>
      <Divider />
      <HStack gap={2}>
        <Badge label="blue" variant="blue" />
        <Badge label="teal" variant="teal" />
        <Badge label="purple" variant="purple" />
      </HStack>
      <Divider />
      <HStack gap={2}>
        <Code>npm install</Code>
        <Kbd keys="mod+k" />
      </HStack>
      <Divider variant="strong" />
      <VStack gap={1}>
        <Badge label="stacked" variant="green" />
        <Badge label="vertically" variant="green" />
      </VStack>
      <Divider />
      {/* Skeleton's surface is a color-mix() of two design tokens, so these
          bars render at all only because the runtime resolves it. */}
      <Divider />
      {/* The second batch: components whose whole closure is now portable. */}
      <VStack gap={2}>
        {/* `variant`, not `status` — and Section takes only children. Third
            time a demo of mine has guessed a prop name: these components state
            their API in TypeScript that Metro strips, so a wrong prop renders
            nothing rather than failing. */}
        <HStack gap={2}>
          <StatusDot variant="success" />
          <StatusDot variant="warning" />
          <StatusDot variant="error" />
          <StatusDot variant="accent" />
        </HStack>
        <ProgressBar value={60} />
        <AspectRatio ratio={16 / 9}>
          <View style={{backgroundColor: '#e6f4ea', flex: 1}} />
        </AspectRatio>
      </VStack>
      <Divider />
      <VStack gap={1}>
        <Skeleton width={220} height={12} />
        <Skeleton width={180} height={12} />
        <Skeleton width={120} height={12} />
      </VStack>
    </VStack>
  );
}

// Astryx's selection pattern (ClickableCard / SelectableCard / TabList):
// border-color and background-color transitions declared at the BASE level,
// so any state that changes them animates. The declarations are the vendored
// sources' own — token duration, token easing — passing through the runtime
// to the renderer, which interpolates off the JS thread.
const selectableStyles = stylex.create({
  card: {
    borderWidth: 2,
    // Real Astryx tokens, every one a light-dark() pair — an invented token
    // name silently takes its light-only fallback and turns the card white in
    // dark mode, which is exactly the bug this replaced.
    borderColor: 'var(--color-border-emphasized)',
    backgroundColor: 'var(--color-background-card)',
    color: 'var(--color-text-primary)',
    borderRadius: 'var(--radius-element, 8px)',
    paddingInline: 'var(--spacing-4, 16px)',
    paddingBlock: 'var(--spacing-3, 12px)',
    transitionProperty: 'border-color, background-color, transform',
    transitionDuration: 'var(--duration-fast, 150ms)',

    transitionTimingFunction: 'var(--ease-standard, ease)',
    ':active': {transform: 'scale(0.97)'},
  },
  selected: {
    borderColor: 'var(--color-accent)',
    backgroundColor: 'var(--color-background-blue)',
  },
});

function SelectableCardDemo({
  label,
  selected,
  onSelect,
}: {
  label: string,
  selected: boolean,
  onSelect: () => void,
}): React.Node {
  const {state, handlers} = useInteractionState();
  // The same handlers, with each JS-side event recorded into the trace.
  const traced = {
    onPointerEnter: () => {
      traceLog(`enter ${label}`);
      handlers.onPointerEnter();
    },
    onPointerLeave: () => {
      traceLog(`leave ${label}`);
      handlers.onPointerLeave();
    },
    onPointerDown: () => {
      traceLog(`down ${label}`);
      handlers.onPointerDown();
    },
    onPointerUp: () => {
      traceLog(`up ${label}`);
      handlers.onPointerUp();
    },
    onPointerCancel: () => {
      traceLog(`cancel ${label}`);
      handlers.onPointerCancel();
    },
    onFocus: handlers.onFocus,
    onBlur: handlers.onBlur,
  };
  return (
    // $FlowFixMe[not-a-component] intrinsic <button> tag
    <button
      {...traced}
      onClick={() => {
        traceLog(`click ${label}`);
        onSelect();
      }}
      {...stylex.propsWithState(
        state,
        selectableStyles.card,
        selected && selectableStyles.selected,
      )}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Engine trace, for debugging transitions ON A DEVICE. Drains the renderer's
// ring buffer (a JSI global the scheduler installs), shows the tail on
// screen, and streams every line to a sink so the interleaving can be read
// off the phone in real time. JS-side pointer/click events are logged into
// the same stream: the bug under investigation is about which side stops
// telling the truth, so both sides' stories have to line up in one timeline.
// ---------------------------------------------------------------------------

const TRACE_SINK = 'https://rntrace.tuft.host';
const traceQueue: Array<string> = [];

function traceLog(line: string) {
  traceQueue.push(line);
}

function useEngineTrace(): Array<string> {
  const [tail, setTail] = useState<Array<string>>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const drain: $FlowFixMe = (globalThis as $FlowFixMe)
        .__cssTransitionsTrace;
      const engineLines: Array<string> =
        typeof drain === 'function' ? drain() : [];
      const jsLines = traceQueue.splice(0, traceQueue.length);
      const merged = [
        ...engineLines.map(l => `E ${l}`),
        ...jsLines.map(l => `J ${l}`),
      ];
      if (merged.length === 0) {
        return;
      }
      setTail(prev => [...prev, ...merged].slice(-14));
      fetch(TRACE_SINK, {method: 'POST', body: JSON.stringify(merged)}).catch(
        () => {},
      );
    }, 250);
    return () => clearInterval(id);
  }, []);
  return tail;
}

function NativeTransitionsCases(): React.Node {
  const [selected, setSelected] = useState(0);
  const trace = useEngineTrace();
  // light-dark() resolves at render time; re-render on scheme change.
  useColorScheme();
  return (
    <VStack gap={3}>
      {/* The press fade: the same AstryxButton as the button demo, whose
          :active background swap now animates because its stylex declarations
          include the transition longhands. Press and HOLD. */}
      <AstryxButton onClick={() => {}}>Press and hold me</AstryxButton>
      {/* The selection pattern: tapping re-resolves each card's style in one
          commit; the renderer animates border, fill, and the pressed-scale. */}
      <HStack gap={2}>
        {['One', 'Two', 'Three'].map((label, index) => (
          <SelectableCardDemo
            key={label}
            label={label}
            selected={selected === index}
            onSelect={() => setSelected(index)}
          />
        ))}
      </HStack>
      <View
        // $FlowFixMe[incompatible-type] cascade to bare text
        style={{color: DEMO_THEME.muted, fontSize: 13}}>
        Nothing here calls an animation API. The styles are static states; the
        renderer fills in every frame between them, off the JS thread.
      </View>
      <View
        // $FlowFixMe[incompatible-type] cascade to bare text
        style={{
          color: DEMO_THEME.muted,
          fontSize: 9,
          fontFamily: 'Menlo',
        }}>
        {trace.length === 0 ? 'trace: idle' : trace.join('\n')}
      </View>
    </VStack>
  );
}

export default {
  title: 'Astryx',
  category: 'UI',
  description:
    "Meta's Astryx design system running on the fork: vendored, UNMODIFIED " +
    'Card source rendering through a React Native StyleX runtime ' +
    '(defineVars tokens, var() fallback chains, calc(), light-dark()) and ' +
    'the intrinsic element/text-children machinery (<div>, <p>, bare text).',
  examples: [
    {
      name: 'elementGaps',
      title: '<br> and <textarea>',
      description:
        'A <br> is a forced line break that survives CSS whitespace ' +
        'collapsing — an ordinary newline in the source becomes a space ' +
        '(css-text-3 §3), which is the difference the first block shows. ' +
        '<textarea> is a behavioural element on RN’s multiline TextInput, ' +
        'sized in rows as on the web.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<div>\n' +
            "  {'A forced break splits this run'}<br />\n" +
            "  {'onto a second line, while a literal'}{'\\n'}\n" +
            "  {'newline collapses to a space.'}\n" +
            '</div>\n' +
            '<textarea rows={3} value={text} onChange={…} />'
          }>
          <ElementGapsCases />
        </DemoContent>
      ),
    },
    {
      name: 'nativeTransitions',
      title: 'CSS transitions — native interaction states',
      description:
        'Astryx declares transition-property/duration/timing-function on ' +
        'its interactive components; those longhands now pass through the ' +
        'StyleX runtime to the renderer, which animates state changes off ' +
        'the JS thread. Press-and-hold the button; tap the cards.',
      render: (): React.Node => (
        <DemoContent
          code={
            "transitionProperty: 'background-color, color, opacity, transform',\n" +
            "transitionDuration: 'var(--duration-fast)',\n" +
            "transitionTimingFunction: 'var(--ease-standard)',\n" +
            "':active': {backgroundColor: 'var(--color-text-blue)'}"
          }>
          <NativeTransitionsCases />
        </DemoContent>
      ),
    },
    {
      name: 'startingStyle',
      title: '@starting-style — entry animations',
      description:
        'The values an element renders with on its FIRST commit ' +
        '(css-transitions-2 §3); the renderer\u2019s native CSS transitions ' +
        'then animate to the real values, exactly as a browser does — the ' +
        'block is one frame of style, not an animation API. Press to ' +
        'remount and replay.',
      render: (): React.Node => (
        <DemoContent
          code={
            'opacity: 1,\n' +
            "transitionDuration: '600ms',\n" +
            "transitionTimingFunction: 'ease-out',\n" +
            "'@starting-style': {opacity: 0, transform: 'translateY(24px)'}"
          }>
          <StartingStyleCases />
        </DemoContent>
      ),
    },
    {
      name: 'colorMix',
      title: 'color-mix() — srgb, alpha and oklab',
      description:
        'Top: a ramp between two colours. Middle: the same colour fading to ' +
        'transparent — these must stay red and only lose alpha, because the ' +
        'mix is premultiplied; without that they darken toward black. ' +
        'Bottom: black to white mixed in oklab, whose midpoint sits darker ' +
        'than sRGB’s because sRGB’s gamma overshoots the perceptual middle.',
      render: (): React.Node => (
        <DemoContent
          code={
            "backgroundColor: 'color-mix(in srgb, #2980b9 50%, #e67e22 50%)'\n" +
            "backgroundColor: 'color-mix(in srgb, #c0392b 50%, transparent)'\n" +
            "backgroundColor: 'color-mix(in oklab, black, white)'"
          }>
          <ColorMixCases />
        </DemoContent>
      ),
    },
    {
      name: 'ported',
      title: 'Ported components — a second vendored slice',
      description:
        'Nine more Astryx components whose entire dependency closure is ' +
        'already supported, vendored UNMODIFIED: the Stack layout ' +
        'primitives plus Badge, Code, Kbd, Divider, Center and ' +
        'VisuallyHidden. Static analysis says they should work; this screen ' +
        'is what actually decides it.',
      render: (): React.Node => (
        <DemoContent
          code={
            'import {VStack, HStack, Badge, Code, Kbd, Divider}\n' +
            "  from '@astryxdesign/core'; // vendored, unmodified\n" +
            '\n' +
            '<VStack gap={3}>\n' +
            '  <HStack gap={2}><Badge>new</Badge><Badge>beta</Badge></HStack>\n' +
            '  <Divider />\n' +
            '  <HStack gap={2}><Code>npm i</Code><Kbd>⌘K</Kbd></HStack>\n' +
            '</VStack>'
          }>
          <PortedComponents />
        </DemoContent>
      ),
    },
    {
      title: 'Card — vendored source, end to end',
      description:
        'stylex.create/props resolve at render time to RN styles; <div>/<p> ' +
        'are block containers with text children; toggle the OS appearance ' +
        'to watch light-dark() tokens retheme.',
      render: (): React.Node => (
        <DemoContent
          code={
            "import {Card} from '@astryxdesign/core'; // vendored\n" +
            '\n' +
            '<Card>\n' +
            '  <p>A default Astryx Card…</p>\n' +
            '  Bare text flows below the paragraph.\n' +
            '</Card>\n' +
            '<Card variant="blue" width={300}>…</Card>\n' +
            '<Card variant="muted" elevation="med">…</Card>\n' +
            '<Card padding={2}>…</Card>\n' +
            '<Card variant="teal" xstyle={consumerStyles.fancy}>…</Card>'
          }>
          <CardCases />
        </DemoContent>
      ),
    },
    {
      title: 'Button — DOM click, no Pressable',
      description:
        'The <button> intrinsic with token styles and :active/:focus-visible/' +
        '@media(hover:hover) branches, resolved from the element\u2019s own W3C ' +
        'pointer events via useInteractionState() — no Pressable, gesture ' +
        'responder, or JS gesture recognizer anywhere.',
      render: (): React.Node => (
        <DemoContent
          code={
            'const {state, handlers} = useInteractionState();\n' +
            '\n' +
            '<button\n' +
            '  {...handlers}\n' +
            '  onClick={onClick}\n' +
            '  {...stylex.propsWithState(state, buttonStyles.base)}>\n' +
            '  {children}\n' +
            '</button>\n' +
            '\n' +
            '// buttonStyles.base — Astryx-shaped tokens + pseudo-classes:\n' +
            "//   backgroundColor: 'var(--color-accent)',\n" +
            "//   ':active': {backgroundColor: 'var(--color-text-blue)'},\n" +
            "//   '@media (hover: hover)': {':hover': {…}},"
          }>
          <ButtonCase />
        </DemoContent>
      ),
    },
    {
      title: '<input> — the web element on RN TextInput',
      description:
        "Astryx's field components render <input> directly. The Astryx JSX " +
        'runtime maps it to a component that translates the web vocabulary ' +
        '(value/onChange/disabled/readOnly/type) onto TextInput, so token ' +
        'styling and the surrounding components work unchanged. @expo/ui is ' +
        'the eventual native target; this module is the only place to swap.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<input\n' +
            '  type="email"\n' +
            '  placeholder="you@example.com"\n' +
            '  value={text}\n' +
            '  onChange={e => setText(e.target.value)}\n' +
            '  {...stylex.props(inputStyles.field)}\n' +
            '/>'
          }>
          <InputCase />
        </DemoContent>
      ),
    },
    {
      title: 'Custom-property inheritance across elements',
      description:
        'A CSS custom property set on an ancestor is visible to every ' +
        'descendant and can be shadowed for a subtree — the mechanism ' +
        'Astryx\u2019s Layout/Section/ClickableCard rely on. Resolution ' +
        'happens per element through the astryx JSX runtime, not inside a ' +
        'single stylex.props() call.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<div style={{'--demo-gutter': '20px', padding\u2026}}>\n" +
            '  <p>ancestor</p>\n' +
            "  <div style={{margin: 'calc(-1 * var(--demo-gutter, 0px))'}}>\n" +
            '    escapes the inherited gutter\n' +
            '  </div>\n' +
            "  <div style={{'--demo-gutter': '0px'}}>{/* shadows it */}\n" +
            "    <div style={{padding: 'var(--demo-gutter, 99px)'}}>0, not 20 or 99</div>\n" +
            '  </div>\n' +
            '</div>'
          }>
          <InheritanceCase />
        </DemoContent>
      ),
    },
    {
      name: 'overlays',
      title: 'Overlays — top layer + anchor positioning',
      description:
        'The two things every Astryx overlay needs. The popover measures its ' +
        'anchor and resolves a position-area with try-fallbacks (flipping ' +
        'when it would leave the viewport); the dialog is promoted into a ' +
        'top layer with a backdrop, escaping surrounding clipping and ' +
        'stacking. Tap outside the popover to light-dismiss it.',
      render: (): React.Node => (
        <DemoContent
          code={
            'resolveAnchorPosition({\n' +
            '  anchor, overlay: {width: 220, height: 92}, viewport,\n' +
            "  area: 'block-end span-inline-start',\n" +
            "  fallbacks: ['flip-block'],\n" +
            '  offset: 8, inset: 12,\n' +
            '});\n\n' +
            '// `Dialog`, not `<dialog>`: lowercase JSX resolves to a host\n' +
            '// component by name and never reaches the composite.\n' +
            '<Dialog open modal={false} onClose={…}>…</Dialog>'
          }>
          <View style={{gap: 10}}>
            <AnchoredPopover />
            <ModalDialog />
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'Inline elements report a real box (on device)',
      description:
        'getBoundingClientRect() on an inline <b> returns the box it ' +
        'occupies, from the platform text engine’s per-fragment rects — ' +
        'CoreText on iOS, the deterministic grid headlessly. The rect is ' +
        'published for the CDP check, which asserts the element sits inside ' +
        'its run and is narrower than it.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  {'before '}<b>BOLD</b>{' after'}\n" +
            '</View>\n\n' +
            '// bold.getBoundingClientRect() -> its own box, not empty'
          }>
          <InlineMetricsCase />
        </DemoContent>
      ),
    },
    {
      title: 'Document typography comes from the UA stylesheet',
      description:
        'No styles authored here. <h1>/<h2>/<p> carry the user-agent ' +
        'defaults — bold headings, block margins — and <strong>/<em>/<code> ' +
        'their inline ones, exactly as a browser would before any author ' +
        'CSS. An author style still wins, because the UA sheet is applied at ' +
        'the UA cascade origin (CSS Cascade §6.1).',
      render: (): React.Node => (
        <DemoContent
          code={
            '<h1>Astryx</h1>\n' +
            '<p>\n' +
            '  Meta’s design system, <strong>unmodified</strong> and\n' +
            '  <em>vendored</em>, on <code>react-native</code>.\n' +
            '</p>\n' +
            "<h2 style={{color: '#0a7'}}>Author styles still win</h2>"
          }>
          {/* $FlowExpectedError[not-a-component] intrinsic <h1> tag */}
          <h1>Astryx</h1>
          {/* $FlowExpectedError[not-a-component] intrinsic <p> tag */}
          <p>
            Meta’s design system, {/* $FlowExpectedError[not-a-component] */}
            <strong>unmodified</strong> and{' '}
            {/* $FlowExpectedError[not-a-component] */}
            <em>vendored</em>, on {/* $FlowExpectedError[not-a-component] */}
            <code>react-native</code>.
          </p>
          {/* $FlowExpectedError[not-a-component] intrinsic <h2> tag */}
          <h2 style={{color: '#0a7'}}>Author styles still win</h2>
        </DemoContent>
      ),
    },
    {
      title: 'Lists indent by the UA marker gutter',
      description:
        'A <ul> gets the UA paddingInlineStart and block margins without a ' +
        'line of authored layout, and each <li> renders a bullet. The border ' +
        'is the <ul>’s own box, so the 40pt marker gutter it reserves is ' +
        'visible: markers hang inside that gutter and the text starts after ' +
        'it, which is list-style-position: outside — the CSS initial value. ' +
        'Watch the wrapping item: its continuation lines start at the text ' +
        'edge, hanging past the marker, exactly as on the web. The Lists ' +
        'screen covers the counter styles and the inside variant.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<ul style={{borderWidth: 1, borderColor: '#c33'}}>\n" +
            '  <li>tokens resolve through var() chains</li>\n' +
            '  <li>elements keep their own tagName</li>\n' +
            '  <li>a deliberately long item, so it wraps: …</li>\n' +
            '</ul>'
          }>
          {/* A border so the <ul>'s own box — and the gutter it reserves for
              markers — is visible rather than inferred. */}
          {/* $FlowExpectedError[not-a-component] intrinsic <ul> tag */}
          <ul style={{borderWidth: 1, borderColor: '#c33'}}>
            {/* $FlowExpectedError[not-a-component] */}
            <li>tokens resolve through var() chains</li>
            {/* $FlowExpectedError[not-a-component] */}
            <li>elements keep their own tagName</li>
            {/* $FlowExpectedError[not-a-component] */}
            <li>
              a deliberately long item, so it wraps: the continuation lines
              start at the text edge rather than under the marker, which is the
              hanging indent outside positioning exists to produce
            </li>
          </ul>
        </DemoContent>
      ),
    },
    {
      // Named so it can be deep-linked directly:
      //   rntester://example/AstryxExample/inlineFlex
      name: 'inlineFlex',
      title: 'inline-flex: a flex container that flows in the text',
      description:
        'display:inline-flex is inline-level, so the chip sits in the ' +
        'sentence like a word, but lays its own children out with flex — ' +
        'and it is atomic, so its block-axis padding grows the line box ' +
        'rather than overflowing it, unlike a plain inline box.',
      render: (): React.Node => (
        <DemoContent
          code={
            "<View style={{display: 'block'}}>\n" +
            "  {'status '}\n" +
            "  <span style={{display: 'inline-flex', flexDirection: 'row',\n" +
            "                gap: 4, alignItems: 'center',\n" +
            '                paddingHorizontal: 6, borderRadius: 8,\n' +
            "                backgroundColor: '#e6f4ea'}}>\n" +
            '    <View style={{width: 8, height: 8, borderRadius: 4,\n' +
            "                  backgroundColor: '#0a7'}} />\n" +
            "    {'ready'}\n" +
            '  </span>\n' +
            "  {' — flowing inline'}\n" +
            '</View>'
          }>
          <View style={{display: 'block'}}>
            {'status '}
            {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
            <span
              style={{
                display: 'inline-flex',
                // No `flexDirection` here on purpose: `row` is the CSS initial
                // value and the UA stylesheet now supplies it to intrinsics,
                // so this reads as it would on the web. It used to need
                // spelling out or the dot stacked above the label.
                gap: 4,
                alignItems: 'center',
                paddingHorizontal: 6,
                borderRadius: 8,
                backgroundColor: '#e6f4ea',
              }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#0a7',
                }}
              />
              {'ready'}
            </span>
            {' — flowing inline'}
          </View>
        </DemoContent>
      ),
    },
    {
      title: 'What this exercises',
      render: (): React.Node => (
        <DemoContent>
          <View
            // $FlowFixMe[incompatible-type] inheritable text props cascade
            style={{color: DEMO_THEME.muted, fontSize: 13, display: 'block'}}>
            defineVars token table · var() with nested fallback chains
            (--astryx-card-padding → --spacing-4) · element-local custom
            properties (--_card-radius, --_card-elevation) · calc(16px - 1px)
            border inset · light-dark() per Appearance · shadow token lists →
            native boxShadow · overflow: clip → hidden · logical padding props
            (paddingInlineStart…) · mergeProps/themeProps pass-through.
          </View>
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
