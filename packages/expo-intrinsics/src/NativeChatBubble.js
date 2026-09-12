/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {
  CHAT_BUBBLE_TAIL_DROP,
  CHAT_BUBBLE_TAIL_INK_MS,
  CHAT_BUBBLE_TAIL_MORPH,
} from './chatBubbleMetrics';
import {splitMenu} from './menuChildren';
import * as React from 'react';
import {Animated, Platform} from 'react-native';

/*
 * The tail's numbers live in a leaf module so a plain test can read them
 * without a renderer behind them, and are re-exported here because this is
 * where callers look for them. See `chatBubbleMetrics`.
 */
export {
  CHAT_BUBBLE_TAIL_DROP,
  CHAT_BUBBLE_TAIL_INK_MS,
  CHAT_BUBBLE_TAIL_MORPH,
  CHAT_BUBBLE_TAIL_MORPH_CURVE,
} from './chatBubbleMetrics';

/**
 * The corner radius at the default text size, mirroring `kExpoChatBubbleRadius`.
 *
 * Not a constant Apple has: the platform derives it as half the height of a
 * ONE-LINE balloon in the balloon font — so the smallest balloon is exactly a
 * capsule and every taller one shares its corner. Twenty is what that produces
 * for seventeen-point text with ten points of padding above and below. A caller
 * whose text differs should pass `(lineHeight + 2 * verticalPadding) / 2`.
 */
export const CHAT_BUBBLE_RADIUS: number = 20;

/**
 * Whether a tail is DRAWN here.
 *
 * Android's surface is a plain rounded box
 * (DOM-CSS-LIMITATION(android-chat-bubble-has-no-tail)), so a tail there costs
 * height and shows nothing: the strip under the text stays empty, the balloon
 * reads bottom-heavy, and whatever is placed against its bottom edge — the
 * receipt below it, the avatar beside it — sits a tail's drop below the shape it
 * belongs to. Space is reserved for a tail only where one is drawn.
 */
export const CHAT_BUBBLE_DRAWS_TAIL: boolean = Platform.OS === 'ios';

/**
 * `<native:chatbubble>` — a chat balloon.
 *
 * A tail is not decoration painted on a box. It is part of the box's geometry,
 * and this component exists so that ONE thing knows that: a balloon with a tail
 * is `CHAT_BUBBLE_TAIL_DROP` points TALLER than one without, its content stops
 * that much short of the bottom, and NOTHING about it changes horizontally.
 *
 * That is not a hypothetical. While the tail was an attribute on an ordinary box
 * the app paid for it by hand, with `paddingRight`, and every balloon with a
 * tail came out five points wider than one without — which pushed its text five
 * points along, so the same word sat in a different place depending on whether
 * the message happened to end a run. Apple's two balloons have the same left and
 * right edges to a third of a point and their text starts in exactly the same
 * place.
 *
 * **It renders two boxes, and the split matters.** The outer one lays out the
 * text and takes the reserve. The inner one is the SURFACE: absolutely
 * positioned behind the text, carrying the shape, and — because it lays nothing
 * out — safe to animate. Animating the box instead reflows what is inside it: a
 * spring that undershoots turned a four-character message into a
 * one-character-per-line sliver for a fifth of a second. The native chat has no
 * such problem because its balloon is a mask behind a label that never moves, and
 * this is the same arrangement.
 *
 * DOM-CSS-LIMITATION(android-chat-bubble-has-no-tail): on Android the surface is
 * a plain box with a corner radius and no tail. The outline is a mask over
 * whatever the caller drew behind it — a colour, a gradient, an image — so the
 * Android side needs the same masking seam; until then a balloon there is a
 * rounded rectangle, and a tail costs it nothing: the reserve follows the drawn
 * shape (`CHAT_BUBBLE_DRAWS_TAIL`), so a balloon is exactly as tall as what it
 * draws on either platform.
 *
 * @param tail `'leading'`, `'trailing'`, or omitted for none. Sides rather than
 *   left and right because a balloon's tail is on the side its message came
 *   from, which in a right-to-left layout is the other side of the screen; the
 *   view resolves it against the layout direction.
 * @param radius the corner radius. Clamped by the renderer to half the BODY's
 *   shorter side, so a short balloon is a capsule — which is what the native
 *   chat's one-word balloons are.
 * @param style the BOX's style: its padding, its maximum width, its background
 *   if it has none of its own.
 * @param surfaceStyle the SURFACE's style: the balloon's colour or gradient.
 *   Given separately because these are two different boxes and a caller styling
 *   the balloon must be able to say which one it means.
 * @param surfaceWidth an explicit width for the surface, or omitted for the
 *   box's. The surface is pinned to the TRAILING edge, so a narrower one grows
 *   leftwards into the empty half of the row rather than pushing anything —
 *   which is what a send animation wants, and it is the only thing that should
 *   ever set this.
 * @param children the balloon's contents. Not clipped by the shape — a reaction
 *   badge overlaps the corner from outside, and a mask on the box would cut it
 *   in half.
 */
const NativeChatBubble: $FlowFixMe = React.forwardRef(function NativeChatBubble(
  {
    tail,
    radius = CHAT_BUBBLE_RADIUS,
    style,
    surfaceStyle,
    surfaceWidth,
    wantsContextMenu,
    onCommand,
    children,
    ...rest
  }: $FlowFixMe,
  // Forwarded to the BOX, which is the thing a caller measures and the thing
  // that receives touches. A plain function component drops a ref silently, and
  // the caller's `measure()` then reads null — which is how the reaction picker
  // lost its anchor and opened in the wrong place.
  ref: $FlowFixMe,
): React.Node {
  const tailed = CHAT_BUBBLE_DRAWS_TAIL && tail != null && tail !== '';
  /*
   * A `<menu>` child is the balloon's PEEK menu, not its content.
   *
   * Same helper `<button>` uses and the same reason: HTML's list of commands is
   * data, the platform draws it, and anything left in the tree would lay out as
   * a list inside the balloon. What differs is only who opens it — a button on a
   * tap, a box on the hold `wantsContextMenu` asks the platform for.
   */
  const {content, commands} = splitMenu(children);
  /*
   * The peek's two props go on the BOX, which is where they belong: the box
   * receives the touch, and the lift has to carry the words rather than the
   * surface alone. The SHAPE comes back the other way — the surface hands its
   * outline up to the box natively, so the balloon is lifted with its tail.
   */
  const menuCommands =
    commands.length > 0
      ? commands.map(({onClick: _drop, ...command}) => command)
      : undefined;

  return (
    // $FlowFixMe[not-a-component] a registered host element is a string tag
    <div
      {...rest}
      wantsContextMenu={wantsContextMenu}
      menuCommands={menuCommands}
      onCommand={onCommand}
      ref={ref}
      style={[
        style,
        /*
         * The reserve, on the axis a tail actually costs. Bottom padding rather
         * than height: it holds the content inside the BODY and leaves the strip
         * under it for the tail, which is exactly what the shape expects.
         *
         * Declared in BOTH states, and with a transition, because that is what
         * makes a tail arrive and leave rather than appear and vanish. A tail is
         * two things at once — an outline and this reserve — and animating them
         * separately means two clocks to keep in step. So only the reserve
         * animates, and the surface below draws a tail of whatever size the
         * reserve currently is. One quantity; the shape cannot drift.
         *
         * A transition needs the property declared on both faces of the change:
         * a declaration that only exists in one state has nothing to animate
         * from.
         */
        tailMorph,
        {paddingBottom: paddingBottomOf(style) + (tailed ? CHAT_BUBBLE_TAIL_DROP : 0)},
      ]}>
      <ChatBubbleSurface
        tail={tail}
        radius={radius}
        width={surfaceWidth}
        style={surfaceStyle}
      />
      {content}
    </div>
  );
});

export default NativeChatBubble;

/**
 * The bottom padding a style resolves to, across the properties that set it.
 *
 * `padding`, `paddingVertical` and `paddingBottom` all reach it, and reading
 * only the specific one misses a caller who wrote a general one — after which
 * adding the reserve REPLACES their padding rather than adding to it, and the
 * balloon's text ends up against its bottom edge.
 */
function paddingBottomOf(style: $FlowFixMe): number {
  const entries = Array.isArray(style) ? style : [style];
  let resolved = 0;
  for (const entry of entries) {
    if (entry == null || typeof entry !== 'object') {
      continue;
    }
    for (const key of ['padding', 'paddingVertical', 'paddingBottom']) {
      const value = entry[key];
      if (typeof value === 'number') {
        resolved = value;
      }
    }
  }
  return resolved;
}

/**
 * The surface: the shape, and nothing else.
 *
 * Absolutely positioned against the box's edges, so it is exactly as tall as the
 * box — body plus the tail's strip — without being told either number.
 */
/*
 * The surface is ANIMATED, always.
 *
 * A send animation springs the balloon's width, and a plain host element cannot
 * be driven by an `Animated.Value`: the value arrives as an object in a style
 * the renderer does not understand, so the surface takes whatever number it was
 * born with and holds it. That is not hypothetical — it is what this component
 * shipped with, and a recording says exactly how it looked: the balloon flew in
 * over three frames, sat at the composer's full width for sixty-nine of them
 * (1.15 seconds), then snapped to its real width in one, because the only thing
 * that ever changed was the re-render at the end of the flight.
 *
 * Created at module scope. `createAnimatedComponent` called inside a render
 * makes a new component type every frame, and a new type remounts its view.
 */
/*
 * The suppressions are the string TAG, not the animation.
 *
 * `createAnimatedComponent` is typed for a `ComponentType`, and a registered
 * host element is a string — the same gap `registerFrameworkElement`'s callers
 * carry. It works at runtime because React treats an intrinsic tag as a type
 * like any other; what is missing is a Flow type for "a tag this framework has
 * registered", which nothing in the type system can express today.
 */
// $FlowFixMe[incompatible-type] a registered host element is a string tag
const AnimatedSurface = Animated.createAnimatedComponent('native-chatbubble');
// $FlowFixMe[incompatible-type] a registered host element is a string tag
const AnimatedFallbackSurface = Animated.createAnimatedComponent('div');

function ChatBubbleSurface({
  tail,
  radius,
  width,
  style,
}: $FlowFixMe): React.Node {
  // An explicit width INSTEAD of the leading inset, not alongside it: a box
  // given both is over-constrained and Yoga resolves the conflict rather than
  // the caller.
  const span = width == null ? atRest : {width};
  /*
   * There is no explicit HEIGHT, and that is deliberate.
   *
   * The surface used to take one during the send, pinned by its bottom so the
   * balloon could breathe. An explicit height also clears `top`, so the surface
   * stopped filling its box — and a pin that outlived its animation left the
   * surface at the height it was given while the box shrank around it. Measured
   * on a device through a tail retraction: box 47.0 -> 40.6 with the surface
   * stuck at 47.0, so the drawn body inflated by the whole tail drop. That is
   * the "the bubble grew when it hid its tail" report.
   *
   * Height is the BOX's, from its content and its tail reserve. The throw is a
   * width, and that is the whole of it.
   */
  if (Platform.OS !== 'ios') {
    return (
      <AnimatedFallbackSurface
        style={[surfaceLayout, span, {borderRadius: radius}, style]}
      />
    );
  }
  return (
    <AnimatedSurface
      tail={tail ?? ''}
      bubbleRadius={radius}
      /*
       * The surface is told how much tail to draw in the same units, and with
       * the same transition, as the space reserved for it.
       *
       * It cannot read the box's reserve — it is absolutely positioned inside
       * it and sees only its own props — so it carries its own copy. Padding on
       * a box pinned by its insets changes nothing about its layout, which is
       * what makes it usable as the carrier: the number is inert here and means
       * only "this much tail". `tailBasePadding` is zero, so the whole of it is
       * the tail.
       */
      tailBasePadding={0}
      style={[
        surfaceLayout,
        span,
        tailMorph,
        tail != null && tail !== '' ? tailFull : tailNone,
        style,
      ]}
    />
  );
}

/*
 * ONE clock for the box's reserve and the drawn tail — a fast one, near the
 * END of the handover's 250ms window. Both halves of that are measured off
 * the native chat and both were learned the hard way:
 *
 *   - FAST, because the native tail does not deform in slow motion: frame by
 *     frame across a real handover the rows slide for a quarter second with
 *     the tail whole, and the tail then collapses into its corner in about a
 *     hundred milliseconds. A tail morphing over the whole 250ms was reported
 *     as "when the tail disappears it changes shape".
 *   - ONE clock, because the surface that draws the tail is pinned inside the
 *     box that reserves space for it. Giving the box 250ms and the ink 100
 *     put a full-amount tail inside a box already most of the way shrunk —
 *     painted as a sliver of balloon below the bubble's edge for the length
 *     of the delay, and reported as a buggy hide that "causes jitter in the
 *     layout". The two quantities are one geometry; they get one clock.
 *
 * The delay parks the collapse at the end of the column's slide, so the
 * receipt rows move first and the tail leaves as they land — the native order
 * — and everything still finishes on the same frame.
 */
const tailMorph = {
  transitionProperty: 'padding-bottom',
  transitionDuration: `${CHAT_BUBBLE_TAIL_INK_MS}ms`,
  transitionDelay: `${CHAT_BUBBLE_TAIL_MORPH - CHAT_BUBBLE_TAIL_INK_MS}ms`,
  transitionTimingFunction: 'ease-out',
};
const tailFull = {paddingBottom: CHAT_BUBBLE_TAIL_DROP};
const tailNone = {paddingBottom: 0};

/*
 * Pinned to the TRAILING edge, so a surface with an explicit width grows
 * leftwards into the empty half of the row rather than pushing anything.
 */
const surfaceLayout = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  right: 0,
};
const atRest = {left: 0};
