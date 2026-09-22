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

/**
 * The tail's numbers live in `chatBubbleMetrics`, a leaf module a plain test can
 * read, and are re-exported here where callers look for them.
 */
export {
  CHAT_BUBBLE_TAIL_DROP,
  CHAT_BUBBLE_TAIL_INK_MS,
  CHAT_BUBBLE_TAIL_MORPH,
  CHAT_BUBBLE_TAIL_MORPH_CURVE,
} from './chatBubbleMetrics';

/**
 * The corner radius at the default text size, mirroring `kExpoChatBubbleRadius`:
 * the platform derives it as half the height of a one-line balloon in the
 * balloon font, so the smallest balloon is a capsule and every taller one shares
 * its corner. A caller whose text differs should pass
 * `(lineHeight + 2 * verticalPadding) / 2`.
 */
export const CHAT_BUBBLE_RADIUS: number = 20;

/**
 * Whether a tail is drawn here. Android's surface is a plain rounded box
 * (DOM-CSS-LIMITATION(android-chat-bubble-has-no-tail)), so a tail there would
 * cost height and show nothing, leaving an empty strip under the text; space is
 * reserved for a tail only where one is drawn.
 */
export const CHAT_BUBBLE_DRAWS_TAIL: boolean = Platform.OS === 'ios';

/**
 * `<native:chatbubble>`: a chat balloon. A tail is part of the box's geometry: a
 * balloon with one is `CHAT_BUBBLE_TAIL_DROP` points taller, its content stops
 * that much short of the bottom, and nothing changes horizontally, as the
 * platform's tailed and tailless balloons share their edges and text position.
 *
 * It renders two boxes. The outer one lays out the text and takes the reserve;
 * the inner one is the surface, absolutely positioned behind the text, carrying
 * the shape and safe to animate because it lays nothing out, as the platform
 * animates a mask behind a label that never moves.
 *
 * DOM-CSS-LIMITATION(android-chat-bubble-has-no-tail): on Android the surface
 * is a plain box with a corner radius and no tail; the outline is a mask over
 * whatever the caller drew, and the Android side lacks the masking seam. The
 * reserve follows the drawn shape (`CHAT_BUBBLE_DRAWS_TAIL`), so a balloon is
 * as tall as what it draws on either platform.
 *
 * @param tail `'leading'`, `'trailing'`, or omitted for none; sides rather than
 *   left and right because the tail is on the side the message came from, and
 *   the view resolves it against the layout direction.
 * @param radius the corner radius, clamped by the renderer to half the body's
 *   shorter side, so a short balloon is a capsule.
 * @param style the box's style: its padding, its maximum width, its background
 *   if it has none of its own.
 * @param surfaceStyle the surface's style: the balloon's colour or gradient.
 * @param surfaceWidth an explicit width for the surface, or omitted for the
 *   box's. The surface is pinned to the trailing edge, so a narrower one grows
 *   leftwards without pushing anything, which is what a send animation wants.
 * @param children the balloon's contents, not clipped by the shape so a
 *   reaction badge can overlap the corner from outside.
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
    // For the surface, not the box: the balloon view is the one that writes
    // trace lines
    nativeID,
    ...rest
  }: $FlowFixMe,
  // Forwarded to the box, which a caller measures and which receives touches;
  // a plain function component drops a ref silently
  ref: $FlowFixMe,
): React.Node {
  const tailed = CHAT_BUBBLE_DRAWS_TAIL && tail != null && tail !== '';
  /*
   * A `<menu>` child is the balloon's peek menu, not its content: the same helper
   * `<button>` uses, since HTML's list of commands is data the platform draws.
   */
  const {content, commands} = splitMenu(children);
  /*
   * The peek's two props go on the box, which receives the touch; the shape comes
   * back the other way, the surface handing its outline up to the box natively.
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
         * The reserve, as bottom padding: it holds the content inside the body and
         * leaves the strip under it for the tail. Declared in both states with a
         * transition, since a transition needs the property on both faces of the
         * change; only the reserve animates, and the surface draws a tail of whatever
         * size the reserve currently is.
         */
        tailMorph,
        {
          paddingBottom:
            paddingBottomOf(style) + (tailed ? CHAT_BUBBLE_TAIL_DROP : 0),
        },
      ]}>
      <ChatBubbleSurface
        nativeID={nativeID}
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
 * The bottom padding a style resolves to across `padding`, `paddingVertical`
 * and `paddingBottom`, so adding the reserve adds to a general padding rather
 * than replacing it.
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
 * The surface: the shape and nothing else, absolutely positioned against the
 * box's edges so it is as tall as the box without being told. Always animated,
 * since a send animation springs the balloon's width and a plain host element
 * cannot be driven by an `Animated.Value`. Created at module scope because
 * `createAnimatedComponent` inside a render makes a new type every frame. The
 * suppressions are for the string tag: `createAnimatedComponent` is typed for
 * a `ComponentType` and a registered host element is a string, the same gap
 * `registerFrameworkElement`'s callers carry.
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
  nativeID,
  tail,
  radius,
  width,
  style,
}: $FlowFixMe): React.Node {
  // An explicit width instead of the leading inset, not alongside it, or the
  // box is over-constrained
  const span = width == null ? atRest : {width};
  /*
   * No explicit height: an explicit height also clears `top`, so the surface
   * would stop filling its box, and a pin that outlived its animation would hold
   * the surface at the given height while the box shrank. Height is the box's,
   * from its content and its tail reserve; the throw is a width only.
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
      nativeID={nativeID}
      tail={tail ?? ''}
      bubbleRadius={radius}
      /*
       * The surface is told how much tail to draw in the same units and with the
       * same transition as the reserve. Absolutely positioned inside the box, it
       * cannot read the box's padding, so it carries its own copy; padding on a box
       * pinned by its insets changes nothing about its layout, so the number is
       * inert and means only "this much tail". `tailBasePadding` is zero.
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

/**
 * One clock for the box's reserve and the drawn tail, fast and near the end of
 * the handover's 250ms window, as in the platform's chat: the rows slide for a
 * quarter second with the tail whole, then the tail collapses into its corner
 * in about a hundred milliseconds. One clock, since the surface is pinned
 * inside the box that reserves space for it; two would paint a sliver of
 * balloon below the bubble's edge for the length of the difference. The delay
 * parks the collapse at the end of the column's slide so everything finishes
 * on the same frame.
 */
const tailMorph = {
  transitionProperty: 'padding-bottom',
  transitionDuration: `${CHAT_BUBBLE_TAIL_INK_MS}ms`,
  transitionDelay: `${CHAT_BUBBLE_TAIL_MORPH - CHAT_BUBBLE_TAIL_INK_MS}ms`,
  transitionTimingFunction: 'ease-out',
};
const tailFull = {paddingBottom: CHAT_BUBBLE_TAIL_DROP};
const tailNone = {paddingBottom: 0};

/**
 * Pinned to the trailing edge, so a surface with an explicit width grows
 * leftwards into the empty half of the row rather than pushing anything.
 */
const surfaceLayout = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  right: 0,
};
const atRest = {left: 0};
