/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

/**
 * An offline chat that reproduces native Messages' scrolling and keyboard
 * behaviour. `<native:scroll>` and `<native:keyboardaccessory>` should make
 * each of these automatic:
 *
 *  1. A short conversation starts at the top, under the header.
 *  2. A long one starts at the bottom, and the newest message stays in view
 *     as messages arrive (`contentAnchor="bottom"`).
 *  3. A reader who has scrolled up is not moved when someone else's message
 *     arrives.
 *  4. Sending scrolls to the newest message from anywhere
 *     (`scrollToLatest()`); `contentAnchor` doesn't do this.
 *  5. Raising the keyboard or growing the composer keeps a reader who is at
 *     the newest message there.
 *  6. Dragging over the keyboard dismisses it interactively, starting once
 *     the finger reaches the keyboard (UIKit's behaviour).
 *  7. Tapping the status bar scrolls to the earliest loaded message.
 *
 * All data is mock data. The `+` menu has commands to reach states such as a
 * long conversation or a message arriving while you read history.
 */

import '@react-native/expo-intrinsics-poc';

import {CHAT_BUBBLE_TAIL_DROP} from '../../expo-intrinsics/src/chatBubbleMetrics';
import env from '../../expo-intrinsics/src/env';
import NativeChatBubble, {
  CHAT_BUBBLE_DRAWS_TAIL,
} from '../../expo-intrinsics/src/NativeChatBubble';
import NativeScroll from '../../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../../expo-intrinsics/src/systemColors';
// Private: not exported from 'react-native'.
import VirtualView, {
  VirtualViewMode,
  VirtualViewRenderState,
  createHiddenVirtualView,
} from '../../react-native/src/private/components/virtualview/VirtualView';
import Composer, {BAR_TOP_PADDING, ComposerBar} from '../Composer';
import useHeaderEdgeEffects from '../headerEdge';
import RenderStats from '../NativeRenderStats';
import {REACTIONS} from '../reactions';
import {
  RECEIPT_FADE_MS,
  RECEIPT_GROW_CURVE,
  RECEIPT_GROW_FROM,
  RECEIPT_GROW_MS,
  RECEIPT_HOLD_MS,
  RECEIPT_INK_DELAY_MS,
  RECEIPT_LAYOUT_CURVE,
  RECEIPT_LAYOUT_MS,
  RECEIPT_LEAVE_MS,
  RECEIPT_SETTLED_MS,
  RECEIPT_SWAP_AT_MS,
  RECEIPT_SWAP_IN_MS,
  RECEIPT_SWAP_OUT_MS,
} from '../receiptTiming';
import {
  REVEAL_COLUMN,
  REVEAL_COLUMN_LANDING,
  REVEAL_SETTLED,
  TRANSCRIPT_MARGIN,
  resistedReveal,
  revealInkRamp,
} from '../reveal';
import {runFlags} from '../runGrouping';
import {BALLOON_BLUE, uiColor} from '../uiColors';
import * as React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Clipboard,
  DynamicColorIOS,
  Easing,
  PanResponder,
  PixelRatio,
  Platform,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';

const AnimatedDiv = Animated.createAnimatedComponent('div');
const AnimatedTranscript = Animated.createAnimatedComponent(NativeScroll);
const AnimatedP = Animated.createAnimatedComponent('p');
/*
 * Date separator fade-in, in ms. It starts when the message is added, with no
 * delay, unlike the receipt. See ui-metrics.md, "Date separator arrival".
 */
const STAMP_FADE = 270;
// Backstop in ms: `deliver` clears `sending` and `inFlight` after this if
// `rememberTakeoff` / `rememberArrival` never run for the sent message.
const SENDING_FLOOR_MS = 2000;
/*
 * Native Messages' max balloon width is the transcript column (window minus
 * both `TRANSCRIPT_MARGIN`s) minus this, when the composer has a `+` button.
 * With `BUBBLE_PADDING`, it also makes a balloon's text width equal the
 * composer field's (within 0.17 pt), so a message wraps the same after it is
 * sent. That depends on `COMPOSER_MARGIN`, `PLUS`, `GAP`, `SEND_W`,
 * `SEND_INSET_TRAILING` and the field's horizontal padding in Composer.js;
 * `WrapCheck.swift` tests it. See ui-metrics.md, "Balloon max width".
 */
const BALLOON_PLUS_RESERVE = 89.333;
/*
 * Native Messages' second width cap (`balloonMaxWidthPercent`), applied as
 * `maxWidth` on `styles.balloonWrap`. The smaller of this and
 * `balloonMetrics().maxWidth` wins, so this only matters in wide columns.
 * See ui-metrics.md, "Balloon max width in wide columns".
 */
const BALLOON_MAX_WIDTH = '85%';
/*
 * Distance in pt from the transcript margin to the receipt's right edge
 * (`styles.receipt` `marginRight`). As in native Messages, the receipt lines
 * up at a fixed x, not relative to its balloon.
 * See ui-metrics.md, "Receipt trailing inset".
 */
const RECEIPT_INSET = 19.667;

/*
 * The receipt line's height in pt, measured by the first `BubbleImpl` that
 * renders a receipt and shared by all rows. Rows start their receipt space at
 * this (or `RECEIPT_LINE_SEED`) so its height is never `auto`, which a CSS
 * transition can't animate from. Module-level, not state, so setting it
 * doesn't re-render the transcript.
 */
let measuredReceiptLine = null;
/*
 * `measuredReceiptLine` until the first measurement: one line of 11 pt system
 * text. Replaced before paint. See ui-metrics.md, "Receipt line height".
 */
const RECEIPT_LINE_SEED = 13;
/*
 * Extra space in pt above the receipt where balloons have no tail (not iOS):
 * the same gap looks smaller under a flat balloon bottom. Added to both
 * `styles.receipt`'s `marginTop` and the `receiptSpace` height, because
 * `receiptSpace` clips. See ui-metrics.md, "Receipt vertical position".
 */
const RECEIPT_AIR = CHAT_BUBBLE_DRAWS_TAIL ? 0 : CHAT_BUBBLE_TAIL_DROP + 3;
// Width of `styles.revealColumn`: `REVEAL_COLUMN` of content plus its
// `paddingRight`. Keep in sync with that padding.
const REVEAL_BOX_WIDTH =
  REVEAL_COLUMN + (TRANSCRIPT_MARGIN - REVEAL_COLUMN_LANDING);
/*
 * At rest the `styles.revealColumn` box starts 2 pt past the window's right
 * edge (off screen). `REVEAL_COLUMN_RATE` makes the column arrive when the
 * balloons have moved `REVEAL_SETTLED`, with the time's right edge
 * `TRANSCRIPT_MARGIN` from the window's edge.
 */
const REVEAL_COLUMN_OFFSET = REVEAL_BOX_WIDTH + 2;
const REVEAL_COLUMN_RATE =
  (REVEAL_COLUMN_OFFSET + REVEAL_COLUMN_LANDING) / REVEAL_SETTLED;

// Extra pt a sent balloon moves beyond `REVEAL_SETTLED` during the reveal.
// Tuned by eye, not measured.
const SENT_REVEAL_GAP = 6;

// `REVEAL_COLUMN_OFFSET` measured from `styles.balloonLine`'s right edge,
// which is `TRANSCRIPT_MARGIN` in from the window's.
const REVEAL_LINE_OFFSET = REVEAL_COLUMN_OFFSET + TRANSCRIPT_MARGIN;

// Reaction badge disc diameter, pt.
// See ui-metrics.md, "Reaction badge placement".
const BADGE = 34;
// Sizes (pt) of the reaction badge's two tail circles.
// See ui-metrics.md, "Reaction badge tail circles".
const BADGE_INTERMEDIATE_W = 16;
const BADGE_INTERMEDIATE_H = 15;
const BADGE_ANCHOR_W = 8;
const BADGE_ANCHOR_H = 7;

// `styles.transcriptContent`'s bottom padding; `endOfFlight` adds it too.
// See ui-metrics.md, "Transcript end padding".
const TRANSCRIPT_BOTTOM_PAD = 16;

/*
 * Vertical padding in pt above and below each row (`styles.row`), so rows in
 * a run are 2 × this apart. `endOfFlight` adds it below the last row.
 * See ui-metrics.md, "Gap between rows in a run".
 */
const ROW_AIR = 2;

// ms from the message's `Delivered` status to its `Read` status in the demo
const READ_AFTER_DELIVERED = 1400;
/*
 * ms from sending to the message's `Delivered` status, as in native Messages.
 * Until then the previous sent message keeps the receipt.
 * See ui-metrics.md, "Previous receipt through a send".
 */
const DELIVERED_AFTER = 1130;
/*
 * The delay in use: set from the `deliveredAfterMs` prop at the top of
 * `Chat`. ReceiptHandoffCheck.swift raises it through `EXP_DELIVERED_AFTER_MS`
 * (read in AppDelegate.mm) to fit two sends inside it.
 */
let deliveredAfter = DELIVERED_AFTER;

/*
 * Messages longer than this (in characters) show only the first
 * `TRUNCATE_PREVIEW` characters. Without a limit a very long message makes a
 * balloon too tall to render. See ui-metrics.md, "Message truncation".
 */
const TRUNCATE_ABOVE = 6000;

// About six lines, like native Messages. A character count because the
// renderer has no line-clamp.
const TRUNCATE_PREVIEW = 240;

/*
 * Frames a sent row waits for its first layout before giving up and showing
 * the message without the send animation, so it can't stay hidden. The row
 * also keeps reporting its position for up to 8 × this many frames.
 */
const BALLOON_SETTLE_FRAMES = 36;

// Assumes left-to-right layout: `NativeChatBubble` resolves `leading` /
// `trailing` against the layout direction.
const TAIL_SIDE = {'': undefined, left: 'leading', right: 'trailing'};

/*
 * Horizontal padding in pt: native Messages' balloon mask inset. Screenshots
 * suggest 16, but that includes the first glyph's side bearing.
 * See ui-metrics.md, "Balloon text inset".
 */
const BUBBLE_PADDING = 14;
// Native Messages' value. See ui-metrics.md, "Balloon minimum width".
const BUBBLE_MIN_WIDTH = 48;
// Native Messages' value. See ui-metrics.md, "Balloon text inset".
const BUBBLE_PADDING_V = 10;
const MESSAGE_FONT_SIZE = 17;
/*
 * Line box = font size + this, at every text size, as in native Messages.
 * `WrapCheck.swift` hardcodes the default-size line box, 20.
 * See ui-metrics.md, "Message line height".
 */
const MESSAGE_LEADING = 3;
/**
 * Balloon metrics for the current font scale and window width.
 *
 * - `lineHeight` is unscaled: the renderer multiplies it by `fontScale`, so
 *   the drawn line box is `MESSAGE_FONT_SIZE * fontScale + MESSAGE_LEADING`.
 * - `radius` is half the height of a one-line balloon, in drawn points.
 * - `maxWidth` is the balloon's max width. It is computed here rather than
 *   left to CSS because a balloon only shrinks to its longest line when its
 *   text has a numeric max width (see `styles.bubble`).
 */
function balloonMetrics(fontScale, windowWidth) {
  const lineBox = MESSAGE_FONT_SIZE * fontScale + MESSAGE_LEADING;
  return {
    lineHeight: lineBox / fontScale,
    radius: (lineBox + 2 * BUBBLE_PADDING_V) / 2,
    maxWidth: windowWidth - 2 * TRANSCRIPT_MARGIN - BALLOON_PLUS_RESERVE,
  };
}

// Avatar diameter. See ui-metrics.md, "Avatar size and position".
const AVATAR = 24;
// Avatar-to-balloon gap. See ui-metrics.md, "Avatar size and position".
const CONTACT_PHOTO_MARGIN = 7;

const STAMP_GAP = 15 * 60 * 1000;

// For the revealed times. `timeStyle: 'short'` includes AM/PM only in
// locales that use it.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {timeStyle: 'short'});

function timeOf(at) {
  return TIME_FORMAT.format(new Date(at));
}

/** The separator to show above a message, or `null` for none. */
function stampBetween(previous, message) {
  if (previous != null && message.at - previous.at < STAMP_GAP) {
    return null;
  }
  const when = new Date(message.at);
  const time = when.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const now = new Date();
  const sameDay = now.toDateString() === when.toDateString();
  const withinAWeek = now - when < 6 * 24 * 60 * 60 * 1000;
  const day = sameDay
    ? 'Today'
    : withinAWeek
      ? when.toLocaleDateString(undefined, {weekday: 'long'})
      : when.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  return {day, time};
}

function mineSide(message) {
  return message.from === 'me' ? 'right' : 'left';
}
/*
 * Spring for the sent balloon's vertical move. Mass and stiffness are native
 * Messages'; damping is its Reduce Motion value (critical damping) instead of
 * its default 17.35028, whose overshoot looks like the balloon sliding down
 * at the end. See ui-metrics.md, "Send trajectory".
 */
const THROW_SPRING = {mass: 1, stiffness: 141.75909, damping: 23.8125};

/*
 * Half a device pixel, in pt. `FlyingBalloon` treats its vertical animation
 * as done once `progress` is this close to 1 and moved less than this since
 * the previous sample, both scaled by the distance (`journeyNow`). At half a
 * pixel there is no visible jump when the row replaces the animated copy.
 */
const ARRIVAL_TOLERANCE = 0.5 / PixelRatio.get();

// Delay in ms before the sent balloon starts moving up (native Messages'
// `beginTime + 0.055`). See ui-metrics.md, "Send trajectory".
const THROW_DELAY = 55;

/*
 * Over `SQUASH_DURATION` ms on `SQUASH`, the flying balloon's width animates
 * from the composer field's to the balloon's and its scale drops to the
 * trough. `SQUASH_TROUGH` is the measured one-line trough: native Messages'
 * rule gives 0.7, but its shrink and regrow overlap, so the visible minimum
 * is 0.77. See ui-metrics.md, "Send squash".
 */
const SQUASH_DURATION = 177;
const SQUASH = Easing.bezier(0.41, 0.2, 0.6, 1);
const SQUASH_TROUGH = 0.77;

/**
 * The squash scale for a send from a composer field `fieldHeight` tall:
 * `SQUASH_TROUGH` at `restingHeight` (one line), rising linearly to
 * `SQUASH_TROUGH + 0.2` at seven times that, as in native Messages. Unknown
 * heights give `SQUASH_TROUGH`.
 */
function squashTrough(fieldHeight: ?number, restingHeight: ?number): number {
  if (fieldHeight == null || restingHeight == null || restingHeight <= 0) {
    return SQUASH_TROUGH;
  }
  const t = Math.min(
    Math.max((fieldHeight - restingHeight) / (6 * restingHeight), 0),
    1,
  );
  return SQUASH_TROUGH + 0.2 * t;
}

/*
 * Spring for the scale back up from the trough. Mass and stiffness are native
 * Messages'; damping is its Reduce Motion value (critical) instead of 38,
 * because the scale is anchored at the bottom corner (`styles.flier`) and any
 * overshoot moves the balloon's top edge. See ui-metrics.md, "Send swell".
 */
const SWELL_SPRING = {mass: 2, stiffness: 320, damping: 50.5964};

// Critically damped (2 * sqrt(150) ≈ 24.49), so releasing the reveal drag
// returns to 0 without overshoot.
const SETTLE_SPRING = {stiffness: 150, damping: 24.5, mass: 1};

// The sent balloon's gradient is fixed to the screen, not to each balloon
// (`styles.mineBalloon`)
/*
 * Received balloon fill: `secondarySystemFill` pre-blended over the
 * background, so it is opaque. On iOS the context menu lifts the balloon on a
 * clear platter, where a translucent fill looks muddy over the dimmed screen.
 * See ui-metrics.md, "Received balloon grey".
 */
const BUBBLE_GREY = Platform.select({
  ios: DynamicColorIOS({light: '#E9E9EB', dark: '#262629'}),
  default: uiColor('secondarySystemFill'),
});
// Native Messages' badge colour matches the gradient's bottom stop.
const BADGE_FILL = {
  light: BALLOON_BLUE.light.bottom,
  dark: BALLOON_BLUE.dark.bottom,
};

// `linear-gradient()` needs literal colours, not `DynamicColorIOS`, so the
// caller passes the current colour scheme.
function balloonGradient(scheme) {
  const stops = scheme === 'dark' ? BALLOON_BLUE.dark : BALLOON_BLUE.light;
  return 'linear-gradient(to bottom, ' + stops.top + ', ' + stops.bottom + ')';
}

// Full names, so `Avatar` initials have two letters.
const CAST = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'];

/*
 * Default for showing sender names and avatars on received messages: on in
 * groups, off in 1:1 chats. A message's `showName` overrides it (`named` in
 * `BubbleImpl`).
 */
const IS_GROUP = new Set(CAST).size > 1;

const OPENERS = [
  {from: 'Ada Lovelace', text: 'Did the keyboard cover the last message?'},
  {from: 'me', text: 'It should not. Pull it down and watch.'},
  {
    from: 'Ada Lovelace',
    text: 'The bar follows the keyboard rather than copying it.',
  },
];

// Duration in ms of a received balloon's scale-and-fade entrance. `receive`
// clears `arriving` just after it ends.
const RECEIVE_POP_MS = 220;

const REPLIES = [
  'Noted.',
  'That reads better than it did.',
  'Try it with the keyboard up.',
  'Scroll up first — you should stay where you are.',
  'And sending should bring you back down.',
  'Two lines in the composer moves the list too.',
];

let nextId = 0;
function makeMessage(from, text, entering) {
  return {
    id: ++nextId,
    from,
    text,
    at: Date.now(),
    entering: entering === true,
    /*
     * `null` for received messages, and for a new sent message until
     * `DELIVERED_AFTER`; while it is `null` the previous sent message keeps
     * the receipt. Seeded sent messages start as 'Delivered'.
     */
    status: from === 'me' && entering !== true ? 'Delivered' : null,
    edited: false,
  };
}

function mockConversation(count) {
  const messages = OPENERS.slice(0, count).map(m =>
    makeMessage(m.from, m.text),
  );
  for (let i = messages.length; i < count; i++) {
    const from = i % 3 === 1 ? 'me' : CAST[i % CAST.length];
    messages.push(
      makeMessage(
        from,
        from === 'me'
          ? `Message ${i + 1}, sent.`
          : `Message ${i + 1}, from ${from}.`,
      ),
    );
  }
  return messages;
}

/**
 * The date separator above a message ("Today 3:25 PM"). With `arriving` it
 * fades in (opacity only, so nothing moves); otherwise it shows at once.
 */
function Stamp({day, time, arriving}) {
  const [shown, setShown] = useState(!arriving);
  useEffect(() => {
    if (shown) {
      return;
    }
    // Wait a frame so the opacity transition has a start value.
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  return (
    <p style={[styles.stamp, shown ? styles.stampShown : styles.stampWaiting]}>
      <b style={styles.stampDay}>{day + ' '}</b>
      {time}
    </p>
  );
}

/**
 * The status line under the last sent message ("Delivered", "Read 5:29 PM",
 * "Edited"). `shown` is the status to draw, which can lag `message` while the
 * text changes (see `swappingReceipt` in `BubbleImpl`). `style` carries the
 * CSS transitions. `elementRef` lets `BubbleImpl` measure the line's height.
 */
function Receipt({message, shown, style, elementRef}) {
  const said = shown ?? message;
  const parts = [];
  if (said.edited) {
    parts.push('Edited');
  }
  if (said.status != null) {
    parts.push(said.status);
  }
  /*
   * Rendered even with no text, so that when text arrives the `<p>` already
   * exists and its CSS transition has a previous style to animate from.
   * `BubbleImpl` keeps it mounted in a zero-height `receiptSpace`. Don't wrap
   * the `<p>` in another box: that moves the text down, off the position
   * `ReceiptCheck.swift` checks.
   * See ui-metrics.md, "Receipt vertical position".
   */
  return (
    <p style={[styles.receipt, style]} ref={elementRef}>
      <span style={styles.receiptStatus}>{parts.join(' \u00b7 ')}</span>
      {said.readAt != null ? ` ${timeOf(said.readAt)}` : ''}
    </p>
  );
}

/**
 * A sender's initials in a circle. With `show` false, an empty spacer of the
 * same width keeps the run's balloons aligned.
 */
function Avatar({from, show}) {
  if (!show) {
    return <div style={styles.avatarSpacer} />;
  }
  const initials = from
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div style={styles.avatar}>
      <span style={styles.avatarInitials}>{initials}</span>
    </div>
  );
}

// Typing indicator values, read from native Messages' indicator layers.
// See ui-metrics.md, "Typing indicator".
const TYPING_DOT = 8.5;
/** `instanceTransform.tx` less the dot: 12.5 - 8.5. */
const TYPING_DOT_GAP = 4;
// One direction of a dot's opacity animation, ms; `alternate` doubles it.
const TYPING_BEAT = 500;
// Delay between the dots' animations, ms (native `instanceDelay`).
const TYPING_STAGGER = 250;
// Played with `animation-direction: alternate` (native `autoreverses`), which
// also reverses the timing curve on the way back.
const TYPING_BEAT_STOPS = [
  {offset: 0, opacity: 0.2},
  {offset: 1, opacity: 0.45},
];
const TYPING_BEAT_FRAMES = JSON.stringify(TYPING_BEAT_STOPS);
/*
 * Typing row entrance (`styles.typingEntry`). The delay is native Messages';
 * the duration and scale are chosen by eye. It is on the row because
 * `styles.typingCluster` already runs the pulse, and an element can run only
 * one animation in this renderer.
 */
const TYPING_GROW_DELAY = 120;
const TYPING_GROW = 260;
const TYPING_GROW_FRAMES = JSON.stringify([
  {offset: 0, transform: 'scale(0.3)', opacity: 0},
  {offset: 1, transform: 'scale(1)', opacity: 1},
]);
const TYPING_BUBBLE_W = 57.5;
const TYPING_BUBBLE_H = 35;
const TYPING_MEDIUM = 11.5;
const TYPING_SMALL = 5;
// The small tail circle's offset from the cluster's top, the native bubble's
const TYPING_SMALL_TOP = 38;
const TYPING_PULSE = 1900;
const TYPING_BREATH_FRAMES = JSON.stringify([
  {offset: 0, transform: 'scale(1)'},
  {offset: 0.5, transform: 'scale(1.03)'},
  {offset: 1, transform: 'scale(1)'},
]);

function TypingIndicator({from}) {
  return (
    <div
      style={[
        styles.row,
        styles.rowTheirs,
        styles.rowEndsRun,
        styles.typingEntry,
      ]}>
      <Avatar from={from} show={true} />
      {/*
        Three boxes, not a `NativeChatBubble`: the native indicator's tail is
        two small circles.
      */}
      <div style={styles.typingCluster}>
        <div style={styles.typingBubble}>
          <div style={styles.typingDots}>
            {[0, 1, 2].map(index => (
              <div
                key={index}
                style={[
                  styles.dot,
                  {animationDelay: `${index * TYPING_STAGGER}ms`},
                ]}
              />
            ))}
          </div>
        </div>
        <div style={styles.typingMedium} />
        <div style={styles.typingSmall} />
      </div>
    </div>
  );
}

/**
 * A reaction's artwork from `kind.art` (SF Symbol, stacked lines or text),
 * else `kind.glyph`. Used by both `Badge` and `ReactionPile` so they match.
 */
function ReactionArt({kind}) {
  const art = kind.art;
  if (art?.symbol != null) {
    return (
      <img
        aria-hidden={true}
        src={`system:${art.symbol}`}
        tintColor={art.color}
        style={[styles.badgeSymbol, {width: art.size, height: art.size}]}
      />
    );
  }
  if (art?.lines != null) {
    return (
      <div style={styles.badgeLines}>
        {art.lines.map((line, index) => (
          <span
            key={index}
            style={[
              styles.badgeGlyph,
              {
                color: art.color,
                fontSize: art.size,
                lineHeight: art.lineHeight ?? art.size,
                fontWeight: art.weight,
              },
              index > 0 && {marginLeft: art.stagger ?? 0},
            ]}>
            {line}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span
      style={[
        styles.badgeGlyph,
        art != null && {
          color: art.color,
          fontSize: art.size,
          lineHeight: art.lineHeight ?? art.size,
          fontWeight: art.weight,
        },
      ]}>
      {art != null ? art.text : kind.glyph}
    </span>
  );
}

/**
 * A single reaction's badge. Render it as a sibling of the balloon, not a
 * child: the long-press context menu lifts the balloon's own view, and the
 * badge must stay behind. Positioned by `styles.balloonWrap` in `BubbleImpl`.
 */
function Badge({reaction, mine, scheme}) {
  const kind = REACTIONS.find(entry => entry.id === reaction);
  if (kind == null) {
    return null;
  }
  const fill = scheme === 'dark' ? styles.badgeFillDark : styles.badgeFillLight;
  return (
    <div
      accessible={true}
      style={[styles.badgeAnchor, mine ? styles.badgeMine : styles.badgeTheirs]}
      aria-label={kind.label}>
      <div
        style={[
          styles.badgeAnchorDot,
          mine ? styles.badgeAnchorDotMine : styles.badgeAnchorDotTheirs,
          fill,
        ]}
      />
      <div
        style={[
          styles.badgeIntermediate,
          mine ? styles.badgeIntermediateMine : styles.badgeIntermediateTheirs,
          fill,
        ]}
      />
      <div style={[styles.badgeDisc, fill]}>
        <ReactionArt kind={kind} />
      </div>
    </div>
  );
}

// Horizontal offset (pt) of each disc behind the front one.
// See ui-metrics.md, "Reaction pile".
const PILE_PEEK = 3;

/**
 * Two or more reactions, drawn as stacked discs like native Messages: the
 * latest in front, up to two behind. Same anchor and tail as `Badge`.
 */
function ReactionPile({reactions, mine, scheme}) {
  const faces = reactions
    .map(id => REACTIONS.find(entry => entry.id === id))
    .filter(Boolean);
  if (faces.length < 2) {
    return null;
  }
  const fill = scheme === 'dark' ? styles.badgeFillDark : styles.badgeFillLight;
  const front = faces[faces.length - 1];
  const behind = Math.min(faces.length - 1, 2);
  const outward = mine ? 'left' : 'right';
  return (
    <div
      accessible={true}
      style={[styles.badgeAnchor, mine ? styles.badgeMine : styles.badgeTheirs]}
      aria-label={faces.map(face => face.label).join(', ')}>
      <div
        style={[
          styles.badgeAnchorDot,
          mine ? styles.badgeAnchorDotMine : styles.badgeAnchorDotTheirs,
          fill,
        ]}
      />
      <div
        style={[
          styles.badgeIntermediate,
          mine ? styles.badgeIntermediateMine : styles.badgeIntermediateTheirs,
          fill,
        ]}
      />
      {Array.from({length: behind}, (_, index) => (
        <div
          key={index}
          style={[
            styles.badgeDisc,
            styles.pileBehind,
            fill,
            {[outward]: -PILE_PEEK * (index + 1)},
          ]}
        />
      ))}
      <div style={[styles.badgeDisc, styles.pileFront, fill]}>
        <ReactionArt kind={front} />
      </div>
    </div>
  );
}

/**
 * Calls `make` once, on the first render, and returns the result on every
 * render. A lazy `useState` initializer rather than a ref: reading a ref
 * during render stops React Compiler from optimizing the component.
 */
function useLazily(make) {
  const [built] = useState(make);
  return built;
}

/*
 * Rounds a length to the nearest device pixel so edges aren't drawn
 * half-lit. Don't use it for a box that lays out text: rounding down can
 * wrap the last word (see `width` in `FlyingBalloon`).
 */
const PIXEL = PixelRatio.get();
const toPixel = (value: number): number => Math.round(value * PIXEL) / PIXEL;

/**
 * The animated copy of a sent message's balloon, rendered in the composer's
 * `flightLayer` (Composer.js). The composer bar is hosted by the keyboard
 * accessory, outside the transcript's view hierarchy, so nothing in the
 * transcript can draw over it. The message's own row stays invisible while
 * `entering`; `onArrived` clears `entering` in the same commit that hides
 * this copy (`landed`), so the balloon is always drawn once.
 *
 * After `landed`, the copy waits a frame and calls `onSettled` to be
 * unmounted. It is hidden first because when a native-driven animation ends,
 * the view reverts to the props React last rendered (the start position).
 */
function FlyingBalloon({
  message,
  mine,
  tail,
  metrics,
  scheme,
  /** The row's box in the window; only `x` and `width` are read here. */
  to,
  /**
   * Animated: the row's current y in the window (its content y minus the
   * scroll offset, computed natively).
   */
  trackY,
  /**
   * The composer field's position relative to `flightLayer`, in pt. `y` is
   * negative: `flightLayer` is at the bar's bottom edge, below the field.
   */
  anchor,
  /** Animated y of the field's top in the window, and its width in pt. */
  fieldTop,
  fieldWidth,
  /** Minimum squash scale, from `squashTrough`. */
  trough = SQUASH_TROUGH,
  /**
   * Returns the current distance in pt from the field to the row. A function
   * because both ends are native-driven values JS can't read. Used to scale
   * `ARRIVAL_TOLERANCE`, and in the trace.
   */
  journeyNow,
  /** True after `onArrived`; hides this copy. */
  landed,
  onTakeoff,
  onArrived,
  onSettled,
  onFlight,
}) {
  // Created with the start values so the first frame already shows the
  // balloon at the field; set after mount, one frame shows the end position.
  const flight = useLazily(() => ({
    progress: new Animated.Value(0),
    width: new Animated.Value(toPixel(fieldWidth)),
    squeeze: new Animated.Value(1),
  }));
  const {progress, width, squeeze} = flight;
  // `progress` (0 → 1) times the live distance from the field to the row, so
  // the balloon follows both when the keyboard moves them, without restarting
  // the spring.
  const journey = useLazily(() =>
    Animated.multiply(progress, Animated.subtract(trackY, fieldTop)),
  );
  // Props as they were at mount. The effect below must run once (rerunning
  // restarts the animation); reading props from here keeps its dependency list
  // complete and stable.
  const from = useLazily(() => ({
    fieldWidth,
    trough,
    toWidth: to.width,
    id: message.id,
    // Distance in pt at mount; used if `journeyNow` is missing, and in the
    // trace.
    journey: journeyNow?.() ?? 0,
    journeyNow,
    // Trace only.
    anchorY: anchor?.y,
    onArrived,
    onFlight,
    onTakeoff,
  }));

  useEffect(() => {
    // The drawn width's range, reported through `onFlight` for
    // SendMorphCheck.swift (via `flightTrace`): XCUITest can't observe this
    // animation because `XCUIElement.tap()` returns after it.
    let low = Infinity;
    let high = 0;
    let box = toPixel(from.fieldWidth);
    let squeezed = 1;
    let lastRise = null;
    // Trace only.
    let peakRise = 0;
    let peakAt = 0;
    const startedAt = Date.now();
    let lastSwell = null;
    let riseHome = false;
    let swellHome = false;
    const sample = () => {
      const drawn = box * squeezed;
      low = Math.min(low, drawn);
      high = Math.max(high, drawn);
    };
    const watch = width.addListener(({value}) => {
      box = value;
      sample();
    });
    const watchSqueeze = squeeze.addListener(({value}) => {
      // The same test as `watchRise`, in pt: scale difference × width.
      const moved =
        lastSwell == null ? Infinity : Math.abs(value - lastSwell) * box;
      lastSwell = value;
      squeezed = value;
      sample();
      // The same threshold as the flight's, compared in pt (scale error × width)
      const near = Math.abs(1 - value) * box <= ARRIVAL_TOLERANCE;
      if (near && moved <= ARRIVAL_TOLERANCE) {
        if (!swellHome) {
          // Stop the spring now, rather than letting its tail move the top
          // edge by a pixel later. Set the flag first: `setValue` calls this
          // listener again synchronously.
          swellHome = true;
          squeeze.stopAnimation();
          squeeze.setValue(1);
          squeezed = 1;
        }
        swellHome = true;
        home();
      }
    });
    /*
     * Called from the listeners once both animations are within half a pixel,
     * not from the `finished` callback: the springs report finished much
     * later, and when a native animation finishes the view reverts to its
     * rendered (start) position until the next commit.
     */
    let arrived = false;
    const arrive = () => {
      if (arrived) {
        return;
      }
      arrived = true;
      progress.removeListener(watchRise);
      width.removeListener(watch);
      squeeze.removeListener(watchSqueeze);
      // Snap both values to the end so the copy matches the row exactly.
      squeeze.stopAnimation();
      squeeze.setValue(1);
      progress.stopAnimation();
      progress.setValue(1);
      RenderStats?.trace(
        `flight ${String(from.id).slice(-6)} arrived squeeze=${squeezed.toFixed(3)} peak=${peakRise.toFixed(4)} at ${peakAt}ms` +
          ` journey=${(from.journeyNow?.() ?? from.journey).toFixed(2)}` +
          ` took=${from.journey.toFixed(2)} anchor=${String(from.anchorY?.toFixed?.(2))}`,
      );
      from.onFlight?.({low, high, resting: from.toWidth});
      from.onArrived?.(from.id);
    };
    // Arrive only when both the vertical move and the scale are done: they
    // end at different times, and arriving early makes the balloon jump in
    // size.
    const home = () => {
      if (riseHome && swellHome) {
        arrive();
      }
    };
    const watchRise = progress.addListener(({value}) => {
      /*
       * Done when within half a pixel of the end and moved less than half a
       * pixel since the previous sample. Position alone can pass while the
       * spring is still moving fast through the end value.
       */
      const moved = lastRise == null ? Infinity : Math.abs(value - lastRise);
      lastRise = value;
      if (value > peakRise) {
        peakRise = value;
        peakAt = Date.now() - startedAt;
      }
      // `progress` is a fraction of the distance; convert the tolerance.
      const span = from.journeyNow?.() ?? from.journey;
      const tolerance = ARRIVAL_TOLERANCE / Math.max(span, 1);
      const near = Math.abs(1 - value) <= tolerance;
      if (near && moved <= tolerance) {
        if (!riseHome) {
          // Stop the spring; what is left of it is under a pixel. Set the flag
          // first: `setValue` calls this listener again synchronously.
          riseHome = true;
          progress.stopAnimation();
          progress.setValue(1);
        }
        riseHome = true;
        home();
      }
    });
    const throwIn = Animated.parallel(
      [
        // Vertical move only: in native Messages the balloon's right edge
        // stays fixed during the send.
        Animated.sequence([
          Animated.delay(THROW_DELAY),
          Animated.spring(progress, {
            toValue: 1,
            useNativeDriver: true,
            ...THROW_SPRING,
          }),
        ]),
        // Native driver for `width` works because the iOS app enables
        // `useSharedAnimatedBackend` (AppDelegate.mm); JS-driven, it would
        // commit every frame.
        Animated.timing(width, {
          toValue: from.toWidth,
          duration: SQUASH_DURATION,
          easing: SQUASH,
          useNativeDriver: true,
        }),
        // Uniform scale, not width alone: native Messages' balloon keeps its
        // shape as it shrinks. See ui-metrics.md, "Send squash".
        Animated.sequence([
          Animated.timing(squeeze, {
            toValue: from.trough,
            duration: SQUASH_DURATION,
            easing: SQUASH,
            useNativeDriver: true,
          }),
          Animated.spring(squeeze, {
            toValue: 1,
            useNativeDriver: true,
            ...SWELL_SPRING,
          }),
        ]),
      ],
      {
        // The listeners stop each spring on its own. With the default
        // `stopTogether`, stopping one would stop the other, and `arrive`
        // (which needs both) would never run.
        stopTogether: false,
      },
    );
    // Let the composer clear the field now that this copy is mounted; clearing
    // earlier leaves a frame with the text nowhere.
    from.onTakeoff?.(from.id);
    // Fallback if the listeners never called `arrive`.
    throwIn.start(({finished}) => {
      if (finished) {
        arrive();
      }
    });
    return () => {
      progress.removeListener(watchRise);
      width.removeListener(watch);
      squeeze.removeListener(watchSqueeze);
      throwIn.stop();
    };
    // Runs once: every dependency is stable (see `from`).
  }, [from, progress, squeeze, width]);

  // After `landed` hides the copy, wait a frame, then ask to be unmounted.
  useEffect(() => {
    if (!landed) {
      return;
    }
    const frame = requestAnimationFrame(() => onSettled?.(message.id));
    return () => cancelAnimationFrame(frame);
  }, [landed, message.id, onSettled]);

  const text =
    (message.text?.length ?? 0) > TRUNCATE_ABOVE
      ? `${message.text.slice(0, TRUNCATE_PREVIEW).trimEnd()}…`
      : message.text;
  return (
    <AnimatedDiv
      style={[
        styles.flier,
        landed && styles.flierLanded,
        {
          // `flightLayer` spans the window's width, so a window x works as is.
          // y starts at the field (`anchor.y`); `journey` moves it to the row.
          left: toPixel(to.x),
          top: toPixel(anchor.y),
          // Not snapped with `toPixel`: this box lays out the text, and any
          // narrower wraps the last word.
          width: to.width,
          // Order matters: the scale is applied before the translate.
          transform: [{translateY: journey}, {scale: squeeze}],
        },
      ]}>
      {/*
        The animated `width` goes to the plain `NativeChatBubble` as
        `surfaceWidth`, which puts it on the surface view. An animated wrapper
        would apply it to the outer box instead and reflow the text.
      */}
      <NativeChatBubble
        // `tools/gate.sh` finds this balloon in the native trace by this ID
        // (`gone[flier]`).
        nativeID="flier"
        tail={TAIL_SIDE[tail]}
        radius={metrics.radius}
        style={styles.bubble}
        surfaceStyle={
          mine
            ? [styles.mineBalloon, {backgroundImage: balloonGradient(scheme)}]
            : styles.theirsBalloon
        }
        surfaceWidth={width}>
        <AnimatedP
          style={[
            styles.bubbleText,
            mine ? styles.mineText : styles.theirsText,
            {
              lineHeight: metrics.lineHeight,
              maxWidth: metrics.maxWidth - 2 * BUBBLE_PADDING,
            },
            {
              // Keeps the text where it was in the field while `width`
              // animates to the balloon's; 0 at the end.
              transform: [{translateX: Animated.subtract(to.width, width)}],
            },
          ]}>
          {text}
        </AnimatedP>
      </NativeChatBubble>
    </AnimatedDiv>
  );
}
function BubbleImpl({
  message,
  /** From `balloonMetrics`: line height, corner radius and max width. */
  metrics,
  composerFrame,
  /**
   * Ref to the transcript's content container. Must be an ancestor of this
   * row: the row measures itself against it to get content coordinates.
   */
  contentBox,
  tail,
  startsRun,
  endsRun,
  separatesRun,
  onCommand,
  onArrived,
  /**
   * Called with the message id once a balloon for this message is visible, so
   * the composer can clear its text. The row calls it only when it shows the
   * message without the flying-balloon animation; otherwise `FlyingBalloon`
   * calls it.
   */
  onTakeoff,
  onOpenReader,
  /**
   * Called with the row's frame in content coordinates, plus `windowY` (its y
   * in the window), on every frame while `message.entering` is set.
   * `rememberFlightFrame` in `Chat` aims `FlyingBalloon` at it.
   */
  onFlightFrame,
  /**
   * `'shown'` (visible under this message), `'waiting'` (newest sent message,
   * receipt not shown yet), `'leaving'` (the previous receipt, fading out) or
   * `'none'`.
   */
  showsReceipt,
  reveal,
  /** Opacity of the revealed time: `reveal` through `revealInkRamp`. */
  revealInk,
  pan,
  /** The reaction ids on this balloon (array; empty or undefined for none). */
  reactions,
}) {
  const renderedAt = profiling ? performance.now() : 0;
  if (profiling) {
    work.rows++;
    // A nonzero `pendingTold` belongs to this row; see `virtual.pendingTold`.
    if (virtual.pendingTold !== 0) {
      const blank = performance.now() - virtual.pendingTold;
      virtual.pendingTold = 0;
      virtual.blanks++;
      virtual.blankTotal += blank;
      if (blank > virtual.blankWorst) {
        virtual.blankWorst = blank;
      }
    }
  }
  const counted = useRef(false);
  if (profiling && !counted.current) {
    counted.current = true;
    work.mounts++;
  }
  const mine = message.from === 'me';
  const scheme = useColorScheme();
  const box = useRef(null);
  const named = !mine && (message.showName ?? IS_GROUP);
  const tooLong = (message.text?.length ?? 0) > TRUNCATE_ABOVE;
  /*
   * `animationKeyframes` takes a JSON list of keyframes; the renderer animates
   * only transform and opacity. `Chat` clears `arriving` after the animation
   * (in `receive`) and strips it on restore, so a remounted row doesn't replay
   * it.
   */
  const arriving = !mine && message.arriving === true;
  const popIn = arriving
    ? {
        animationKeyframes: JSON.stringify([
          {offset: 0, opacity: 0, transform: [{scale: 0.9}]},
          {offset: 1, opacity: 1, transform: [{scale: 1}]},
        ]),
        animationDuration: `${RECEIVE_POP_MS}ms`,
        animationTimingFunction: 'ease-out',
        animationFillMode: 'both',
        // Bottom-left: where a received balloon's tail is.
        transformOrigin: '0% 100%',
      }
    : null;
  const [receiptHeight, setReceiptHeight] = useState(
    measuredReceiptLine ?? RECEIPT_LINE_SEED,
  );
  const receiptInk = useRef(null);
  /*
   * `said` is the receipt text the message has now; `shownReceipt` is the text
   * on screen, which lags `said` while the text changes. `swappingReceipt` is
   * true while the old text fades out and during the gap before the new text
   * fades in (`RECEIPT_SWAP_AT_MS` in receiptTiming.js).
   */
  const said = useMemo(
    () => ({
      edited: message.edited,
      status: message.status,
      readAt: message.readAt,
    }),
    [message.edited, message.status, message.readAt],
  );
  const [shownReceipt, setShownReceipt] = useState(said);
  const [swappingReceipt, setSwappingReceipt] = useState(false);
  /*
   * True after a text change, so the new text fades in with
   * `styles.receiptInkSwapped` instead of `styles.receiptInkShown`'s delayed
   * grow.
   * Reset by the effect below when `showsReceipt` leaves `'shown'`.
   */
  const [swappedReceipt, setSwappedReceipt] = useState(false);
  /* Logs each receipt state change, for debugging receipt timing on device. */
  useEffect(() => {
    console.log(
      `receipt ${String(message.id).slice(-6)} ${showsReceipt}` +
        (swappingReceipt ? ' swapping' : '') +
        (swappedReceipt ? ' swapped' : '') +
        ` drawn=${String(shownReceipt.status)}`,
    );
  }, [
    message.id,
    showsReceipt,
    swappingReceipt,
    swappedReceipt,
    shownReceipt.status,
  ]);
  /* `Date.now()` when the current receipt text appeared. */
  const receiptSaidAt = useRef(0);
  if (receiptSaidAt.current === 0 && showsReceipt === 'shown') {
    receiptSaidAt.current = Date.now();
  }
  const wanted = `${String(message.edited)}|${String(message.status)}|${String(
    message.readAt,
  )}`;
  const drawn = `${String(shownReceipt.edited)}|${String(
    shownReceipt.status,
  )}|${String(shownReceipt.readAt)}`;
  useEffect(() => {
    if (wanted === drawn) {
      return;
    }
    // No text on screen yet, so there is nothing to fade out.
    if (shownReceipt.status == null && shownReceipt.edited !== true) {
      setShownReceipt(said);
      return;
    }
    /*
     * Only a `'shown'` receipt swaps its text. Swapping on a `'leaving'` one
     * blanks it before its space has closed.
     */
    if (showsReceipt !== 'shown') {
      return;
    }
    /*
     * Start the swap `RECEIPT_HOLD_MS` after the later of: now (the new text is
     * available) and the current text finishing its entrance
     * (`receiptSaidAt + RECEIPT_SETTLED_MS`).
     */
    const settled = Math.max(
      0,
      receiptSaidAt.current + RECEIPT_SETTLED_MS - Date.now(),
    );
    const wait = settled + RECEIPT_HOLD_MS;
    let swap = null;
    const hold = setTimeout(() => {
      setSwappingReceipt(true);
      swap = setTimeout(() => {
        receiptSaidAt.current = Date.now();
        setShownReceipt(said);
        setSwappingReceipt(false);
        setSwappedReceipt(true);
      }, RECEIPT_SWAP_AT_MS);
    }, wait);
    return () => {
      clearTimeout(hold);
      if (swap != null) {
        clearTimeout(swap);
      }
    };
    // `showsReceipt` is listed so a receipt leaving this row cancels the swap.
  }, [
    wanted,
    drawn,
    showsReceipt,
    said,
    shownReceipt.edited,
    shownReceipt.status,
  ]);
  useEffect(() => {
    if (showsReceipt !== 'shown') {
      setSwappedReceipt(false);
    }
  }, [showsReceipt]);
  /*
   * Measures the receipt line into `measuredReceiptLine`, once per app run:
   * changing the height during its transition restarts the transition. A
   * layout effect, so the seeded height is corrected before paint.
   * `offsetHeight`, because `getBoundingClientRect` includes the ink's scale
   * (`styles.receiptInkWaiting`). The ink keeps its full height inside the
   * closed, clipped `styles.receiptSpace`, so it can be measured before it
   * shows.
   */
  useLayoutEffect(() => {
    // Not `receiptHeight`: it starts at `RECEIPT_LINE_SEED`, so is never null.
    if (measuredReceiptLine != null) {
      if (receiptHeight !== measuredReceiptLine) {
        setReceiptHeight(measuredReceiptLine);
      }
      return;
    }
    const ink = receiptInk.current;
    if (ink == null || typeof ink.offsetHeight !== 'number') {
      return;
    }
    if (ink.offsetHeight > 0) {
      measuredReceiptLine = ink.offsetHeight;
      setReceiptHeight(ink.offsetHeight);
    }
  }, [receiptHeight, message.status, message.edited]);
  /*
   * While `message.entering`, the row is laid out but transparent
   * (`styles.rowWaiting`) and `FlyingBalloon` draws the message. `Chat` clears
   * `entering` in `rememberArrival`.
   */
  const ready = message.entering !== true;
  /*
   * Debug trace: the balloon's window y when the row becomes visible after the
   * flying balloon, then each change for 90 frames. Compare with
   * `FlyingBalloon`'s `arrived` trace line.
   */
  const wasEntering = useRef(message.entering === true);
  useEffect(() => {
    if (!ready || !wasEntering.current) {
      return;
    }
    wasEntering.current = false;
    const node = box.current;
    if (node?.measureInWindow == null) {
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      RenderStats?.trace(
        `row ${String(message.id).slice(-6)} balloon shown winY=${y.toFixed(2)} h=${h.toFixed(2)} w=${w.toFixed(2)}`,
      );
    });
    let frame = null;
    let last = null;
    let ticks = 0;
    const watch = () => {
      ticks += 1;
      box.current?.measureInWindow?.((x, y) => {
        if (last == null || Math.abs(y - last) > 0.01) {
          RenderStats?.trace(
            `row ${String(message.id).slice(-6)} balloon at ${y.toFixed(2)}${
              last == null ? '' : ` (${(y - last).toFixed(2)})`
            }`,
          );
          last = y;
        }
      });
      if (ticks < 90) {
        frame = requestAnimationFrame(watch);
      }
    };
    frame = requestAnimationFrame(watch);
    return () => {
      if (frame != null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [ready, message.id]);

  useEffect(() => {
    if (message.entering !== true) {
      return;
    }
    // Every early exit below must call both `onArrived` and `onTakeoff`, or
    // `entering` stays set and a remount replays the animation.
    const origin = composerFrame?.current;
    /*
     * `composerFrame.current.y` is missing or 0 until the transcript and the
     * composer bar are laid out. Animating then would start the flying balloon
     * at the top of the window.
     */
    if (origin == null || !(origin.y > 0)) {
      onArrived?.(message.id);
      onTakeoff?.(message.id);
      return;
    }

    let cancelled = false;
    let timer = null;
    let tries = 0;

    /*
     * Measures against `contentBox`, so scrolling doesn't change the result.
     * `rememberFlightFrame` in `Chat` subtracts the scroll offset.
     */
    const attempt = () => {
      if (cancelled) {
        return;
      }
      const content = contentBox?.current;
      const node = box.current;
      if (node?.measureLayout == null || content == null) {
        onArrived?.(message.id);
        onTakeoff?.(message.id);
        return;
      }
      node.measureLayout(
        content,
        (x, y, w, h) => {
          if (cancelled) {
            return;
          }
          if (!(w > 0)) {
            tries += 1;
            if (tries > BALLOON_SETTLE_FRAMES) {
              onArrived?.(message.id);
              onTakeoff?.(message.id);
              return;
            }
            timer = requestAnimationFrame(attempt);
            return;
          }
          /*
           * `windowY` lets `rememberFlightFrame` correct its aim where content
           * y minus the scroll offset differs from the row's real window y.
           */
          if (node.measureInWindow != null) {
            node.measureInWindow((wx, wy, ww, wh) => {
              onFlightFrame?.(message.id, {
                x,
                y,
                width: w,
                height: h,
                windowY: wh > 0 ? wy : undefined,
              });
            });
          } else {
            onFlightFrame?.(message.id, {x, y, width: w, height: h});
          }
          /*
           * Re-measure every frame until `entering` clears (the cleanup stops
           * this): a receipt opening or closing above can move this row
           * during the animation.
           */
          if (tries < BALLOON_SETTLE_FRAMES * 8) {
            tries += 1;
            timer = requestAnimationFrame(attempt);
          }
        },
        () => {
          onArrived?.(message.id);
          onTakeoff?.(message.id);
        },
      );
    };
    timer = requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      if (timer != null) {
        cancelAnimationFrame(timer);
      }
    };
  }, [
    composerFrame,
    contentBox,
    message.entering,
    message.id,
    onArrived,
    onFlightFrame,
    onTakeoff,
  ]);

  /*
   * Only sent balloons move, as in native Messages. When `reveal` reaches
   * `REVEAL_SETTLED`, they have moved `REVEAL_SETTLED + SENT_REVEAL_GAP` pt.
   */
  const revealShift =
    reveal != null
      ? Animated.multiply(
          reveal,
          -(REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED,
        )
      : 0;
  const shift = mine ? revealShift : 0;
  /*
   * Each revealed time moves `-reveal * REVEAL_COLUMN_RATE` in total. A sent
   * row's time is inside the row, which already moves by `shift`, so it adds
   * only the difference. Uses the same ratio as `revealShift`: change both
   * together, or sent and received times stop lining up.
   */
  const timeShift =
    reveal == null
      ? 0
      : Animated.multiply(
          reveal,
          mine
            ? -(
                REVEAL_COLUMN_RATE -
                (REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED
              )
            : -REVEAL_COLUMN_RATE,
        );
  const tree = (
    <AnimatedDiv
      {...(pan != null ? pan.panHandlers : null)}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        separatesRun ? styles.rowEndsRun : styles.rowEndsRunLeaving,
        {transform: [{translateX: shift}]},
        ready ? styles.rowReady : styles.rowWaiting,
      ]}>
      {named && <Avatar from={message.from} show={endsRun} />}
      <div style={[styles.stack, mine ? styles.stackMine : styles.stackTheirs]}>
        {named && startsRun && <p style={styles.sender}>{message.from}</p>}
        <div
          style={[
            styles.balloonLine,
            mine ? styles.balloonLineMine : styles.balloonLineTheirs,
          ]}>
          {/*
            `Badge` and `ReactionPile` are siblings of `NativeChatBubble`, not
            children: on iOS the long-press preview lifts only the bubble, and
            the reaction stays in place, as in native Messages.
          */}
          <div style={styles.balloonWrap}>
            <NativeChatBubble
              ref={box}
              tail={TAIL_SIDE[tail]}
              radius={metrics.radius}
              onCommand={event => onCommand?.(message.id, event.nativeEvent.id)}
              /*
               * Long press opens the system menu built from the `<menu>` child:
               * UIKit's context menu on iOS, a `PopupMenu` on Android.
               */
              wantsContextMenu={true}
              style={[styles.bubble, {maxWidth: metrics.maxWidth}, popIn]}
              surfaceStyle={
                mine
                  ? [
                      styles.mineBalloon,
                      {backgroundImage: balloonGradient(scheme)},
                    ]
                  : styles.theirsBalloon
              }>
              {/*
                No reactions here: native Messages shows them in a private view
                above the menu, which a `<menu>` can't create, and an iOS
                compact icon row (`UIMenuElementSizeSmall`) holds only four.
                They are set from the `+` menu instead. See
                `DOM-CSS-LIMITATION(compact-menu-row-holds-four)`.
              */}
              <menu>
                {/*
                  `applyCommand` in `Chat` handles these by `id`. Only Copy does
                  anything; the demo has no backend for the others.
                */}
                <li id="copy" icon="system:doc.on.doc">
                  Copy
                </li>
                <li id="translate" icon="system:character.bubble">
                  Translate
                </li>
                <li id="select" icon="system:checkmark.circle">
                  Select
                </li>
                <li id="more" icon="system:ellipsis.circle">
                  More…
                </li>
              </menu>
              <p
                style={[
                  styles.bubbleText,
                  mine ? styles.mineText : styles.theirsText,
                  /*
                   * Must match `lineHeight` and `maxWidth` on `FlyingBalloon`'s
                   * text, so the text wraps the same when this row replaces the
                   * flying balloon.
                   */
                  {
                    lineHeight: metrics.lineHeight,
                    maxWidth: metrics.maxWidth - 2 * BUBBLE_PADDING,
                  },
                ]}>
                {tooLong
                  ? `${message.text.slice(0, TRUNCATE_PREVIEW).trimEnd()}…`
                  : message.text}
              </p>
              {tooLong && (
                /*
                 * An element, not a character appended to the text, so it
                 * stays at the balloon's trailing edge (as in native Messages).
                 */
                <a
                  href="#"
                  aria-label="Show the whole message"
                  onClick={event => {
                    event.preventDefault();
                    onOpenReader?.(message);
                  }}
                  style={
                    mine ? styles.moreChevronMine : styles.moreChevronTheirs
                  }>
                  ›
                </a>
              )}
            </NativeChatBubble>
            {reactions != null && reactions.length === 1 && (
              <Badge reaction={reactions[0]} mine={mine} scheme={scheme} />
            )}
            {reactions != null && reactions.length > 1 && (
              <ReactionPile reactions={reactions} mine={mine} scheme={scheme} />
            )}
          </div>
          {reveal != null && (
            <AnimatedDiv
              style={[
                styles.revealColumn,
                endsRun ? styles.revealColumnTailed : null,
                {opacity: revealInk, transform: [{translateX: timeShift}]},
              ]}>
              <span style={styles.revealTime}>{timeOf(message.at)}</span>
            </AnimatedDiv>
          )}
        </div>
        {/*
          The receipt is always mounted, even for `'none'`: a CSS transition
          needs a previous value, so mounting it with its new style would skip
          the animation. It is inside the stack so `styles.rowEndsRun`'s bottom
          padding goes below the receipt, not between it and the balloon.
        */}
        {
          <div
            /*
             * Hidden from accessibility when `'leaving'` or `'none'`: a leaving
             * receipt repeats the text under the newer message, so VoiceOver
             * reads it twice and `ReceiptCheck.swift` finds the invisible copy.
             * Never for `'waiting'`: removing `aria-hidden` doesn't restore the
             * subtree to the accessibility tree, and a waiting receipt becomes
             * the shown one.
             */
            aria-hidden={
              showsReceipt === 'leaving' || showsReceipt === 'none'
                ? true
                : undefined
            }
            style={[
              styles.receiptSpace,
              showsReceipt === 'shown'
                ? receiptHeight == null
                  ? null
                  : {height: receiptHeight + RECEIPT_AIR}
                : showsReceipt === 'leaving'
                  ? styles.receiptSpaceLeaving
                  : styles.receiptSpaceClosed,
            ]}>
            <Receipt
              message={message}
              /*
               * `said` until `shownReceipt` has text. `shownReceipt` is set by
               * an effect, one commit after `showsReceipt` becomes `'shown'`;
               * the text must appear in the same commit as
               * `styles.receiptInkShown`, or the grow animation runs on an
               * empty line.
               */
              shown={
                shownReceipt.status == null && shownReceipt.edited !== true
                  ? said
                  : shownReceipt
              }
              elementRef={receiptInk}
              style={
                showsReceipt === 'shown'
                  ? swappingReceipt
                    ? styles.receiptInkFading
                    : swappedReceipt
                      ? styles.receiptInkSwapped
                      : styles.receiptInkShown
                  : showsReceipt === 'leaving'
                    ? styles.receiptInkLeaving
                    : styles.receiptInkWaiting
              }
            />
          </div>
        }
      </div>
    </AnimatedDiv>
  );
  if (profiling) {
    work.renderMs += performance.now() - renderedAt;
  }
  return tree;
}

/*
 * `Chat` re-renders on every keystroke. Keep every prop a primitive, a stable
 * ref, a memoised value or a `useCallback`, so the shallow compare skips
 * unchanged rows.
 */
const Bubble = React.memo(BubbleImpl);

/*
 * Module-level so the conversation survives `Chat` unmounting when the user
 * navigates back. Per-visit state (typing indicator, sends in progress) is not
 * stored here.
 */
const persistedChat = {messages: null, draft: '', reactions: null, seed: null};

/*
 * At open, rows older than the newest `OPEN_ROWS` start as `HiddenRow`
 * (nothing rendered, `ESTIMATED_ROW_HEIGHT` tall). A plain `VirtualView`
 * renders and mounts its balloon before the first layout can hide it, which
 * is slow for a long transcript.
 */
const OPEN_ROWS = 40;
// How long (ms) a scroll report keeps measuring after momentum ends. See
// `onMomentumScrollEnd` in `Chat`.
const SCROLL_SETTLE_MS = 1500;
let settleTimer = null;
const ESTIMATED_ROW_HEIGHT = 60;
const HiddenRow = createHiddenVirtualView({height: ESTIMATED_ROW_HEIGHT});

/*
 * Counters for the current profiled event: `beginWork` resets them, `endWork`
 * reports. Renders are counted inside the render bodies of `Chat` and
 * `BubbleImpl`, the only place a release build can count them.
 */
const work = {
  event: null,
  since: 0,
  chat: 0,
  rows: 0,
  mounts: 0,
  longFrames: 0,
  worstFrame: 0,
  /* ms after `since`, and the renderer's counter deltas in that frame. */
  worstFrameAt: 0,
  worstFrameWas: null,
  frames: 0,
  over34: 0,
  over50: 0,
  over100: 0,
  over200: 0,
  /* ms spent in `BubbleImpl` render bodies. */
  renderMs: 0,
  /* `RenderStats.read()` at `beginWork`; see `rendererSince`. */
  renderer: null,
};
let profiling = false;
/*
 * Also turns the native renderer counters on or off (they time every
 * mutation). On a device this is the only way to enable them: the environment
 * variables `RCTRenderStats.h` checks aren't set when the app is launched from
 * the home screen.
 */
function setProfiling(on) {
  if (profiling === on) {
    return;
  }
  profiling = on;
  RenderStats?.setEnabled(on);
}
function beginWork(event) {
  if (!profiling) {
    return;
  }
  work.event = event;
  work.renderer = RenderStats?.read() ?? null;
  work.since = performance.now();
  work.chat = 0;
  work.rows = 0;
  work.mounts = 0;
  work.longFrames = 0;
  work.worstFrame = 0;
  work.worstFrameAt = 0;
  work.worstFrameWas = null;
  work.frames = 0;
  work.over34 = 0;
  work.over50 = 0;
  work.over100 = 0;
  work.over200 = 0;
  work.renderMs = 0;
  resetVirtual();
}
/** The build label for reports, read once from `RenderStats`. */
let buildLabel = null;
function build() {
  if (buildLabel == null) {
    const stats = RenderStats?.read();
    buildLabel =
      stats == null
        ? 'build ?'
        : `build ${stats.buildCommit} ${stats.buildStamp}`;
  }
  return buildLabel;
}

function endWork(lead) {
  const scrolling = work.event === 'scroll' || work.event === 'reveal';
  const report =
    `${lead} — ${Math.round(performance.now() - work.since)} ms` +
    ` · ${build()}` +
    (scrolling ? ` (with ${SCROLL_SETTLE_MS} ms of settle)` : '') +
    '; ' +
    `Chat ×${work.chat}, rows ×${work.rows} (${work.mounts} mounted)` +
    (scrolling
      ? `, long JS frames ×${work.longFrames} (worst ${Math.round(work.worstFrame)} ms)` +
        `\n${virtualReport()}`
      : '');
  work.event = null;
  return report;
}

/** The long form of the report, shown when the caption is tapped in `Chat`. */
function detailReport() {
  const lines = [];
  lines.push(
    `frames ×${work.frames}: ×${work.over34} >34ms, ×${work.over50} >50ms, ` +
      `×${work.over100} >100ms, ×${work.over200} >200ms; worst ${Math.round(work.worstFrame)} ms` +
      (work.worstFrame > 0 ? ` at +${Math.round(work.worstFrameAt)} ms` : ''),
  );
  const inside = work.worstFrameWas;
  if (inside != null) {
    const accounted =
      inside.commitMs + inside.diffMs + inside.mountMs + inside.sweepMs;
    lines.push(
      `inside it: ${Math.round(inside.commitMs)} ms committing, ` +
        `${Math.round(inside.diffMs)} ms diffing, ${Math.round(inside.mountMs)} ms mounting, ` +
        `${Math.round(inside.sweepMs)} ms sweeping over ×${inside.transactions} transactions ` +
        `(×${inside.updates} updates) — ` +
        `${Math.round(work.worstFrame - accounted)} ms was none of the renderer`,
    );
  }
  lines.push(
    `rows ×${work.rows} rendered (${work.mounts} first mounts) in ` +
      `${Math.round(work.renderMs)} ms of JavaScript — ` +
      `${work.rows === 0 ? 0 : (work.renderMs / work.rows).toFixed(2)} ms each`,
  );
  const elapsed = performance.now() - work.since;
  const renderer = rendererSince(work.renderer);
  if (renderer == null) {
    lines.push(
      `of ${Math.round(elapsed)} ms elapsed, ${Math.round(work.renderMs)} ms was ` +
        `rendering rows; the rest is React and the main thread`,
    );
  } else {
    // Omits `layoutMs`: it is already part of `commitMs` (Yoga runs in it).
    const spent =
      work.renderMs +
      renderer.commitMs +
      renderer.diffMs +
      renderer.mountMs +
      renderer.sweepMs;
    lines.push(
      `${Math.round(spent)} ms of the ${Math.round(elapsed)} ms window was the renderer's: ` +
        `${Math.round(work.renderMs)} ms rendering rows, ${Math.round(renderer.commitMs)} ms ` +
        `committing (${Math.round(renderer.layoutMs)} ms of it laying out ×${renderer.layoutNodes} ` +
        `nodes), ${Math.round(renderer.diffMs)} ms diffing, ${Math.round(renderer.mountMs)} ms ` +
        `mounting, ${Math.round(renderer.sweepMs)} ms sweeping`,
    );
    const per = n =>
      renderer.transactions === 0 ? 0 : (n / renderer.transactions).toFixed(1);
    lines.push(
      `mounted ×${renderer.transactions} transactions: ×${renderer.creates} create, ` +
        `×${renderer.inserts} insert, ×${renderer.updates} update, ×${renderer.removes} remove, ` +
        `×${renderer.deletes} delete — ×${per(renderer.updates)} updates each`,
    );
    /*
     * `bigTransactions`, not `biggestMutations`: the latter is a high-water
     * mark for the whole app run, so it can't describe one gesture.
     */
    if (renderer.bigTransactions > 0) {
      lines.push(
        `×${renderer.bigTransactions} transactions over 1000 mutations, ` +
          `${Math.round(renderer.bigMs)} ms in them`,
      );
    } else {
      lines.push('no transaction over 1000 mutations');
    }
    // `sweepMs` includes both full sweeps and single-view sweeps.
    const passes = renderer.sweeps + renderer.sweepSingles;
    lines.push(
      `swept ×${renderer.sweeps} times (×${renderer.sweepSingles} single) over ` +
        `×${renderer.sweptRows} rows — ` +
        `${passes === 0 ? 0 : Math.round((renderer.sweepMs * 1000) / passes)} µs ` +
        `each, worst ${Math.round(renderer.worstSweepUs)} µs`,
    );
    /*
     * An anchor correction that was wanted but not applied is content that
     * visibly moved under the reader; `points` is how far.
     */
    if (renderer.anchorWanted > 0) {
      const dropped = renderer.anchorWanted - renderer.anchorApplied;
      const points = renderer.anchorWantedPoints - renderer.anchorAppliedPoints;
      lines.push(
        `anchor held ×${renderer.anchorApplied} of ×${renderer.anchorWanted}` +
          (dropped === 0
            ? ' — nothing moved under you'
            : `; ×${dropped} dropped, ${Math.round(points)} points`),
      );
    }
    if (renderer.textMeasurements > 0) {
      lines.push(
        `measured ×${renderer.textMeasurements} texts in ` +
          `${Math.round(renderer.textMeasureMs)} ms`,
      );
    }
  }
  if (virtual.blanks > 0) {
    lines.push(
      `caught blank ×${virtual.blanks}: stayed blank ` +
        `${Math.round(virtual.blankTotal / virtual.blanks)} ms mean, ` +
        `${Math.round(virtual.blankWorst)} ms worst`,
    );
  } else {
    lines.push(
      'caught blank ×0 — every row was prerendered before it was needed',
    );
  }
  lines.push(virtualReport());
  return lines.join('\n');
}
/*
 * Measures JavaScript frame times between `meterFrames(true)` and
 * `meterFrames(false)` (scroll and reveal reports). A frame over 34 ms (two
 * frames at 60 Hz) counts as long.
 */
let frameMeter = null;
function meterFrames(on) {
  if (!profiling && on) {
    return;
  }
  if (frameMeter != null) {
    cancelAnimationFrame(frameMeter);
    frameMeter = null;
  }
  if (!on) {
    return;
  }
  let last = performance.now();
  /*
   * Counters at the start of the current frame, for the worst frame's deltas.
   * Costs one native read per frame. See ui-metrics.md, "Frame meter renderer
   * read cost".
   */
  let before = RenderStats?.read() ?? null;
  const tick = () => {
    const now = performance.now();
    const frame = now - last;
    const after = RenderStats?.read() ?? null;
    work.frames++;
    if (frame > 200) {
      work.over200++;
    } else if (frame > 100) {
      work.over100++;
    } else if (frame > 50) {
      work.over50++;
    } else if (frame > 34) {
      work.over34++;
    }
    if (frame > 34) {
      work.longFrames++;
      if (frame > work.worstFrame) {
        work.worstFrame = frame;
        work.worstFrameAt = now - work.since;
        work.worstFrameWas =
          before == null || after == null
            ? null
            : {
                commitMs: after.commitMs - before.commitMs,
                diffMs: after.diffMs - before.diffMs,
                mountMs: after.mountMs - before.mountMs,
                sweepMs: after.sweepMs - before.sweepMs,
                transactions: after.transactions - before.transactions,
                updates: after.updates - before.updates,
              };
      }
    }
    before = after;
    last = now;
    frameMeter = requestAnimationFrame(tick);
  };
  frameMeter = requestAnimationFrame(tick);
}

/*
 * Counters for `VirtualView` mode changes, updated by `noteMode`. `Visible` is
 * applied synchronously; `Prerender` and `Hidden` wait in a React transition
 * (see `told` on `ModeChangeEvent` in VirtualView.js).
 */
const virtual = {
  visible: 0,
  /* Rows told `Visible` while still hidden: on screen, but blank. */
  caught: 0,
  prerender: 0,
  hidden: 0,
  /* Transition waits of `Prerender` and `Hidden` changes, in ms. */
  waits: 0,
  waitTotal: 0,
  waitWorst: 0,
  /*
   * `told` of the last row caught blank. `Visible` is applied synchronously,
   * so the next `BubbleImpl` to render is that row; it records how long the
   * row was blank.
   */
  pendingTold: 0,
  blanks: 0,
  blankTotal: 0,
  blankWorst: 0,
};
function resetVirtual() {
  virtual.visible = 0;
  virtual.caught = 0;
  virtual.pendingTold = 0;
  virtual.blanks = 0;
  virtual.blankTotal = 0;
  virtual.blankWorst = 0;
  virtual.prerender = 0;
  virtual.hidden = 0;
  virtual.waits = 0;
  virtual.waitTotal = 0;
  virtual.waitWorst = 0;
}
function noteMode(event) {
  if (!profiling) {
    return;
  }
  const mode = event.mode;
  if (mode === VirtualViewMode.Visible) {
    virtual.visible++;
    if (event.renderState === VirtualViewRenderState.None) {
      virtual.caught++;
      virtual.pendingTold = event.told;
    }
    return;
  }
  if (mode === VirtualViewMode.Prerender) {
    virtual.prerender++;
  } else {
    virtual.hidden++;
  }
  const waited = performance.now() - event.told;
  virtual.waits++;
  virtual.waitTotal += waited;
  if (waited > virtual.waitWorst) {
    virtual.waitWorst = waited;
  }
}
function virtualReport() {
  const told =
    `rows told ×${virtual.visible} visible (×${virtual.caught} still blank), ` +
    `×${virtual.prerender} prerender, ×${virtual.hidden} hidden`;
  if (virtual.waits === 0) {
    return told;
  }
  return (
    `${told}; transition waited ` +
    `${Math.round(virtual.waitTotal / virtual.waits)} ms mean, ` +
    `${Math.round(virtual.waitWorst)} ms worst`
  );
}

/**
 * Renderer counter deltas since `before` (a `RenderStats.read()`), or null
 * without the native module. `biggestMutations` and `worstSweepUs` are
 * high-water marks, so they are passed through, not subtracted.
 */
function rendererSince(before) {
  const now = RenderStats?.read();
  if (before == null || now == null) {
    return null;
  }
  const since = {};
  for (const key of Object.keys(now)) {
    since[key] = now[key] - before[key];
  }
  since.biggestMutations = now.biggestMutations;
  since.worstSweepUs = now.worstSweepUs;
  return since;
}

/**
 * Memoised so a `Chat` render that changes none of these props (such as a
 * keystroke) doesn't rebuild every row's element; `React.memo` on `Bubble`
 * only skips the row's body. Keep every prop a ref, a memoised value, a
 * `useCallback` or a primitive. See ui-metrics.md, "Transcript row elements
 * per keystroke".
 */
const Transcript = React.memo(function Transcript({
  applyCommand,
  composerFrame,
  lastSent,
  messages,
  metrics,
  onOpenReader,
  openedWith,
  pan,
  previousWearer,
  reactions,
  rememberArrival,
  rememberFlightFrame,
  rememberTakeoff,
  reveal,
  revealInk,
  transcriptContent,
  watching,
  wearsReceipt,
}) {
  return messages.map((message, index) => {
    const Row =
      index < openedWith.current - OPEN_ROWS ? HiddenRow : VirtualView;
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const {startsRun, endsRun, separatesRun} = runFlags(
      message,
      previous,
      next,
      index,
      wearsReceipt,
      reactions,
    );
    const stamp = stampBetween(previous, message);
    return (
      /*
        The date stamp is inside its message's `VirtualView`, so hiding the
        row can't leave a stamp with no message after it.
      */
      <Row
        key={message.id}
        nativeID={`msg-${message.id}`}
        /*
         * `noteMode` while profiling, else undefined: with a listener,
         * `VirtualView` binds a callback on every mode change.
         */
        onModeChange={watching}>
        {stamp != null && (
          <Stamp
            day={stamp.day}
            time={stamp.time}
            arriving={index >= openedWith.current}
          />
        )}
        <Bubble
          message={message}
          metrics={metrics}
          composerFrame={composerFrame}
          contentBox={transcriptContent}
          tail={endsRun ? mineSide(message) : ''}
          startsRun={startsRun}
          endsRun={endsRun}
          separatesRun={separatesRun}
          onCommand={applyCommand}
          onOpenReader={onOpenReader}
          onArrived={rememberArrival}
          onTakeoff={rememberTakeoff}
          onFlightFrame={rememberFlightFrame}
          showsReceipt={
            index === wearsReceipt
              ? 'shown'
              : index === lastSent
                ? 'waiting'
                : index === previousWearer
                  ? 'leaving'
                  : 'none'
          }
          reveal={reveal}
          revealInk={revealInk}
          pan={pan}
          reactions={reactions[message.id]}
        />
      </Row>
    );
  });
});

function Chat({
  onExit,
  seedMessages,
  onOpenReader,
  showsPerformance,
  deliveredAfterMs,
}) {
  // Must run before any profiling counter, including `work.chat++` below.
  setProfiling(showsPerformance === true);
  deliveredAfter = deliveredAfterMs ?? DELIVERED_AFTER;
  const watching = profiling ? noteMode : undefined;
  const {fontScale, width: windowWidth} = useWindowDimensions();
  const headerEdgeEffects = useHeaderEdgeEffects();
  const metrics = useMemo(
    () => balloonMetrics(fontScale, windowWidth),
    [fontScale, windowWidth],
  );
  const scheme = useColorScheme();
  /*
   * Total message count, not extra messages: from the home screen's picker,
   * or from `EXP_SEED_MESSAGES` in UI tests (read in AppDelegate.mm).
   */
  const seed = seedMessages ?? 3;
  const [messages, setMessages] = useState(() => {
    beginWork('open');
    return persistedChat.messages == null || persistedChat.seed !== seed
      ? mockConversation(seed)
      : /*
         * Clear the one-time animation flags, or restored rows would replay
         * their send/receive animation when they mount.
         */
        persistedChat.messages.map(message =>
          message.entering === true || message.arriving === true
            ? {...message, entering: false, arriving: false}
            : message,
        );
  });
  // After `beginWork('open')` above, so this first render counts toward it.
  if (profiling) {
    work.chat++;
  }
  const [draft, setDraft] = useState(() => persistedChat.draft);
  /*
   * `{id, text}` of a sent message whose text the composer keeps showing
   * until its flying balloon is on screen (cleared in `rememberTakeoff`). The
   * animation starts a few frames after the tap, once the sent row has been
   * laid out, and without this the text would disappear for those frames.
   */
  const [handoff, setHandoff] = useState(null);
  /* Read by `Transcript`: all but the newest `OPEN_ROWS` of the messages the
     chat opened with start hidden. */
  const openedWith = useRef(messages.length);
  /*
   * The profiling caption. Drawn over the transcript at `captionTop` (the
   * scroll view's top inset) rather than inside it, so it doesn't change the
   * transcript's layout.
   */
  const [report, setReport] = useState(null);
  const [detail, setDetail] = useState(null);
  const [captionTop, setCaptionTop] = useState(0);
  const committedAt = useRef(null);
  useLayoutEffect(() => {
    committedAt.current = performance.now();
  }, []);
  // Typing doesn't change the transcript's layout, so the sentinel's
  // `onLayout` (in the render) won't end this measurement; end it here.
  useLayoutEffect(() => {
    if (work.event === 'typing') {
      setReport(endWork('typing'));
    }
  }, [draft]);
  /*
   * Message id → array of reaction ids: index 0 is the user's own reaction,
   * the rest other people's. Nothing adds one from the composer any more; the
   * state and the display stay for the long press to fill in.
   */
  const [reactions, setReactions] = useState(
    () => persistedChat.reactions ?? {},
  );
  const transcript = useRef(null);
  const composer = useRef(null);
  /*
   * The composer text field's frame in window coordinates. `width`/`height`
   * come from `onFieldSize`; `y` (top edge) from `onBarTop` and
   * `onInsetChange`. Don't use `measureInWindow` on the field: on iOS it's
   * inside the keyboard accessory and returns the keyboard window's
   * coordinates.
   */
  const composerFrame = useRef(null);
  useEffect(() => {
    persistedChat.messages = messages;
    persistedChat.draft = draft;
    persistedChat.reactions = reactions;
    persistedChat.seed = seed;
  }, [messages, draft, reactions, seed]);
  // Timestamp-reveal drag distance in points (leftward), set by `pan`.
  const reveal = useLazily(() => new Animated.Value(0));
  /*
   * Makes `reveal` native-driven before the first drag: an `Animated.Value`
   * becomes native the first time a native animation drives it. Otherwise
   * every row's timestamp is updated from JavaScript on each drag frame.
   */
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 0,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, [reveal]);
  // Timestamp opacity during the reveal, one node shared by every row. See
  // `revealInkRamp` in reveal.js.
  const revealInk = useLazily(() => reveal.interpolate(revealInkRamp()));
  const pan = useLazily(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (event, gesture) =>
        gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderGrant: () => {
        beginWork('reveal');
        meterFrames(true);
      },
      onPanResponderMove: (event, gesture) => {
        reveal.setValue(resistedReveal(-gesture.dx));
      },
      onPanResponderRelease: () => {
        meterFrames(false);
        if (work.event === 'reveal') {
          setReport(endWork('reveal'));
        }
        Animated.spring(reveal, {
          toValue: 0,
          useNativeDriver: true,
          ...SETTLE_SPRING,
        }).start();
      },
      onPanResponderTerminate: () => {
        reveal.setValue(0);
      },
    }),
  );
  // Lets `applyCommand` read `messages` while keeping a stable identity: it's
  // passed to every memoized row.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const applyCommand = useCallback((messageId, commandId) => {
    if (commandId === 'copy') {
      const message = messagesRef.current.find(m => m.id === messageId);
      if (message != null) {
        Clipboard.setString(message.text);
      }
    }
  }, []);
  const transcriptBox = useRef(null);
  /*
   * Visible transcript height in points, between the header and the
   * composer. `Composer` reads it through `getRoom` to cap its growth. A ref,
   * because it changes every frame of a keyboard drag.
   */
  const room = useRef(null);
  const getRoom = useCallback(() => room.current, []);

  const [typing, setTyping] = useState(null);

  const pendingTimers = useRef([]);
  useEffect(() => () => pendingTimers.current.forEach(clearTimeout), []);
  const receive = useCallback(() => {
    // No `scrollToLatest()` here: a received message must not move a reader
    // who has scrolled up (behaviour 3).
    const who = CAST[messages.length % CAST.length];
    setTyping(who);
    const reply = setTimeout(() => {
      setTyping(null);
      beginWork('receive');
      const base = makeMessage(who, '');
      const message = {
        ...base,
        text: REPLIES[(base.id - 1) % REPLIES.length],
        arriving: true,
      };
      setMessages(current => [...current, message]);
      /*
       * `arriving` starts the received balloon's pop animation. Clear it once
       * the animation is over, or a row that `VirtualView` remounts plays it
       * again.
       */
      const settle = setTimeout(() => {
        setMessages(current =>
          current.map(m => (m.id === message.id ? {...m, arriving: false} : m)),
        );
      }, RECEIVE_POP_MS + 60);
      pendingTimers.current.push(settle);
    }, 1600);
    pendingTimers.current.push(reply);
  }, [messages.length]);

  // Behaviour 5: starting to compose — tapping the field — scrolls to the
  // newest message, as in native Messages. Focus the field merely gets back,
  // from the `+` card or another app, leaves the reader where they are.
  const compose = useCallback(() => {
    transcript.current?.scrollToLatest();
  }, []);

  /*
   * Ids of sent messages whose send animation has finished. The receipt
   * loop below doesn't give a message its receipt before then: adding the
   * receipt line during the animation would grow the row and move the rows
   * above it.
   */
  const [landed, setLanded] = useState(() => new Set());
  /**
   * Called through `onTakeoff` when the message's balloon is first visible.
   * The composer stops showing the sent text and accepts input again.
   */
  const rememberTakeoff = useCallback(id => {
    sending.current = false;
    setHandoff(previous => (previous?.id === id ? null : previous));
  }, []);

  // One entry per flying balloon: added in `rememberFlightFrame`, hidden in
  // `rememberArrival`, removed in `rememberSettled`.
  const [flying, setFlying] = useState([]);
  const flyingRef = useRef([]);
  flyingRef.current = flying;
  // JS copies of the latest `onScroll` content offset and `onBarTop` values
  // (bar top in window points, and height). The native-driven values in
  // `drawn` can't be read from JS.
  const lastOffsetY = useRef(null);
  const lastBarTop = useRef(null);
  const lastBarHeight = useRef(null);
  /*
   * Native-driven inputs for positioning flying balloons: the composer bar's
   * top and height (from `ComposerBar`'s dock event) and the transcript's
   * scroll offset (from `onScroll`). Both move during the keyboard animation.
   * JS event handlers would receive them at different delays (the bar can
   * move 79 pt in one frame while the offset doesn't move), so the balloon
   * would jump. Driven natively, they update before the frame is drawn. See
   * ui-metrics.md, "Bar travel in the keyboard's first frame".
   *
   * Needs `extractValue` for these event paths in `ExpoScrollEvent` and
   * `ExpoKeyboardDockEvent` (C++).
   */
  const drawn = useLazily(() => ({
    barTop: new Animated.Value(0),
    barHeight: new Animated.Value(0),
    offsetY: new Animated.Value(0),
  }));
  // Window y of the composer bar's bottom edge. `flightLayer` sits there.
  const barBottom = useLazily(() =>
    Animated.add(drawn.barTop, drawn.barHeight),
  );
  // Drives `drawn.offsetY` natively, so each flying balloon's `trackY`
  // follows scrolling in the same frame. The listener updates `lastOffsetY`.
  const onTranscriptScroll = useLazily(() =>
    Animated.event([{nativeEvent: {contentOffset: {y: drawn.offsetY}}}], {
      useNativeDriver: true,
      listener: event => {
        const y = event.nativeEvent.contentOffset?.y;
        if (typeof y === 'number') {
          lastOffsetY.current = y;
        }
      },
    }),
  );
  /**
   * JS estimate of the text field's top edge (window y, points) from the last
   * `onBarTop`; can be a frame stale. Only used by `journeyNow`. The native
   * equivalent is `fieldTop` in `rememberFlightFrame`.
   */
  const fieldTopNow = useCallback(
    anchorY =>
      lastBarTop.current != null && lastBarHeight.current != null
        ? lastBarTop.current + lastBarHeight.current + toPixel(anchorY)
        : null,
    [],
  );
  /*
   * Tapping send makes the keyboard apply a pending autocorrection, so the
   * field's text can differ from `draft` at that moment. Send `fieldText`
   * (what's on screen). `sending` stops that late correction from being
   * written back into `draft`.
   */
  const fieldText = useRef('');
  const sending = useRef(false);
  /*
   * True from a send until its balloon animation finishes (`rememberArrival`).
   * `sendNow` ignores sends while it's set. `sending` is shorter: it ends
   * when the balloon first appears.
   */
  const inFlight = useRef(false);
  const flightLayer = useRef(null);
  const composerBox = useRef(null);
  const field = useRef(null);
  const transcriptContent = useRef(null);
  // The transcript's window position, size and insets (points), from
  // `onInsetChange`. Read by `endOfFlight`.
  const geometry = useRef({
    x: 0,
    y: 0,
    containerH: 0,
    insetTop: 0,
    insetBottom: 0,
  });

  // The text field's height with an empty draft, from `onFieldSize`. Used to
  // predict the composer shrinking after a send.
  const restingField = useRef(0);
  /*
   * A ref, not state: re-rendering the rows at the start of every drag breaks
   * interactive keyboard dismissal. `sendNow` ignores taps while it's set.
   */
  const dragging = useRef(false);
  /*
   * Ids that have already started a flying balloon. The sent row can call
   * `rememberFlightFrame` again after `rememberArrival` (its loop stops one
   * render later); without this check that call would start a second
   * animation.
   */
  const flown = useRef(new Set());
  /*
   * Predicts the sent balloon's window position once the send's layout
   * changes finish: the composer shrinks back to `restingField`, the content
   * grows by the new row, and the scroll view rests at its end. `frame` is
   * the balloon's box in content coordinates. Returns null before the first
   * `onInsetChange`.
   *
   * Only `x` positions the flying balloon. `y` is used for the trace line and
   * as `journeyNow`'s fallback; the vertical target is `trackY`.
   */
  const endOfFlight = useCallback(frame => {
    const view = geometry.current;
    if (!(view.containerH > 0)) {
      return null;
    }
    const pill = composerFrame.current?.height ?? 0;
    const collapse =
      restingField.current > 0 && pill > restingField.current
        ? pill - restingField.current
        : 0;
    const insetBottom = Math.max(0, view.insetBottom - collapse);
    const top = frame.y;
    /*
     * Must match the styles below the balloon: the row's bottom padding
     * (`ROW_AIR` in `styles.rowEndsRunLeaving`) and the content's
     * (`TRANSCRIPT_BOTTOM_PAD`). The new row is last, so it never gets
     * `styles.rowEndsRun`'s larger gap (`separatesRun` needs a next row).
     */
    const contentBottom = top + frame.height + ROW_AIR + TRANSCRIPT_BOTTOM_PAD;
    /*
     * Use the larger of the scroll view's `restOffset` and this estimate.
     * `restOffset` may not include the new row yet when the row is measured,
     * and adding a row only increases it. See ui-metrics.md, "Send end-state
     * model".
     */
    const modelled = Math.max(
      -view.insetTop,
      contentBottom - view.containerH + insetBottom,
    );
    const offset =
      typeof view.restOffset === 'number'
        ? Math.max(view.restOffset, modelled)
        : modelled;
    return {x: view.x + frame.x, y: view.y + top - offset};
  }, []);

  const rememberFlightFrame = useCallback(
    (id, frame) => {
      if (flown.current.has(id)) {
        /*
         * Later calls, during the animation: the row may have moved in the
         * content, so update the target. `bias` is the row's measured window y
         * minus the computed one (content y − offset); they differ slightly
         * when the transcript is shorter than the viewport.
         */
        for (const entry of flyingRef.current) {
          if (entry.id === id) {
            if (frame.windowY != null && lastOffsetY.current != null) {
              entry.bias =
                frame.windowY -
                (geometry.current.y + frame.y - lastOffsetY.current);
            }
            entry.base?.setValue(
              geometry.current.y + frame.y + (entry.bias ?? 0),
            );
          }
        }
        return;
      }
      const end = endOfFlight(frame);
      if (end == null) {
        return;
      }
      const drawnY = end.y;
      // `aimed y=` is `endOfFlight`'s predicted window y, not the animation's
      // target (`trackY`).
      RenderStats?.trace(
        `flight ${String(id).slice(-6)} aimed y=${drawnY.toFixed(2)} (view.y=${geometry.current.y.toFixed(2)} top=${frame.y.toFixed(2)} h=${frame.height.toFixed(2)} rest=${String(geometry.current.restOffset)})`,
      );
      /*
       * `anchor` is the text field's offset from `flightLayer`, both measured
       * against `composerBox`. Use `measureLayout`: on iOS, `measureInWindow`
       * inside the keyboard accessory returns where the bar was laid out, not
       * where it is drawn.
       */
      const start = anchor => {
        /*
         * The flying balloon's target: the row's current window y (content y
         * minus scroll offset, subtracted natively). Not `endOfFlight`'s
         * predicted y: the transcript can still be scrolling when the
         * animation ends.
         */
        const base = new Animated.Value(geometry.current.y + frame.y);
        const trackY = Animated.subtract(base, drawn.offsetY);
        /*
         * The flying balloon's start: the text field's top in window y. Don't
         * round the sum to pixels: `FlyingBalloon` lays the balloon out at
         * `toPixel(anchor.y)` from the unrounded `barBottom`, and the distance
         * must be measured from that same point.
         */
        const fieldTop = Animated.add(barBottom, toPixel(anchor.y));
        /*
         * Seed the native-driven values from the last JS events. An
         * event-driven value keeps its last value until the next event (0 if
         * there was none), which would put the first frame's target at the
         * top of the window. A value one frame old is fine: the animation
         * waits `THROW_DELAY` before it moves.
         */
        if (lastBarTop.current != null) {
          drawn.barTop.setValue(lastBarTop.current);
        }
        if (lastBarHeight.current != null) {
          drawn.barHeight.setValue(lastBarHeight.current);
        }
        if (lastOffsetY.current != null) {
          drawn.offsetY.setValue(lastOffsetY.current);
        }
        // Start-to-target distance in points, computed in JS because native
        // values can't be read back. Scales `ARRIVAL_TOLERANCE`; not used for
        // positioning.
        const journeyNow = () => {
          const top = fieldTopNow(anchor.y);
          if (top == null || lastOffsetY.current == null) {
            return Math.abs(drawnY - (composerFrame.current?.y ?? 0));
          }
          return Math.abs(base.__getValue() - lastOffsetY.current - top);
        };
        flown.current.add(id);
        setFlying(previous =>
          previous.some(entry => entry.id === id)
            ? previous
            : [
                ...previous,
                {
                  id,
                  frame: {...frame, x: end.x, y: drawnY},
                  anchor,
                  base,
                  trackY,
                  fieldTop,
                  journeyNow,
                  // Uses the text field's height before it shrinks back.
                  trough: squashTrough(
                    composerFrame.current?.height,
                    restingField.current,
                  ),
                },
              ],
        );
      };
      const box = composerBox.current;
      const missed = () => start({x: 0, y: 0});
      if (
        box == null ||
        field.current?.measureLayout == null ||
        flightLayer.current?.measureLayout == null
      ) {
        missed();
        return;
      }
      field.current.measureLayout(
        box,
        (fieldX, fieldY, fieldWidth) => {
          if (!(fieldWidth > 0) || flightLayer.current?.measureLayout == null) {
            missed();
            return;
          }
          flightLayer.current.measureLayout(
            box,
            (layerX, layerY) => start({x: fieldX - layerX, y: fieldY - layerY}),
            missed,
          );
        },
        missed,
      );
    },
    [barBottom, drawn, endOfFlight, fieldTopNow],
  );

  // Called through `onArrived` when the send animation finishes (or when a
  // row appears without one).
  const rememberArrival = useCallback(id => {
    setLanded(previous => new Set(previous).add(id));
    // Hide the flying balloon in the same commit that shows the row
    // (`entering: false` below), so the message is never drawn twice or not
    // at all. `rememberSettled` unmounts it a frame later.
    setFlying(previous =>
      previous.map(entry =>
        entry.id === id && !entry.landed ? {...entry, landed: true} : entry,
      ),
    );
    // `rememberTakeoff` normally cleared these already; this is a fallback.
    sending.current = false;
    inFlight.current = false;
    setHandoff(previous => (previous?.id === id ? null : previous));
    // Clear `entering`, or a row that `VirtualView` unmounts and remounts
    // plays the send animation again.
    setMessages(previous =>
      previous.map(message =>
        message.id === id && message.entering === true
          ? {...message, entering: false}
          : message,
      ),
    );
  }, []);

  /**
   * Called through `onSettled` a frame after the flying balloon is hidden.
   * See `FlyingBalloon` for why hiding and unmounting are separate commits.
   */
  const rememberSettled = useCallback(id => {
    setFlying(previous => previous.filter(entry => entry.id !== id));
  }, []);

  /*
   * Accessibility label read by `SendMorphCheck.swift`: the last send
   * animation's narrowest, widest and final balloon width, in points.
   * XCUITest can't observe the animation (`tap()` returns only after the app
   * is idle). Not hidden from VoiceOver: `accessibilityElementsHidden` would
   * hide it from XCUITest too.
   */
  const [flightTrace, setFlightTrace] = useState(null);
  const rememberFlight = useCallback(({low, high, resting}) => {
    setFlightTrace(
      `flight ${low.toFixed(1)} ${high.toFixed(1)} ${resting.toFixed(1)}`,
    );
  }, []);

  /*
   * Which rows show a receipt (`Transcript` turns these into `showsReceipt`):
   * - `lastSent`: the newest sent message. Its receipt stays mounted at zero
   *   height ('waiting') until it is shown.
   * - `wearsReceipt`: the newest sent message that has a `status` and whose
   *   send animation has finished; shows the receipt.
   * - `previousWearer`: the next older such message; its receipt goes away.
   * Requiring a `status` keeps the previous receipt on screen until the new
   * message is `Delivered`, as in native Messages. See ui-metrics.md,
   * "Previous receipt through a send".
   */
  let lastSent = -1;
  let wearsReceipt = -1;
  let previousWearer = -1;
  for (let i = messages.length - 1; i >= 0 && previousWearer < 0; i--) {
    const candidate = messages[i];
    if (candidate.from !== 'me') {
      continue;
    }
    if (lastSent < 0) {
      lastSent = i;
    }
    const ready =
      candidate.status != null &&
      (candidate.entering !== true || landed.has(candidate.id));
    if (!ready) {
      continue;
    }
    if (wearsReceipt < 0) {
      wearsReceipt = i;
    } else {
      previousWearer = i;
    }
  }

  /** Sends `text` unchecked; `sendNow` checks `dragging` and `inFlight`. */
  const deliver = useCallback(text => {
    // A ref, set right away: the autocorrection's input event can be handled
    // in the same batch as this call (see `sending`).
    sending.current = true;
    fieldText.current = '';
    // Fallback reset, in case the sent row never mounts to call
    // `rememberTakeoff` or `rememberArrival`.
    pendingTimers.current.push(
      setTimeout(() => {
        sending.current = false;
      }, SENDING_FLOOR_MS),
    );
    // Cleared in `rememberArrival`, with the same fallback so a lost
    // animation can't block sending.
    inFlight.current = true;
    pendingTimers.current.push(
      setTimeout(() => {
        inFlight.current = false;
      }, SENDING_FLOOR_MS),
    );
    const sent = makeMessage('me', text, true);
    beginWork('send');
    setMessages(previous => [...previous, sent]);
    setDraft('');
    // Show the trimmed text that was sent, not the typed draft: with leading
    // spaces the text would jump left when the balloon replaces it.
    setHandoff({id: sent.id, text});
    // `change` is a function so `Date.now()` for `readAt` runs when the timer
    // fires.
    const mark = (after, change) =>
      pendingTimers.current.push(
        setTimeout(() => {
          setMessages(previous =>
            previous.map(message =>
              message.id === sent.id ? {...message, ...change()} : message,
            ),
          );
        }, after),
      );
    mark(deliveredAfter, () => ({status: 'Delivered'}));
    mark(deliveredAfter + READ_AFTER_DELIVERED, () => ({
      status: 'Read',
      readAt: Date.now(),
    }));
    // Behaviour 4: sending scrolls to the newest message, wherever the reader
    // was. `contentAnchor` doesn't do this.
    transcript.current?.scrollToLatest();
  }, []);

  // Keeps `fieldText` in step with `draft` for changes that don't come from
  // typing: a restored draft, and the clear after a send.
  useEffect(() => {
    fieldText.current = draft;
  }, [draft]);

  const sendNow = useCallback(() => {
    const text = (fieldText.current ?? '').trim();
    if (text === '') {
      return;
    }
    /*
     * Ignore sends during a transcript drag, as native Messages does:
     * inserting a row would move the content under the finger. Drop the send
     * rather than holding it until the drag ends; holding would clear the
     * field on tap and show the text again when the finger lifts.
     */
    if (dragging.current) {
      return;
    }
    /*
     * Ignore sends until the previous send animation finishes, as native
     * Messages does (its button stays enabled). The button isn't disabled
     * here either: that needs state, and a state change per send re-renders
     * the transcript.
     */
    if (inFlight.current) {
      return;
    }
    deliver(text);
  }, [deliver]);

  const send = useCallback(() => {
    /*
     * Wait one task. Tapping send makes the keyboard apply a pending
     * autocorrection, and that edit reaches JS after the tap event. Reading
     * `fieldText` now would send the uncorrected text. See ui-metrics.md,
     * "Autocorrection after the send tap".
     */
    setTimeout(sendNow, 0);
  }, [sendNow]);

  const actions = [
    {
      id: 'receive',
      symbol: 'envelope',
      tint: 'systemGreen',
      label: 'Receive a message',
      onPress: receive,
    },
    {
      id: 'fill',
      symbol: 'text.line.first.and.arrowtriangle.forward',
      tint: 'systemIndigo',
      label: 'Add fifty messages',
      onPress: () =>
        setMessages(previous => [
          ...previous,
          ...mockConversation(previous.length + 50).slice(previous.length),
        ]),
    },
    {
      id: 'edit',
      symbol: 'pencil',
      tint: 'systemOrange',
      label: 'Edit last message',
      onPress: () =>
        setMessages(previous => {
          const index = previous.reduce(
            (found, message, at) => (message.from === 'me' ? at : found),
            -1,
          );
          if (index < 0) {
            return previous;
          }
          const next = [...previous];
          next[index] = {
            ...next[index],
            text: next[index].text + ' Actually, two lines.',
            edited: true,
          };
          return next;
        }),
    },
    {
      id: 'earlier',
      symbol: 'arrow.up.to.line',
      tint: 'systemBrown',
      label: 'Load earlier messages',
      /*
       * Prepending must not move what the reader sees. With
       * `contentAnchor="bottom"`, the scroll view corrects its offset (iOS:
       * `-mountingTransactionWillMount:` in EXPScrollViewComponentView.mm).
       * Tested by `AnchorCheck.swift`.
       */
      onPress: () =>
        setMessages(previous => [
          ...Array.from({length: 20}, (_, index) => ({
            ...makeMessage(
              CAST[index % CAST.length],
              `Earlier message ${index + 1}.`,
            ),
            at: (previous[0]?.at ?? Date.now()) - (20 - index) * 60_000,
          })),
          ...previous,
        ]),
    },
    {
      id: 'latest',
      symbol: 'arrow.down',
      tint: 'systemTeal',
      label: 'Go to the newest',
      onPress: () => transcript.current?.scrollToLatest(),
    },
    {
      id: 'top',
      symbol: 'arrow.up',
      tint: 'systemPurple',
      label: 'Go to the earliest',
      onPress: () => transcript.current?.scrollToTop(),
    },
    {
      id: 'hide',
      symbol: 'keyboard',
      tint: 'systemBlue',
      label: 'Dismiss the keyboard',
      onPress: () => composer.current?.blur(),
    },
    {
      id: 'reset',
      symbol: 'arrow.counterclockwise',
      label: 'Start over',
      destructive: true,
      onPress: () => {
        setMessages(mockConversation(seed));
        setReactions({});
      },
    },
  ];
  if (onExit != null) {
    actions.unshift({
      id: 'back',
      symbol: 'chevron.left',
      tint: 'systemGray',
      label: 'Back',
      onPress: onExit,
    });
  }

  return (
    <div style={styles.screen}>
      {report != null && (
        <p
          style={[styles.loadReport, {top: captionTop}]}
          onClick={() => {
            if (detail == null) {
              setDetail(detailReport());
              return;
            }
            Clipboard.setString(`${report}\n${detail}`);
            setDetail(null);
            setReport(null);
          }}>
          {detail == null ? report : `${report}\n${detail}`}
          {detail == null ? '\n(tap for detail)' : '\n(tap to copy)'}
        </p>
      )}
      {flightTrace != null && (
        /*
         * `accessible` is required: without it, `aria-label` on a childless
         * `<div>` isn't exposed to accessibility and `SendMorphCheck.swift`
         * can't find it.
         */
        <div accessible={true} aria-label={flightTrace} style={styles.trace} />
      )}
      <AnimatedTranscript
        edgeEffects={headerEdgeEffects}
        /*
         * The side safe areas are padding in `styles.transcriptContent`, so
         * the rows' side margins start inside the safe area. Automatic side
         * insets would add to that padding and allow sideways scrolling. Top
         * and bottom insets stay automatic.
         */
        automaticInsets={{left: false, right: false}}
        ref={element => {
          transcript.current = element;
          transcriptBox.current = element;
        }}
        contentRef={transcriptContent}
        onInsetChange={event => {
          const {inset, containerSize} = event.nativeEvent;
          geometry.current = {
            ...geometry.current,
            containerH: containerSize.height,
            insetTop: inset.top,
            insetBottom: inset.bottom,
            restOffset: event.nativeEvent.restOffset,
          };
          setCaptionTop(inset.top);
          room.current = Math.max(
            0,
            containerSize.height - inset.top - inset.bottom,
          );
          // The bottom inset equals the composer bar's height, so the bar's
          // top (for `composerFrame.y`) is the transcript's bottom minus it.
          transcriptBox.current?.measureInWindow?.((x, y, width, height) => {
            if (height > 0) {
              geometry.current = {...geometry.current, x, y};
              composerFrame.current = {
                ...composerFrame.current,
                y: y + height - inset.bottom + BAR_TOP_PADDING,
              };
            }
          });
        }}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        /*
         * No finger scrolling while a balloon is flying, as in native
         * Messages, so the target row can't be dragged away. `scrollToLatest`
         * still scrolls, and `trackY` follows it.
         */
        scrollEnabled={flying.length === 0}
        onScroll={onTranscriptScroll}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onScrollEndDrag={() => {
          dragging.current = false;
        }}
        onMomentumScrollBegin={() => {
          if (settleTimer != null) {
            clearTimeout(settleTimer);
            settleTimer = null;
          }
          beginWork('scroll');
          meterFrames(true);
        }}
        // Keep measuring for `SCROLL_SETTLE_MS` after the fling stops, so the
        // report includes rows that render after it.
        onMomentumScrollEnd={() => {
          if (settleTimer != null) {
            clearTimeout(settleTimer);
          }
          settleTimer = setTimeout(() => {
            settleTimer = null;
            meterFrames(false);
            if (work.event === 'scroll') {
              setDetail(null);
              setReport(endWork('scroll'));
            }
          }, SCROLL_SETTLE_MS);
        }}
        contentAnchor="bottom">
        {/*
          `pan` goes on each row, not on the scroll view: a responder on the
          scroll view would take over its own pan gesture and stop scrolling.
          `pan` only claims horizontal drags.
        */}
        <Transcript
          applyCommand={applyCommand}
          composerFrame={composerFrame}
          lastSent={lastSent}
          messages={messages}
          metrics={metrics}
          onOpenReader={onOpenReader}
          openedWith={openedWith}
          pan={pan}
          previousWearer={previousWearer}
          reactions={reactions}
          rememberArrival={rememberArrival}
          rememberFlightFrame={rememberFlightFrame}
          rememberTakeoff={rememberTakeoff}
          reveal={reveal}
          revealInk={revealInk}
          transcriptContent={transcriptContent}
          watching={watching}
          wearsReceipt={wearsReceipt}
        />
        {typing != null && <TypingIndicator from={typing} />}
        {/*
          Its `onLayout` fires once new rows are laid out, which ends the open,
          send and receive measurements.
        */}
        <div
          style={styles.sentinel}
          onLayout={() => {
            if (work.event === 'open') {
              setReport(
                endWork(
                  `${messages.length} messages, ` +
                    `${Math.min(messages.length, OPEN_ROWS)} rows rendered, ` +
                    `rendered in ${Math.round(committedAt.current - work.since)} ms`,
                ),
              );
            } else if (work.event === 'send' || work.event === 'receive') {
              setReport(endWork(work.event));
            }
          }}
        />
      </AnimatedTranscript>

      <ComposerBar
        flightLayerRef={flightLayer}
        boxRef={composerBox}
        onBarTop={(top, height) => {
          lastBarTop.current = top;
          lastBarHeight.current = height;
          composerFrame.current = {
            ...composerFrame.current,
            y: top + BAR_TOP_PADDING,
          };
        }}
        barTopValue={drawn.barTop}
        barHeightValue={drawn.barHeight}
        /*
         * Flying balloons render in `ComposerBar`'s `flightLayer`, beneath the
         * bar's background and text field, so each appears from under the
         * field. See `FlyingBalloon`.
         */
        overlay={flying.map(entry => {
          const message = messages.find(candidate => candidate.id === entry.id);
          const origin = composerFrame.current;
          if (message == null || origin == null) {
            return null;
          }
          return (
            <FlyingBalloon
              key={entry.id}
              message={message}
              mine={mineSide(message) !== ''}
              tail={mineSide(message)}
              metrics={metrics}
              scheme={scheme}
              to={entry.frame}
              trackY={entry.trackY}
              journeyNow={entry.journeyNow}
              anchor={entry.anchor}
              fieldTop={entry.fieldTop}
              fieldWidth={origin.width ?? entry.frame.width}
              trough={entry.trough}
              landed={entry.landed === true}
              onTakeoff={rememberTakeoff}
              onArrived={rememberArrival}
              onSettled={rememberSettled}
              onFlight={rememberFlight}
            />
          );
        })}>
        <Composer
          autoFocus={draft !== ''}
          value={draft}
          /*
           * While sending, the text field delays the keyboard rebuild that
           * clearing it triggers (see `quiet` in Composer.js). See
           * ui-metrics.md, "Keyboard rebuild during a send". Starts at the tap
           * (`handoff`), not when the balloon appears: the field's first
           * update of a send happens in the tap's commit.
           */
          quiet={handoff != null || flying.length > 0}
          handoff={handoff?.text}
          onChangeText={text => {
            if (sending.current) {
              return;
            }
            fieldText.current = text;
            beginWork('typing');
            setDraft(text);
          }}
          onSend={send}
          onComposeStart={compose}
          inputRef={composer}
          onFieldSize={size => {
            composerFrame.current = {...composerFrame.current, ...size};
            if (draft === '' && size.height > 0) {
              restingField.current = size.height;
            }
          }}
          fieldRef={field}
          actions={actions}
          getRoom={getRoom}
        />
      </ComposerBar>
    </div>
  );
}

const styles = StyleSheet.create({
  /*
   * A `<div>` is block layout by default, not flex as a `View` is, and block
   * layout ignores `flexDirection`, `gap` and `justifyContent`. So every flex
   * container here sets `display: 'flex'`.
   */

  trace: {position: 'absolute', top: 0, left: 0, width: 1, height: 1},
  sentinel: {height: 0},
  loadReport: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1,
    marginTop: 8,
    padding: 6,
    borderRadius: 8,
    fontSize: 11,
    textAlign: 'center',
    // Keeps the report's `\n` line breaks; `<p>` collapses them by default.
    whiteSpace: 'pre-line',
    fontVariant: ['tabular-nums'],
    color: uiColor('secondaryLabel'),
    backgroundColor: uiColor('secondarySystemBackground'),
  },
  screen: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    backgroundColor: systemColor('Canvas'),
  },
  transcript: {flex: 1},
  transcriptContent: {
    /*
     * The side safe areas are reserved here, as padding, so the rows lay out
     * in the narrower column. Keep in sync with the transcript's
     * `automaticInsets`, which turns off the scroll view's own left and right
     * insets. The side margin is added on `row` instead of here because this
     * renderer computes `env()` inside `calc()` to nothing.
     */
    paddingLeft: env('safe-area-inset-left'),
    paddingRight: env('safe-area-inset-right'),
    // Native Messages' space above the first message. See ui-metrics.md,
    // "Transcript end padding".
    paddingTop: 15.667,
    paddingBottom: TRANSCRIPT_BOTTOM_PAD,
  },
  row: {
    display: 'flex',
    /*
     * Must equal `COMPOSER_MARGIN_TRAILING` (Composer.js): the flying balloon
     * starts over the composer field and keeps the field's right edge until
     * it reaches its row.
     */
    paddingHorizontal: TRANSCRIPT_MARGIN,
    paddingTop: ROW_AIR,
    paddingBottom: ROW_AIR,
    flexDirection: 'row',
  },
  revealColumn: {
    position: 'absolute',
    right: -REVEAL_LINE_OFFSET,
    top: 0,
    bottom: 0,
    width: REVEAL_BOX_WIDTH,
    display: 'flex',
    alignItems: 'center',
    /*
     * Right-aligned, so every time ends on the transcript margin, as in native
     * Messages. `REVEAL_BOX_WIDTH` includes this padding; keep the two in
     * sync. See ui-metrics.md, "Timestamp reveal column".
     */
    justifyContent: 'flex-end',
    paddingRight: TRANSCRIPT_MARGIN - REVEAL_COLUMN_LANDING,
  },
  /*
   * On iOS, `NativeChatBubble` adds `CHAT_BUBBLE_TAIL_DROP` of bottom padding
   * under a balloon with a tail. Stopping above it centres the time on the
   * balloon's body.
   */
  revealColumnTailed: {
    bottom: CHAT_BUBBLE_DRAWS_TAIL ? CHAT_BUBBLE_TAIL_DROP : 0,
  },
  revealTime: {
    // Flex items shrink by default here, unlike in React Native, and a shrunk
    // time wraps onto two lines.
    flexShrink: 0,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    color: uiColor('secondaryLabel'),
    whiteSpace: 'nowrap',
    marginBlock: 0,
  },
  /*
   * The receipt styles use CSS transitions, not animations: an animation runs
   * again whenever the row remounts, such as when it scrolls back into view.
   * A transition runs only when the style changes.
   */
  receiptSpace: {
    overflow: 'hidden',
    alignItems: 'flex-end',
    transitionProperty: 'height',
    // The balloon tail's duration: the tail and this space change height
    // together, and different durations would move the transcript twice
    transitionDuration: `${RECEIPT_LAYOUT_MS}ms`,
    transitionTimingFunction: RECEIPT_LAYOUT_CURVE,
  },
  moreChevronMine: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 15,
    fontWeight: '600',
  },
  moreChevronTheirs: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    color: 'rgba(60, 60, 67, 0.6)',
    fontSize: 15,
    fontWeight: '600',
  },
  receiptSpaceClosed: {height: 0},
  /*
   * Not clipped, unlike `receiptSpace`: a box animating to height 0 clips its
   * content from the first frame, which would cut the old receipt off instead
   * of letting it fade. `RECEIPT_LEAVE_MS` is shorter than `RECEIPT_LAYOUT_MS`
   * (asserted in `__tests__/receiptTiming-test.js`), so the text has faded
   * before this box has closed.
   */
  receiptSpaceLeaving: {
    height: 0,
    overflow: 'visible',
  },
  // Fades at full size: native Messages doesn't shrink a leaving receipt.
  receiptInkLeaving: {
    opacity: 0,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity',
    transitionDuration: `${RECEIPT_LEAVE_MS}ms`,
    transitionTimingFunction: 'ease-out',
  },
  receiptInkWaiting: {
    opacity: 0,
    transform: [{scale: RECEIPT_GROW_FROM}],
    // Native Messages grows the receipt about its centre. See ui-metrics.md,
    // "Receipt arrival".
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${RECEIPT_FADE_MS}ms, ${RECEIPT_GROW_MS}ms`,
    transitionTimingFunction: `ease-out, ${RECEIPT_GROW_CURVE}`,
  },
  receiptInkShown: {
    opacity: 1,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${RECEIPT_FADE_MS}ms, ${RECEIPT_GROW_MS}ms`,
    transitionDelay: `${RECEIPT_INK_DELAY_MS}ms`,
    transitionTimingFunction: `ease-out, ${RECEIPT_GROW_CURVE}`,
  },
  receiptInkFading: {
    opacity: 0,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity',
    transitionDuration: `${RECEIPT_SWAP_OUT_MS}ms`,
    transitionTimingFunction: 'ease-in-out',
  },
  receiptInkSwapped: {
    opacity: 1,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity',
    transitionDuration: `${RECEIPT_SWAP_IN_MS}ms`,
    transitionTimingFunction: 'ease-out',
  },
  // Scales about its bottom-right corner: native Messages keeps a sent
  // balloon's right edge and tail still while its size animates.
  flier: {position: 'absolute', transformOrigin: '100% 100%'},
  flierLanded: {opacity: 0},
  rowWaiting: {opacity: 0},
  rowReady: {opacity: 1},
  /*
   * The gap after a run. Only `rowEndsRunLeaving` has a transition, and CSS
   * uses the transition of the style being changed to, so the gap appears at
   * once and only animates away. It appears in the same commit as a new
   * message, where an animation would move the rows under a send's flying
   * balloon.
   */
  rowEndsRun: {paddingBottom: 8},
  rowEndsRunLeaving: {
    paddingBottom: ROW_AIR,
    transitionProperty: 'padding-bottom',
    transitionDuration: `${RECEIPT_LAYOUT_MS}ms`,
    transitionTimingFunction: RECEIPT_LAYOUT_CURVE,
  },
  rowMine: {justifyContent: 'flex-end'},
  rowTheirs: {justifyContent: 'flex-start'},
  /*
   * No `maxWidth` here: the row passes one from `balloonMetrics` to the
   * balloon and its text. A balloon fits its text only when the text has a
   * numeric width cap; with `flexShrink` instead, every balloon stands at the
   * width limit.
   */
  bubble: {
    paddingHorizontal: BUBBLE_PADDING,
    paddingVertical: BUBBLE_PADDING_V,
    /*
     * Native Messages' minimum; `BalloonShapeCheck.swift` checks it. It also
     * keeps the tail span in `EXPChatBubblePath.mm`,
     * `MIN(EXPChatBubbleTailSpan, w - r)`, unclamped: a clamped span notches
     * the tail's outline. See ui-metrics.md, "Balloon minimum width".
     */
    minWidth: BUBBLE_MIN_WIDTH,
    /*
     * Centres the text in a balloon held wider by `minWidth`. `textAlign`
     * would also centre the short lines of a wrapped message.
     * `justifyContent` because the CSS default `flexDirection` is `row`.
     */
    display: 'flex',
    justifyContent: 'center',
    // `NativeChatBubble`'s surface is absolutely positioned against this box.
    position: 'relative',
  },
  // 78.5 is the native indicator's width; 43 is `typingSmall`'s bottom
  // (38 + 5). See ui-metrics.md, "Typing indicator".
  typingCluster: {
    position: 'relative',
    width: 78.5,
    height: TYPING_SMALL_TOP + TYPING_SMALL,
    animationKeyframes: TYPING_BREATH_FRAMES,
    animationDuration: `${TYPING_PULSE}ms`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  typingEntry: {
    animationKeyframes: TYPING_GROW_FRAMES,
    animationDelay: `${TYPING_GROW_DELAY}ms`,
    animationDuration: `${TYPING_GROW}ms`,
    animationTimingFunction: 'ease-out',
    transformOrigin: 'left center',
  },
  /*
   * `left` 14 here, 7 in `typingMedium` and 2 in `typingSmall`, and
   * `TYPING_SMALL_TOP`, are the native bubbles' offsets. See ui-metrics.md,
   * "Typing indicator".
   */
  typingBubble: {
    position: 'absolute',
    left: 14,
    top: 0,
    width: TYPING_BUBBLE_W,
    height: TYPING_BUBBLE_H,
    borderRadius: TYPING_BUBBLE_H / 2,
    backgroundColor: BUBBLE_GREY,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingMedium: {
    position: 'absolute',
    left: 7,
    top: TYPING_BUBBLE_H - TYPING_MEDIUM / 2 - 2,
    width: TYPING_MEDIUM,
    height: TYPING_MEDIUM,
    borderRadius: TYPING_MEDIUM / 2,
    backgroundColor: BUBBLE_GREY,
  },
  typingSmall: {
    position: 'absolute',
    left: 2,
    top: TYPING_SMALL_TOP,
    width: TYPING_SMALL,
    height: TYPING_SMALL,
    borderRadius: TYPING_SMALL / 2,
    backgroundColor: BUBBLE_GREY,
  },
  typingDots: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: TYPING_DOT_GAP,
  },
  dot: {
    width: TYPING_DOT,
    height: TYPING_DOT,
    borderRadius: TYPING_DOT / 2,
    animationKeyframes: TYPING_BEAT_FRAMES,
    animationDuration: `${TYPING_BEAT}ms`,
    // Native Messages' dot curve. See ui-metrics.md, "Typing indicator".
    animationTimingFunction: 'cubic-bezier(0.75673, 0.015306, 0.58, 1)',
    animationDirection: 'alternate',
    animationIterationCount: 'infinite',
    // The first stop of the beat: what shows during each dot's `animationDelay`
    opacity: TYPING_BEAT_STOPS[0].opacity,
    /*
     * Black (white in dark mode) at the animated opacity, as native Messages
     * draws the dot, rather than an opaque grey. See ui-metrics.md, "Typing
     * dot colour".
     */
    backgroundColor: uiColor('label'),
  },
  /*
   * Positions `balloonGradient` against the screen, not the balloon, so a sent
   * balloon's colour depends on where it is on screen, as in native Messages.
   */
  mineBalloon: {experimental_backgroundAttachmentFixed: true},
  theirsBalloon: {backgroundColor: BUBBLE_GREY},
  mineText: {
    color: '#ffffff',
    fontSize: MESSAGE_FONT_SIZE,
    marginBlock: 0,
  },
  theirsText: {
    color: systemColor('CanvasText'),
    fontSize: MESSAGE_FONT_SIZE,
    marginBlock: 0,
  },
  receipt: {
    // Native Messages' receipt size. See ui-metrics.md, "Receipt text size".
    fontSize: 11,
    marginBlock: 0,
    /*
     * -1 because the line box has leading above the text, and native Messages
     * draws the text closer to the balloon than that allows.
     * `ReceiptCheck.swift` hard-codes this -1: it expects the receipt's box
     * 5.65 pt below the balloon's body. See ui-metrics.md, "Receipt vertical
     * position".
     */
    marginTop: -1 + RECEIPT_AIR,
    marginRight: RECEIPT_INSET,
    fontVariant: ['tabular-nums'],
    color: uiColor('secondaryLabel'),
  },
  receiptStatus: {fontWeight: '600'},
  stamp: {
    // Native Messages' separator size (Caption2). See ui-metrics.md, "Date
    // separator text size".
    fontSize: 11,
    textAlign: 'center',
    marginBlock: 0,
    marginTop: 16,
    marginBottom: 10,
    color: uiColor('secondaryLabel'),
  },
  stampWaiting: {opacity: 0},
  stampShown: {
    opacity: 1,
    transitionProperty: 'opacity',
    transitionDuration: `${STAMP_FADE}ms`,
    transitionTimingFunction: 'ease-out',
  },
  // Medium, not semibold, as in native Messages. See ui-metrics.md, "Date
  // separator weights".
  stampDay: {fontWeight: '500'},
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    marginRight: CONTACT_PHOTO_MARGIN,
    alignSelf: 'flex-end',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColor('systemGray3'),
  },
  /*
   * The disc's centre is 10.5 pt above the balloon's top and 2.5 pt in from
   * its side edge, on the side away from the tail (`badgeMine`,
   * `badgeTheirs`). See ui-metrics.md, "Reaction badge placement".
   */
  badgeAnchor: {
    position: 'absolute',
    top: -10.5 - BADGE / 2,
    width: BADGE,
    height: BADGE,
  },
  badgeMine: {left: 2.5 - BADGE / 2},
  badgeTheirs: {right: 2.5 - BADGE / 2},
  badgeDisc: {
    display: 'flex',
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeFillLight: {backgroundColor: BADGE_FILL.light},
  badgeFillDark: {backgroundColor: BADGE_FILL.dark},
  /*
   * The badge's two tail circles. 15 and 22 (down) and 8.3 and 16.2 (outward,
   * away from the balloon) are each circle's centre offset from the disc's
   * centre, in pt. See ui-metrics.md, "Reaction badge tail circles".
   */
  badgeIntermediate: {
    position: 'absolute',
    top: BADGE / 2 + 15 - BADGE_INTERMEDIATE_H / 2,
    width: BADGE_INTERMEDIATE_W,
    height: BADGE_INTERMEDIATE_H,
    borderRadius: BADGE_INTERMEDIATE_W / 2,
  },
  badgeIntermediateMine: {left: BADGE / 2 - 8.3 - BADGE_INTERMEDIATE_W / 2},
  badgeIntermediateTheirs: {right: BADGE / 2 - 8.3 - BADGE_INTERMEDIATE_W / 2},
  badgeAnchorDot: {
    position: 'absolute',
    top: BADGE / 2 + 22 - BADGE_ANCHOR_H / 2,
    width: BADGE_ANCHOR_W,
    height: BADGE_ANCHOR_H,
    borderRadius: BADGE_ANCHOR_W / 2,
  },
  badgeAnchorDotMine: {left: BADGE / 2 - 16.2 - BADGE_ANCHOR_W / 2},
  badgeAnchorDotTheirs: {right: BADGE / 2 - 16.2 - BADGE_ANCHOR_W / 2},
  // `lineHeight` equals the font size: a taller line box puts the glyph low
  // in the disc.
  badgeGlyph: {fontSize: 17, lineHeight: 17, textAlign: 'center'},
  badgeLines: {display: 'flex', flexDirection: 'column', alignItems: 'center'},
  // `<img>` defaults to `object-fit: fill`, which stretches the symbol.
  badgeSymbol: {objectFit: 'contain'},
  pileBehind: {position: 'absolute'},
  pileFront: {zIndex: 1},
  avatarSpacer: {width: AVATAR, marginRight: CONTACT_PHOTO_MARGIN},
  avatarInitials: {
    fontSize: 11,
    fontWeight: '600',
    color: uiColor('systemBackground'),
  },
  /*
   * `flexGrow: 1` gives this column a definite width, which `balloonWrap`'s
   * percentage `maxWidth` needs; without it the cap is ignored.
   */
  stack: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
  },
  balloonWrap: {position: 'relative', maxWidth: BALLOON_MAX_WIDTH},
  /*
   * `revealColumn` is positioned against this box, so the box must span the
   * column (`alignSelf: 'stretch'`): `REVEAL_LINE_OFFSET` assumes the box's
   * right edge is at the transcript margin.
   */
  balloonLine: {
    display: 'flex',
    flexDirection: 'row',
    alignSelf: 'stretch',
    position: 'relative',
  },
  balloonLineMine: {justifyContent: 'flex-end'},
  balloonLineTheirs: {justifyContent: 'flex-start'},
  bubbleText: {
    /*
     * Sizes a wrapped message's balloon to its longest line. Without it, CSS
     * shrink-to-fit makes every wrapped balloon the full `maxWidth`.
     * `BalloonShapeCheck.swift` checks it. See ui-metrics.md, "Wrapped balloon
     * width".
     */
    experimental_hugsWrappedLines: true,
    // Keeps typed newlines and repeated spaces; `<p>` collapses them by
    // default.
    whiteSpace: 'pre-wrap',
  },
  stackMine: {alignItems: 'flex-end'},
  stackTheirs: {alignItems: 'flex-start'},
  sender: {
    // Native Messages' sender label size. See ui-metrics.md, "Sender name
    // text size".
    fontSize: 11,
    color: uiColor('secondaryLabel'),
    marginBlock: 0,
    marginBottom: 3,
    marginLeft: 2,
  },
});

export default Chat;
