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
 * An offline chat, built to the behaviours the platform's own chat actually has.
 *
 * Not a screenshot of a chat: the subtle parts are the point, and each of them is
 * something `<native:scroll>` and `<native:keyboardaccessory>` are supposed to
 * make automatic. Each is measured on the platform.
 *
 * The behaviours, and what they look like when they are wrong:
 *
 *  1. **Short conversations start at the TOP.** Three messages sit under the
 *     header, not shoved to the bottom of the screen. Chats that get this wrong
 *     look like they are missing content above.
 *
 *  2. **Long ones anchor to the BOTTOM.** Once the content outgrows the viewport
 *     the newest message is what you see, and it stays that way as messages
 *     arrive. Wrong: you land in the middle of last week.
 *
 *  3. **A reader who has scrolled up is NOT moved by someone else's message.**
 *     The native transcript models this as a scroll INTENT derived from the
 *     offset — "at the current time" versus "below future messages" — rather
 *     than as a scroll command on insert. Wrong: reading history is impossible
 *     in a busy thread.
 *
 *  4. **But they ARE moved by their own.** Sending is a different event from
 *     receiving: wherever they were reading, they meant to go to the present.
 *     That is `scrollToLatest()`, and it is why the anchor deliberately does not
 *     cover it.
 *
 *  5. **The keyboard and the composer are part of the world the list lives in.**
 *     Raising the keyboard, and growing the composer to a second line, both
 *     change how much of the transcript is covered — and a reader at the newest
 *     message stays at the newest message through both: the composer becoming
 *     active and the composer changing size are two triggers that update the
 *     intent. Wrong: the message you are reading slides behind the composer as
 *     you tap it.
 *
 *  6. **The keyboard comes down with the finger.** Dragging over it dismisses it
 *     interactively, which UIKit documents as waiting "to start the dismiss
 *     until it intersects with the keyboard".
 *
 *  7. **Tapping the status bar goes to the earliest loaded message.**
 *
 * Everything here is mock data and nothing talks to a network, so the interesting
 * states — a hundred messages, a message arriving while you read history — are
 * reachable from the controls rather than by waiting for one.
 */

import '@react-native/expo-intrinsics-poc';

import {CHAT_BUBBLE_TAIL_DROP} from '../../expo-intrinsics/src/chatBubbleMetrics';
import NativeChatBubble, {
  CHAT_BUBBLE_DRAWS_TAIL,
} from '../../expo-intrinsics/src/NativeChatBubble';
import NativeScroll from '../../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../../expo-intrinsics/src/systemColors';
/*
 * A PRIVATE import, as on the virtualized screen: `VirtualView` lives under
 * `src/private` and is not exported from `react-native`. Reaching for the real
 * component rather than a stand-in is the point — a transcript is where
 * virtualization has to hold up against everything else a message does.
 */
import VirtualView, {
  createHiddenVirtualView,
} from '../../react-native/src/private/components/virtualview/VirtualView';
import Composer, {
  BAR_TOP_PADDING,
  ComposerBar,
} from '../Composer';
import {REACTIONS, cycleReaction} from '../reactions';
import {
  RECEIPT_FADE_MS,
  RECEIPT_GROW_MS,
  RECEIPT_INK_DELAY_MS,
  RECEIPT_LAYOUT_CURVE,
  RECEIPT_LAYOUT_MS,
  RECEIPT_LEAVE_MS,
} from '../receiptTiming';
import {
  REVEAL_COLUMN,
  REVEAL_COLUMN_LANDING,
  REVEAL_SETTLED,
  resistedReveal,
} from '../reveal';
import {runFlags} from '../runGrouping';
import {uiColor} from '../uiColors';
import * as React from 'react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {
  Animated,
  Clipboard,
  Dimensions,
  DynamicColorIOS,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  useColorScheme,
} from 'react-native';

/*
 * The bubble's entrance is an animation, so it needs an animated host — but the
 * host is still a `<div>`. `createAnimatedComponent` takes the element type, and
 * an intrinsic is a type like any other.
 */
const AnimatedDiv = Animated.createAnimatedComponent('div');
/*
 * The balloon, animatable.
 *
 * `surfaceWidth` is the only thing a send flight moves: the box keeps the size
 * its text gives it and the SURFACE springs, so nothing that lays out text
 * changes size and nothing reflows.
 */
/*
 * The message's own text, which rides with the balloon through a send.
 *
 * Not for the sake of moving text — for the sake of not LOSING it. The surface
 * springs from the composer's width down past the balloon's and back, and a
 * text laid out at the balloon's resting place spends a fifth of a second
 * sticking out of a surface too narrow to hold it. It is white on white out
 * there, so the message simply reads "tching the throw" while it lands.
 */
const AnimatedP = Animated.createAnimatedComponent('p');
/* The receipt, which fades in on its own. See `Receipt`. */
/*
 * How long `Delivered` takes to arrive, in milliseconds.
 *
 * Short enough to belong to the send it follows and slow enough not to be a
 * second pop: the balloon's own flight is 500, and this begins only once that
 * has finished.
 */
/*
 * The receipt's arrival, measured off the native chat on this simulator.
 *
 * It will send to itself over SMS here, so there is a real balloon with a real
 * `Delivered` under it — see the README. One frame every 16.7ms, the ink's
 * bounding box thresholded the same way in every frame, `Delivered` at 61.7pt
 * wide and 9.33pt of cap when it settles:
 *
 *     t=3220   37.67 x 6.67    scale 0.61
 *     t=3287   42.67 x 7.33    scale 0.69
 *     t=3355   49.00 x 8.33    scale 0.79
 *     t=3420   54.00 x 9.00    scale 0.88
 *     t=3486   58.33 x 9.67    scale 0.95
 *     t=3655   61.67 x 10.00   scale 1.00
 *
 * So it GROWS, from about six tenths, over 435ms, on an ease-out — and it keeps
 * fading for a while after it has stopped growing, which is why the two have
 * their own durations here. css-transitions-1 §2 matches the lists up by index,
 * and the renderer implements that, so one declaration says both.
 *
 * It grows from its TRAILING edge and not its centre. Measured: the right edge
 * sits at 376.1 on the first frame and 377.1 on the last while the left edge
 * travels thirty points out from under it. That is the edge the receipt is aligned to,
 * so `transform-origin` follows the alignment rather than naming a side.
 */
const RECEIPT_FADE = RECEIPT_FADE_MS;
const RECEIPT_GROW = RECEIPT_GROW_MS;
const RECEIPT_GROW_FROM = 0.62;
/**
 * How long a date separator takes to arrive, and it is NOT the receipt's.
 *
 * Measured off the native chat on this simulator, sending the first message of
 * a thread and sampling the ink of "Today 2:20 PM" per frame: 255 → 161 over
 * 0.27 s, and it begins as the SEND does rather than after the balloon lands —
 * the stamp is already at full strength by the time the balloon has flown. It
 * only fades; nothing moves.
 *
 * A receipt is a different line arriving for a different reason: its 600 ms and
 * its delay are there to let the PREVIOUS receipt leave first, and a stamp has
 * no previous.
 */
const STAMP_FADE = 270;
/*
 * How long the space takes to open, and it is the TAIL's duration.
 *
 * Everything that moves the column shares one number. The receipt and the tail
 * are coupled — a balloon that wears the receipt keeps its tail, so they arrive
 * and leave together — so two durations move the transcript twice, at two
 * speeds, for one event.
 *
 * So the layout moves once, on the tail's own duration, and the INK follows
 * afterwards on its own longer one. That is also the platform's order: a
 * quick settle, then the words.
 */
const RECEIPT_SPACE = RECEIPT_LAYOUT_MS;
/*
 * The transcript's own margin, and how far the receipt sits inside a balloon's
 * trailing edge. Both measured off the native chat — see `styles.row` and
 * `styles.receipt`.
 */
const TRANSCRIPT_MARGIN = 16;
/*
 * How wide a balloon may get.
 *
 * NOT 85% of the window. That simple percentage gives 341.7 points on this
 * one — but the rule the native transcript actually applies takes the margins,
 * the plugin buttons, the character count and the send button into account,
 * and 0.85 is only what it uses in the branch where there are no plugin
 * buttons. A composer with a `+`
 * takes the other branch.
 *
 * Called with the transcript's own numbers — width 402, insets 16 either side,
 * plugin buttons YES, character count NO, cover the send button NO — it returns
 * **280.6667**, and a balloon sent natively on this simulator with fifty
 * narrow glyphs in it measures 280.667 across. The two agree exactly.
 *
 * Probing the same call at other widths and margins gives the shape: with a
 * margin of 16 or more it is the column less a constant 89.333, at every width
 * tried from 320 to 440. (Below 16 the reserve grows by what the margin is
 * short of 14, which is a case this demo does not have.) So the number stated
 * is that reserve, and the cap follows the window rather than being fitted to
 * one.
 */
const BALLOON_PLUS_RESERVE = 89.333;
const BALLOON_MAX_WIDTH =
  Dimensions.get('window').width - 2 * TRANSCRIPT_MARGIN - BALLOON_PLUS_RESERVE;
/**
 * How far the receipt's trailing edge sits inside the transcript's margin.
 *
 * It is a COLUMN, not an offset from the balloon.
 * The native receipt's text attributes say the label is right
 * ALIGNED, and two native balloons of very different widths — a two-line one
 * and the word "Hi" — put its ink's right edge at exactly 365.0 on a 402-point
 * window either way. A label that does not move when the balloon does is aligned
 * to something else.
 *
 * The appealing derivation is 21: the balloon's text container is inset
 * `BUBBLE_PADDING` (16) and its glyphs start the line fragment padding (5)
 * inside that, so the balloon's own glyphs end 21 in from its trailing edge and
 * the receipt would line up with the text above it. It lands the ink 1.33
 * points too far LEFT — so either that is not the rule or our trailing side
 * bearing is not UIKit's. The number stated is the one that puts our ink where
 * the native ink is, which is what a reader sees: both labels measure 50 points
 * of ink, and both end 37.0 from the window's trailing edge.
 */
const RECEIPT_INSET = 19.667;

/**
 * The receipt's line height, measured ONCE for the whole transcript.
 *
 * It is a property of the type ramp and not of a message — one line of text at a
 * fixed size — so every row's answer is the same, and a row that has to discover
 * it for itself renders one commit with no height at all before it does.
 *
 * That commit is the bug. `auto` is not interpolable with a length, so the box
 * OPENING for the first time is refused by the transition engine and the space
 * appears in a single frame:
 *
 *     css-trace skip t=6802 h auto->13.000px not interpolable
 *
 * — thirteen points of column arriving at once, at the same moment the previous
 * receipt is closing over its own quarter second. Bubbles jump down when an
 * earlier `Delivered` is hidden, on a row that has not been measured yet: freshly mounted, or remounted after scrolling
 * out and back (a virtualised row renders `null` children while hidden).
 *
 * Shared, so only the FIRST receipt in a run of the app pays that commit and
 * every later one is a number from its first render. Deliberately module scope
 * rather than state: it is a font measurement, the same for every row on every
 * screen, and threading it through the tree would re-render the transcript to
 * deliver a constant.
 *
 * SCOPE: this closes the `auto` commit for every row but the FIRST, whose
 * refused transition nothing can avoid because someone has to measure first.
 */
let measuredReceiptLine = null;
/**
 * What the receipt line is worth before anything has measured it.
 *
 * Without it the FIRST send in a run of the app opens its space from `auto`,
 * and that row alone jumps down for a frame as an earlier receipt transitions
 * out.
 *
 * Measuring first is unavoidable; rendering `auto` while you do it is not. The
 * seed only has to be a LENGTH, because a layout effect replaces it with the
 * real measurement in the same commit, before the frame is painted — so this
 * number is never actually drawn. Its entire job is to keep the box out of
 * `auto` for that one commit, so the transition engine
 * sees a length and interpolates instead of refusing.
 *
 * Thirteen because that is what 11pt system text measures here — the trace line
 * quoted above reads `h auto->13.000px`. If Dynamic Type makes the real figure
 * something else, the measurement corrects it and that correction is itself a
 * number-to-number change, which the engine animates rather than snapping.
 */
const RECEIPT_LINE_SEED = 13;
/**
 * The air a receipt needs above it where no tail is drawn, and the height its
 * box needs to hold it.
 *
 * A tailed balloon ends in a narrow point of ink and the platform puts the
 * receipt 2.3 points under it; a tailless one ends in a flat edge the width of
 * the message, under which the same gap reads as too little. The drop plus
 * three is what that costs.
 *
 * It has to be BOTH numbers. The ink is pushed down by its margin, and the box
 * it sits in clips — measured on Android, pushing the ink down without growing
 * the box left 2.67 points of an eight-point line showing.
 */
const RECEIPT_AIR = CHAT_BUBBLE_DRAWS_TAIL ? 0 : CHAT_BUBBLE_TAIL_DROP + 3;
/**
 * Where the column of times rests, how fast it comes in, and the one inequality
 * that has to hold between them.
 *
 * `REVEAL_COLUMN_OFFSET` is past the WINDOW's edge — `right` is measured from
 * the row's border box and the row is the full width — so the column is out of
 * the way entirely until it is dragged for: no width taken, no touch taken, and
 * nothing in the accessibility tree to read out.
 *
 * `REVEAL_COLUMN_RATE` is how much further it travels than the transcript does:
 * its own journey over the transcript's `REVEAL_SETTLED`. A ratio rather than a
 * distance, so changing the column's width keeps the two landing together.
 *
 * ## The rate, and why it is almost one
 *
 * The balloons move by exactly what the column occupies — `REVEAL_SETTLED` is
 * `REVEAL_COLUMN + REVEAL_COLUMN_LANDING` — so the column has barely further to
 * go than they do and the two travel almost together: 1.04.
 *
 * That ratio is the whole of what the reader sees between a balloon and its
 * time, because the gap is
 *
 *     TRANSCRIPT_MARGIN + 2  -  reveal x (RATE - 1)
 *
 * A rate well above one CLOSES that gap as the drag goes on: at 1.4 it starts
 * at eighteen points and reaches two at the settled state, less on a long pull,
 * against seventeen in the native chat.
 *
 * At 1.04 the gap is sixteen wherever the drag stops, which is a constant the
 * eye reads as deliberate rather than as the times catching up.
 */
/* The column's BOX: the ink's content space plus the trailing padding that
   right-aligns it to the transcript margin. Wider than the column occupies —
   the box is positioned, not in flow, so only the ink's geometry matters. */
const REVEAL_BOX_WIDTH =
  REVEAL_COLUMN + (TRANSCRIPT_MARGIN - REVEAL_COLUMN_LANDING);
/*
 * Fully past the edge INCLUDING the right-aligned ink. The occupied width plus
 * two is the offset for ink laid out from the box's leading edge; with the ink
 * right-aligned it leaves the head of a two-digit time peeking eight points
 * into the screen at rest. The rate below is derived from this offset, so the
 * settled landing — ink sixteen points in — follows automatically.
 */
const REVEAL_COLUMN_OFFSET = REVEAL_BOX_WIDTH + 2;
const REVEAL_COLUMN_RATE =
  (REVEAL_COLUMN_OFFSET + REVEAL_COLUMN_LANDING) / REVEAL_SETTLED;

/*
 * How much further a SENT balloon slides than the column it uncovers, opening a
 * little more air between it and its timestamp — the platform keeps the sent side
 * that bit clearer. A small value; tune against the device.
 */
const SENT_REVEAL_GAP = 6;

/*
 * The time's `right` within the balloon's line. `REVEAL_COLUMN_OFFSET` is
 * measured from the window's edge; the line's edge is the transcript margin in
 * from it, and the column's travel to land is the same either way.
 */
const REVEAL_LINE_OFFSET = REVEAL_COLUMN_OFFSET + TRANSCRIPT_MARGIN;

/* --------------------------------------------------------------- mock data */

/*
 * The badge, measured off the native chat on a 402-point window.
 *
 * A 34-point disc in the sender's balloon colour, with a 5-point dot trailing it
 * — the small end of a thought-bubble tail. On a sent balloon the disc's centre
 * measured 2.5 points inside the bubble's leading edge and 10.5 above its top,
 * which is the rule: the badge sits on the side AWAY from the tail, overlapping
 * the corner rather than floating clear of it.
 *
 * The number is a derived one: the badge's box is 36 x 36
 * with a one-point mask inset on every side — 36 less two is 34, which is the
 * disc measured. The 36 is the BOX; the 34 is what is drawn in it.
 */
const BADGE = 34;
/*
 * The tail is TWO circles, not one dot.
 *
 * The two sizes are 16 x 15 and 8 x 7, and a capture of the native reaction
 * shows what they are: a thought bubble's tail, with the larger
 * circle FUSED to the disc's outward-bottom edge and the small one detached
 * further along the same diagonal.
 *
 * The offsets are measured off that capture, as centres relative to the disc's
 * own centre: the intermediate sits 8.3 outward and 15 down, the anchor 16.2
 * outward and 22 down. Sizes are the platform's; placement is the picture's.
 */
const BADGE_INTERMEDIATE_W = 16;
const BADGE_INTERMEDIATE_H = 15;
const BADGE_ANCHOR_W = 8;
const BADGE_ANCHOR_H = 7;
// There is no reaction PICKER: the pill floating above the platter needs a
// private accessory view a `<menu>` cannot make. So reactions are DISPLAYED
// (the badge below, at its measured geometry) and SET from a demo command in
// the `+` menu, the same way the other transcript states are triggered — see
// `actions`. See [[reactions-peek-architecture]].

/*
 * Dragging the transcript left reveals each message's time, measured off
 * the native chat on a 402-point window.
 *
 * It RESISTS rather than following the finger: a 20-point drag moved the
 * balloons 16, a 40-point drag moved them 20, and a 161-point drag moved them
 * 39. That is iOS's own rubber band, `limit * (1 - 1 / (1 + d / limit))`, with a
 * limit of about 50 — the curve that never quite reaches its limit, which is why
 * dragging further and further keeps doing a little more and never runs out.
 *
 * The column itself is 44 wide with the time set at 11 points, which is the
 * receipt's size: both are the transcript's marginalia and the platform sets them
 * alike.
 */
/**
 * How long an ARRIVAL takes altogether, measured off the native chat.
 *
 * Not the throw, which is 200ms — this is the throw plus the size spring
 * settling behind it, and it is what the receipt waits for. Named separately
 * because the two are separate animations with separate ends and only the
 * longer one means "the message has landed".
 */
const BALLOON_SETTLE = 500;

/**
 * How many frames to wait for the transcript to stop before giving up and
 * showing a sent message without its flight.
 *
 * About 600ms, which is twice the longest scroll measured. The escape hatch is
 * the point: whatever is moving may never stop, and a message that stays
 * invisible is a worse failure than one that appears without animating.
 */
/**
 * How long a message has to be before the balloon shows a preview of it.
 *
 * The platform truncates between 4,000 and 8,000 characters — bracketed by
 * sending known lengths to itself on the simulator: 4,000 renders in full (and
 * far more than six lines, so the trigger is LENGTH, not line count), 8,000
 * truncates. The midpoint is as close as measurement got.
 *
 * The point of the limit is not tidiness. Ours lays out every character it is
 * given: a pasted trace produces a balloon THIRTY-THREE THOUSAND points tall,
 * which is a texture the renderer cannot draw and a scroll it cannot survive.
 */
const TRUNCATE_ABOVE = 6000;

/**
 * How much of it the balloon shows, in characters.
 *
 * The native chat shows about six lines. At this balloon's width and face that is
 * roughly forty characters a line, so six lines is around two hundred and forty
 * — and a character count is what this renderer can honour, having no
 * line-clamp. The ellipsis is a real one, as the native chat draws.
 */
const TRUNCATE_PREVIEW = 240;

const BALLOON_SETTLE_FRAMES = 36;

/**
 * How many consecutive still readings mean the transcript has actually stopped.
 *
 * See the check itself for the measurement that says two is not enough.
 */
const STILL_READINGS = 3;

/**
 * How far a balloon's tail hangs BELOW its body.
 *
 * Matches `EXPBalloonTailDrop` natively: the platform draws the shape and this
 * side gives it the room, so the two have to agree.
 *
 * Measured natively — a one-line balloon's body ends at y=299 and the tail's
 * point is at y=306. It does not reach out SIDEWAYS at all: the point is seven
 * and a half points inside the body's trailing edge, and what makes it read as
 * sticking out is the SCOOP above it, where the edge curves more than nine
 * points inward before sweeping back to the point. No strip of width is
 * reserved beside the balloon, because the tail takes none.
 */
/*
 * How far the tail reaches past the balloon's body, in points.
 *
 * `EXPBalloonTailReach` in the renderer, which takes it from the native balloon
 * artwork: the body's trailing edge is at 48.611 of the artwork's 54 and the
 * rest is the tail. The mask draws the tail INSIDE the element's box, so the
 * box has to be this much wider than the balloon on the tail's side — which is
 * a layout fact the author leaves room for, and this is that room.
 *
 * Apple's tail does not hang below the body: its point is on the body's own
 * bottom line.
 */
/*
 * The app's `'left'` / `'right'` in the element's own vocabulary.
 *
 * The element says `leading` and `trailing` because a balloon's tail is on the
 * side its message came from, and in a right-to-left layout that is the other
 * side of the screen. This demo lays its rows out left and right explicitly, so
 * the translation belongs here rather than in the element.
 */
const TAIL_SIDE = {'': undefined, left: 'leading', right: 'trailing'};

/**
 * The balloon's own metrics, in the order the native balloon derives them.
 *
 * Stated as relationships rather than fitted numbers, because the relationships
 * matter more than the numbers — at another text size the numbers all move and
 * only the relationships hold.
 *
 *   The composer field's vertical text insets are `{10, 0, 10, 0}`, and that is
 *   where a balloon's vertical padding comes from: the balloon's text container
 *   inset is the composer's content inset scaled by the text-size factor (1.0,
 *   or 1.2 at accessibility sizes). The balloon and the composer's field are
 *   padded by the same rule, which is why a message looks like the thing that
 *   was typed.
 *
 *   The line fragment padding is 5, applied to the text container on both sides
 *   on top of that inset. Total measured from a balloon's edge to its first
 *   glyph: 16.
 *
 *   The corner radius is half the one-line balloon's height — the height of a
 *   ONE-LINE balloon in the balloon font — so the radius is half the smallest
 *   balloon there can be, which makes that balloon exactly a capsule and every
 *   taller one share its corner. It is not a constant: it follows the font.
 */
/*
 * FOURTEEN, which is what the platform says.
 *
 * The native balloon's mask alignment insets are
 * `{top 10, left 14, bottom 16.83, right 14}` — the balloon's shape inset from
 * the box its text lays out in, which is exactly this padding. The vertical 10
 * agrees with the text container inset of `{10, 0, 10, 0}`, and the bottom's
 * extra 6.83 is the tail rather than padding.
 *
 * NOT sixteen. Halving the remainder of a one-word balloon measured on a
 * screenshot — 47.33 points wide around 13.33 of ink — gives sixteen, and that
 * arithmetic cannot see a minimum width: it puts every balloon two points fat
 * on each side. Beside the native chat, the first glyph of each is an "M" at the same size, so the side bearings
 * cancel, and the ink sits 14.33 points inside the native balloon against 16.67
 * inside ours.
 */
const BUBBLE_PADDING = 14;
const BUBBLE_PADDING_V = 10;
/**
 * The line box a 17-point message sits in.
 *
 * `UIFont.systemFont(ofSize: 17).lineHeight`, which is what a `UITextView` gives
 * a line and therefore what the native balloon measures. Stated because the
 * renderer's own default came out at 19.05 — one and a quarter points shorter
 * per line, which made every balloon shorter than the native one and, through
 * the rule above, its corner smaller too.
 *
 * The exact value is the platform's, measured at runtime: the one-line text
 * height is 20.2871, and the one-line balloon (40.2871) is this plus twice
 * `BUBBLE_PADDING_V`, which puts `BUBBLE_RADIUS` at the platform's 20.1436.
 * Same number as the
 * composer's `LINE_HEIGHT`, and for the same reason: one font, one line box.
 */
const MESSAGE_LINE_HEIGHT = 20.2871;
/** Half the one-line balloon's height, spelled the way the platform derives it. */
const BUBBLE_RADIUS = (MESSAGE_LINE_HEIGHT + 2 * BUBBLE_PADDING_V) / 2;

/** The avatar circle, measured off a real group thread. */
const AVATAR = 24;
/** The native contact-photo margin: the gap to the balloon beside it. */
const CONTACT_PHOTO_MARGIN = 7;

/**
 * The separator to show above a message, or `null` for none.
 *
 * At the start of the conversation, and whenever more than a quarter of an hour
 * has passed — which is roughly when a reader stops assuming two messages
 * belong to the same exchange.
 */
const STAMP_GAP = 15 * 60 * 1000;

/**
 * A message's own time, for the column the drag reveals.
 *
 * WITH the AM/PM, as the native revealed column shows it.
 *
 * `timeStyle: 'short'` rather than naming the fields, because the marker is
 * exactly the part a locale decides for itself: en-US gets `3:52 PM` and a
 * 24-hour locale gets `15:52` with nothing appended, which is the same request
 * answered correctly in both.
 */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {timeStyle: 'short'});

function timeOf(at) {
  return TIME_FORMAT.format(new Date(at));
}

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

/** Which side a sender's tail hangs off. */
function mineSide(message) {
  return message.from === 'me' ? 'right' : 'left';
}
/*
 * The send, measured frame by frame on a real one in the native chat.
 *
 * Recorded on the simulator at 60fps, in an EMPTY conversation so that the
 * balloon travels 250 points in the clear rather than emerging from behind the
 * composer. The whole animation is visible there, including the opening frames
 * a composer hides.
 *
 * Tracking the balloon's bounding box, times from the first frame it exists:
 *
 *      t(ms)   width   top      t(ms)   width   top
 *        0      318     483      210     136     303
 *       32      288     483      277     150     253
 *       63      254     473      345     164     231
 *       95      202     438      412     172     224   <- highest point
 *      112      180     419      463     176     224
 *      145      146     375      568     178     230
 *      177      136     338      745     176     233   <- rest
 *
 * Three facts.
 *
 * **It is born as the FIELD.** 318 x 46 at the composer's own frame — the
 * pill's exact geometry, with the message in it. Not a small balloon that
 * appears near the composer: the field itself, turned blue. A surface started
 * at a fraction of the balloon's final width instead reads as a bubble
 * appearing beside the composer rather than swooping out of the field.
 *
 * **The width DIPS below its resting value and springs back.** 318 down to 136,
 * which is 0.77 of the final 176, and then up. That 0.77 is the TROUGH, not a
 * starting size.
 *
 * **And the rise overshoots.** The top reaches 224 and settles at 232, nine
 * points below where it went. A monotonic curve cannot do that —
 * `Easing.bezier(0.49, 0.088415, …)` is the timing function of the native
 * send's pre-Liquid-Glass rise, not this one. The current rise is a
 * `CASpringAnimation`, measured here:
 *
 *     setAdditive:NO   from:initialPositionY   to:finalPositionY
 *     setMass:1   setStiffness:141.75909   setDamping:17.35028   setSpeed:1
 *     setDuration:[animation settlingDuration]
 *     setBeginTime:beginTime + 0.055
 *
 * (Damping is 23.8125 under Reduce Motion.) That spring's first peak is at
 * pi/omega_d = 385ms with a 3.5% overshoot; measured, the peak is in the 412-463ms
 * window the frames leave open and the overshoot is 9/259 = 3.5%.
 */
const THROW_SPRING = {mass: 1, stiffness: 141.75909, damping: 17.35028};

/*
 * The 55 milliseconds the balloon sits on the composer before it leaves.
 *
 * `setBeginTime:beginTime + 0.055`, above. It is the beat that makes the send
 * read as the field letting go rather than the balloon being fired: three
 * frames where the pill is simply the field, in blue.
 */
const THROW_DELAY = 55;

/*
 * The squash, and where it bottoms out.
 *
 * 318 to 136 in 177ms. The curve is FITTED to the ten measured frames rather
 * than guessed at — least squares over the cubic-bezier family, worst residual
 * 3% of the travel:
 *
 *     t/177   0.18  0.24  0.36  0.45  0.54  0.63  0.72  0.82  0.90
 *     covered 0.17  0.21  0.35  0.46  0.64  0.76  0.87  0.95  0.98
 *
 * A curve read off a description of the table is not a fit: `bezier(0.34, 0,
 * 0.28, 1)` reaches half the travel at 0.30 where the recording reaches it at
 * 0.47.
 *
 * The trough follows the composer's height, measured:
 *
 *     t = clamp((h - H) / (7H - H), 0, 1)      // H = the one-line composer height
 *     return 0.7 + 0.2 * t
 *
 * so a one-line composer asks for 0.7 and a seven-line one for 0.9 — a tall
 * composer's balloon is already close to its final size and has less to give.
 * Measured, the trough is 0.77 rather than 0.70, because the scale-up spring
 * begins before the scale-down has settled and the two cross; 0.77 is where
 * they actually meet, and it is the number to copy.
 */
const SQUASH_DURATION = 177;
const SQUASH = Easing.bezier(0.41, 0.2, 0.6, 1);
const SQUASH_TROUGH = 0.77;

/*
 * And the swell back, which is the platform's own spring.
 *
 * Measured on the native send: mass 2, stiffness 320,
 * damping 38 (50.5964 under Reduce Motion). First peak at 376ms with a 2.8%
 * overshoot; measured, the width peaks at 178 against a final 176 — 1.1% — 350
 * to 450ms after the trough. There is a matching scale-DOWN at stiffness 310
 * for the composer, which is the other half of the crossing above.
 */
const SWELL_SPRING = {mass: 2, stiffness: 320, damping: 38};

/*
 * A spring that arrives and does not bounce, for everything that is not a send.
 *
 * `2 * sqrt(stiffness * mass)` at stiffness 150 is 24.49, so this is critically
 * damped: it covers the distance at a spring's rate and stops, with no
 * overshoot. Named for what it does rather than for whatever uses it: the
 * reaction pop and the reveal's release want an arrival, and a reaction that
 * overshoots reads as a wobble. The send has its own springs, measured off the
 * native send, and does not share this one.
 */
const SETTLE_SPRING = {stiffness: 150, damping: 24.5, mass: 1};

/*
 * The native bubble colours — the platform's, not an approximation of them.
 *
 * Measured from the platform's own balloons rather than matched by eye: the two
 * stops of the balloon gradient, and a gradient that tracks the screen rather
 * than the bubble, which is the platform's design.
 *
 * Matching by eye gives `#1FA2FF` for a stop that is actually `#5AC8FA`: the
 * top of the gradient is far more cyan than it looks in a screenshot, and that
 * is exactly the part you notice as a bubble climbs the screen.
 *
 * The grey is `secondarySystemFill`, to five decimal places.
 *
 * The native typing indicator's background holds the received balloon's own
 * fill, resolved and flattened. Sampled once under each appearance:
 *
 *   light  sRGB (0.915294, 0.915294, 0.920314)
 *   dark   sRGB (0.150588, 0.150588, 0.160627)
 *
 * `secondarySystemFill` is rgba(120, 120, 128, 0.16) light and the same colour
 * at 0.32 dark. Over white: (120·0.16 + 255·0.84)/255 = 0.915294 and
 * (128·0.16 + 255·0.84)/255 = 0.920314. Over black: 120·0.32/255 = 0.150588 and
 * 128·0.32/255 = 0.160627. All four exact, which is not something two unrelated
 * colours do.
 *
 * NOT `systemGray5`, though a light-mode balloon grey of `#E5E5EA` is
 * `systemGray5` exactly. The two readings disagree by four levels, and this is
 * the side taken and why:
 *
 * - A light-only colour is one nothing on the current path reads: the received
 *   balloon has a dark variant, and `#E5E5EA` has none.
 * - The typing bubble sits in the transcript beside the received balloons and
 *   has to be the same grey as they are. Its colour is a system fill.
 *
 * Four levels is invisible in light mode. In dark it is not: `systemGray5` is
 * (44, 44, 46) against this fill's (38, 38, 41), a step lighter than the native
 * balloon.
 */
const BALLOON_BLUE = {
  light: {top: '#5AC8FA', bottom: '#0088FF'},
  dark: {top: '#409CFF', bottom: '#0091FF'},
};
/*
 * And the received balloon's grey, OPAQUE.
 *
 * These are the two numbers computed above — `secondarySystemFill` flattened
 * over the page in each appearance — stated as colours rather than left as a
 * fill with alpha. They draw identically on the transcript, and the difference
 * is what happens when the balloon is LIFTED: a context menu's platter is
 * UIKit's own rectangle and, measured on an iOS 27 device, it carries no mask,
 * so the only way to stop it drawing a rectangle around the balloon is to give
 * it nothing to draw — a clear platter. Over the dimmed page a 16% fill then
 * reads as a murky grey; an opaque one is the balloon either way.
 *
 * `DynamicColorIOS` rather than a table read: the platform resolves it, so a
 * high-contrast setting or an appearance this file has not heard of is still
 * right. On Android the semantic fill stands, where nothing is lifted.
 */
const BUBBLE_GREY = Platform.select({
  ios: DynamicColorIOS({light: '#E9E9EB', dark: '#262629'}),
  default: uiColor('secondarySystemFill'),
});
/*
 * The reaction badge's fill is the balloon's own colour — its bottom stop,
 * measured: the badge on a sent balloon sampled (0, 136, 255), which is
 * `#0088FF` exactly. A disc is one colour rather than a gradient, so it takes
 * the end the balloon meets it at.
 *
 * Two entries rather than a dynamic colour for the same reason the gradient is
 * a table: the pair is stated per appearance here and read once per render.
 */
const BADGE_FILL = {
  light: BALLOON_BLUE.light.bottom,
  dark: BALLOON_BLUE.dark.bottom,
};

/*
 * The gradient has to be built from LITERALS, which is why the pair above is a
 * table rather than a `DynamicColorIOS`.
 *
 * `linear-gradient()` takes colours, and a dynamic colour is not one — it is an
 * instruction to resolve one later, which a gradient string has nowhere to put.
 * So the appearance is read once per render and the right pair is written out.
 * Everything else on this screen stays dynamic; this is the one place that
 * cannot be.
 */
function balloonGradient(scheme) {
  const stops = scheme === 'dark' ? BALLOON_BLUE.dark : BALLOON_BLUE.light;
  return 'linear-gradient(to bottom, ' + stops.top + ', ' + stops.bottom + ')';
}

/*
 * Full names, because a group chat shows both a name and a monogram and a
 * single-word cast makes the monogram a single letter — which is not what
 * either looks like natively.
 */
const CAST = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'];

/*
 * A GROUP if more than one person other than you can speak. This is only the
 * DEFAULT for whether an incoming balloon wears a name and avatar — the platform's
 * own rule (names in a group so you can tell speakers apart, none in a 1:1
 * where repeating the one name is noise). The actual decision is per bubble
 * (`named` in `Bubble`), so a message can override it: a named add-on bot keeps
 * its name in an otherwise-nameless 1:1. This demo's cast is three, so it is a
 * group and its incoming bubbles wear names by default.
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

/*
 * How long the received-message pop takes. Short: the native chat lands an incoming
 * balloon with a quick scale-and-fade, not a drawn-out entrance. The flag that
 * drives it is cleared this long after the message lands — see `receive`.
 */
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
     * The receipt, in the platform's own vocabulary.
     *
     * `null` for anything received — a message someone else sent has no status
     * to show you — and one of the native status words for anything sent.
     * `edited` is separate because it is not a receipt: a message can be both
     * read and edited, and the native chat shows both.
     */
    status: from === 'me' ? 'Delivered' : null,
    edited: false,
  };
}

/** A conversation of `count` messages, for reaching the long case without typing. */
function mockConversation(count) {
  const messages = OPENERS.slice(0, count).map(m => makeMessage(m.from, m.text));
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

/* ------------------------------------------------------------------ pieces */

/**
 * The date separator above a message: "Today 3:25 PM", centred, two weights —
 * the day semibold and the time regular, as the platform sets it.
 *
 * It ARRIVES rather than appears. A stamp over a message that has just been
 * sent belongs to the same event as the balloon, and the platform brings the
 * line in after the row has settled rather than cutting to it — the same fade,
 * on the same clock, as a receipt's ink. Only the INK fades: the line's height
 * is there from the first frame, so nothing above it moves while it comes in.
 *
 * A stamp that was already in the transcript when the screen opened is not
 * arriving from anywhere and is drawn at once; `arriving` is what says which.
 */
function Stamp({day, time, arriving}) {
  const [shown, setShown] = useState(!arriving);
  useEffect(() => {
    if (shown) {
      return;
    }
    // After a paint, so the transition has a before-value to run from: a style
    // that is only ever the after-value cuts.
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
 * The receipt under a sent message: "Delivered", "Read", "Edited".
 *
 * The strings are the platform's own, and the colour is `#3C3C43` at 60% alpha
 * and therefore exactly `secondaryLabel`. Written as the semantic colour rather
 * than the literal, so it follows dark mode; the platform's value is a
 * light-mode one with the same recipe.
 *
 * Only under the LAST sent message, which is the platform's rule: a receipt is a
 * statement about the conversation's high-water mark, not about each message.
 */
function Receipt({message, style, elementRef}) {
  /*
   * It FADES, and it does not push anything while it does.
   *
   * The row above it has just finished arriving, so a receipt that appears at
   * full strength is a second event landing on top of the first: the balloon
   * settles, and in the same frame a line of text exists that did not before and
   * everything above it moves to make room. The platform brings it in on its own,
   * after.
   *
   * The height is NOT animated with it. Growing from zero would move the
   * transcript for the whole of the fade rather than once, and moving a list a
   * point at a time for a third of a second is the reading-a-moving-page
   * complaint in miniature. The layout settles in one step and only the ink
   * arrives gradually.
   *
   * CSS rather than `Animated` — nothing to drive, and no value to stop on
   * unmount. A TRANSITION and not an animation, and which of the two it is
   * matters: see `styles.receiptWaiting`, where the box that holds
   * this one's space carries the fade. This element only says what it says.
   *
   * The ref is the measuring tape and nothing else: the row above opens its box
   * to this line's `offsetHeight`, so the element has to be reachable.
   */
  const parts = [];
  if (message.edited) {
    parts.push('Edited');
  }
  if (message.status != null) {
    parts.push(message.status);
  }
  if (parts.length === 0) {
    return null;
  }
  /*
   * TWO faces on one line, which is what the platform does.
   *
   * The native status font is SF **Semibold** 11 and the native status date
   * font is SF Regular 11 — the
   * word is set heavier than the time beside it. Both regular, "Read 10:38 PM"
   * reads as one flat run.
   */
  return (
    /*
     * The animated style and the measurement land on THIS element, rather than
     * on a box around it.
     *
     * A box around it to carry the opacity and the scale costs 1.8 points:
     * `ReceiptCheck` measures the ink at 5.65 below the balloon's body, fitted
     * to the platform, and the extra flex item puts it at 7.42 — two boxes round
     * where one does not. So the ink carries its own transition and
     * `receiptSpace` is the only box.
     */
    <p style={[styles.receipt, style]} ref={elementRef}>
      <span style={styles.receiptStatus}>{parts.join(' \u00b7 ')}</span>
      {message.readAt != null ? ` ${timeOf(message.readAt)}` : ''}
    </p>
  );
}

/**
 * A bubble that ARRIVES — the composer's field becoming a balloon.
 *
 * Measured off the native chat on the simulator, tracking the balloon frame by
 * frame through a send, in a 402-point window:
 *
 *     t=0.000   288 x 32   at the FIELD's own frame
 *     t=0.103   224 x 44
 *     t=0.205    80 x 34   narrowest, well past the final width
 *     t=0.422   104 x 44   highest, 6pt above where it lands
 *     t=0.473   106 x 46   settled
 *
 * Three things in that which are not guessable:
 *
 *  1. **It starts as the FIELD** — the same position and the same size, not a
 *     bubble fading in where it lands.
 *  2. **The trailing edge is pinned for the whole flight.** x stayed at 384
 *     from the second frame to the last; everything happens at the leading
 *     edge. Here that comes free from the row's `justify-content: flex-end`.
 *  3. **It overshoots both ways** — the width undershoots the final 106 down to
 *     80, and the top rises 6 points past its resting place. A spring with real
 *     bounce, settled in about 0.47s.
 *
 * This is FLIP: the bubble is laid out where it belongs, measured, then put
 * back where the field was and released. Measuring rather than computing is
 * what makes it right for a transcript of any length — in an empty one the
 * balloon travels 266 points, in a full one it hops a few.
 *
 * The text is at its final size throughout, which is why the box is animated
 * and not scaled: a scale would distort the glyphs, and the native ones do not
 * change size. The box is WIDER than its content for the whole flight, so
 * nothing reflows either.
 */
/**
 * A group chat's avatar: the sender's photo, or their initials.
 *
 * Beside the LAST bubble of a run and aligned to its bottom, which is where
 * the platform puts it — one face per turn in the conversation rather than one per
 * message. The empty box on the other messages of the run keeps their text
 * aligned with it.
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

/**
 * The three dots, in a balloon of its own.
 *
 * The native chat shows one while the other party is typing, and it is a BALLOON —
 * the same grey, the same tail, the same place a message would appear — not a
 * separate widget. Which is why it reads as "a message is coming" rather than
 * as a status: the shape is already the shape of what arrives.
 *
 * Every number below is read off the native typing indicator's own layers and
 * their `CAAnimation`s, which is worth far more than fitting a loop to a
 * recording, because a recording cannot show the timing function or the
 * per-instance delay at all. What they report:
 *
 *     dot                 8.5 across, corner 4.25, BLACK at opacity 0.2
 *     replicator          3 instances, transform tx 12.5, instanceDelay 0.25
 *     dot animation       opacity 0.2 -> 0.45, 0.5s, autoreverses, repeats
 *                         timing bezier(0.75673, 0.015306, 0.58, 1)
 *     container pulse     transform.scale.xy [1, 1.03, 1] over 1.9s, ease-in-out
 *     background          sRGB 0.915294 0.915294 0.920314 — the received grey
 *
 * The balloon has NO padding of its own here — it takes `styles.bubble`'s, which
 * is `BUBBLE_PADDING_V`. That is not a shortcut: the native typing balloon's mask
 * is 56 x 35, and 35 less the tail's 6.83 is a 28.17-point body, which around an
 * 8.5-point dot is 9.83 either side — `BUBBLE_PADDING_V` to a sixth of a point.
 * The typing balloon is an ordinary balloon with a dot where the line would be.
 */
const TYPING_DOT = 8.5;
/** `instanceTransform.tx` less the dot: 12.5 - 8.5. */
const TYPING_DOT_GAP = 4;
/** The dot's own beat. `alternate` doubles it, so a full cycle is a second. */
const TYPING_BEAT = 500;
/** `instanceDelay`, which is what makes the three read as a sequence. */
const TYPING_STAGGER = 250;
/*
 * The dot's two stops and the cluster's three, in the renderer's wire format.
 *
 * `animation-direction: alternate` is what `autoreverses` was, and it is the
 * better spelling of the two: CSS plays the timing function BACKWARDS on the
 * return leg, so the curve does not have to be mirrored by hand — and the
 * mirror, swap and complement the control points (`g(t) = 1 - f(1 - t)`), is
 * exactly the kind of arithmetic that is right until someone edits one end of it.
 */
const TYPING_BEAT_FRAMES = JSON.stringify([
  {offset: 0, opacity: 0.2},
  {offset: 1, opacity: 0.45},
]);
/*
 * The indicator's own geometry, which is NOT a message balloon's.
 *
 * Measured on the native indicator, every piece:
 *
 *   default size            78.5 x 35
 *   large bubble            57.5 x 35   <- holds the dots
 *   medium bubble           11.5 x 11.5
 *   small bubble frame      {2, 38, 5, 5}
 *   large bubble offset     x 14, y -28.5
 *   medium bubble offset    x 7,  y -7.5
 *   thinking dot diameter   8.5   <- already ours
 *   thinking dot space      12.5  <- already ours
 *
 * Two things follow. The bubble is 35 TALL where a message balloon's padding
 * gives 28.5 — that is the skinniness. And its tail is not a balloon's
 * point: it is two shrinking circles stepping down and to the left, which is
 * why the x offsets fall 14, 7, 2. So this cannot be a `<native:chatbubble>`
 * with a `tail` — the shape is a different shape, and saying so in three boxes
 * is more honest than bending the balloon into it.
 */
/*
 * It GROWS IN rather than appearing, and the one number the platform publishes
 * for that is the large bubble's grow begin time, 0.12 — the beat before the
 * bubble starts to open.
 *
 * The begin time is measured; the DURATION and the curve are not, because
 * nothing publishes them and there is no way to make the native chat show a typing
 * indicator on this simulator to record one. So they are chosen to read as one
 * beat and marked as such — if a recording of a real conversation ever turns
 * up, this is the pair to re-fit.
 *
 * On the ROW rather than on the cluster, because the cluster already carries the
 * breath and an element runs one animation here.
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
/** The whole cluster breathes: `[1, 1.03, 1]` over 1.9 seconds. */
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
        THREE boxes rather than a balloon — see `TYPING_BUBBLE_W` for the
        framework's own numbers. The two small circles are the thought-bubble
        tail, and they carry the same breath as the bubble because they are
        inside the box that breathes.
      */}
      <div style={styles.typingCluster}>
        <div style={styles.typingBubble}>
          <div style={styles.typingDots}>
            {[0, 1, 2].map(index => (
              <div
                key={index}
                /* `instanceDelay`, one dot at a time. The only per-dot value. */
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
 * The reaction badge stuck to a balloon's corner: a disc in the reactor's
 * colour carrying the reaction glyph, with the small thought-bubble dot
 * trailing off the OUTER edge (away from the tail). Its geometry is measured
 * natively — a 34-point disc whose centre sits 2.5 inside the leading edge
 * and 10.5 above the top (see `styles.badgeAnchor`).
 *
 * A SIBLING of the balloon, never a child, so the peek lifts the balloon and
 * leaves this behind — the balloon rises above its own reaction rather than
 * carrying its pixels into the lift. See [[reactions-peek-architecture]]. It is
 * positioned against the balloon by the `relative` wrapper in `Bubble`.
 */
/**
 * What a disc DRAWS for a reaction: an SF Symbol, stacked lines, or a character.
 *
 * Shared, because TWO discs show a reaction — the lone badge and the front of a
 * pile — and the artwork belongs to the reaction, not to either of them. Drawn
 * inline at one of the two sites, the other falls back to `kind.glyph`, the raw
 * emoji: a message two people reacted to shows the gold 👍 and stretches its
 * disc into an oval, where the SAME reaction from one person draws the native
 * white thumb. See `a-rule-applied-to-some-call-sites`.
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

/*
 * How far each stacked disc peeks out from the one in front.
 *
 * MEASURED off the native stacked-reaction artwork, scanned row by row rather
 * than eyeballed: the drawn blob is 35.7pt wide with one disc behind and 38.7pt
 * with two, so each disc behind adds ~3pt. The front disc is ~34, which a
 * top-of-pile radius of 17 confirms exactly.
 *
 * The fan is HORIZONTAL. Both stacks occupy the same rows (y 1..33) — the stack
 * grows only outward, never upward; a diagonal offset makes the pile taller
 * than the native one as well as wider.
 */
const PILE_PEEK = 3;

/**
 * The AGGREGATE pile, for a message TWO or more people reacted to.
 *
 * The native pile does NOT lay the emoji side by side — it STACKS discs.
 * Rendered from the platform's own stacked-reaction artwork: one front disc the
 * size of a single
 * badge carries the most-recent reaction's glyph, and one or two more discs peek
 * out behind it, fanned AWAY from the tail (up, and outward from the balloon's
 * edge). The tail is the same single dot the lone badge uses. A SIBLING of the
 * balloon like the single badge, so the peek lifts the balloon and leaves the
 * pile behind.
 *
 * What is ground truth: the stacked-disc SHAPE, the disc size, the corner, the
 * ~4pt peek. What is the demo's own choice: the front shows the most recent
 * reaction's artwork (natively a large pile may show a count); the demo never
 * has more than three.
 */
function ReactionPile({reactions, mine, scheme}) {
  const faces = reactions
    .map(id => REACTIONS.find(entry => entry.id === id))
    .filter(Boolean);
  if (faces.length < 2) {
    return null;
  }
  const fill = scheme === 'dark' ? styles.badgeFillDark : styles.badgeFillLight;
  // Most-recent on top, and at most two discs peeking behind it (Stack-3).
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
 * A value built once, when it is first wanted, and `null` until then.
 *
 * `useRef(make())` calls `make` on EVERY render and keeps only the first
 * result — an allocation per render for the life of the component. This calls
 * it once. Pass `null` for `make` while the value is not wanted yet, which is
 * how a row that may never animate avoids building anything to animate with.
 */
function useLazily(make) {
  const built = useRef(null);
  if (built.current == null && make != null) {
    built.current = make();
  }
  return built.current;
}

function BubbleImpl({
  message,
  composerFrame,
  tail,
  startsRun,
  endsRun,
  separatesRun,
  onCommand,
  onArrived,
  onOpenReader,
  /** Told the width's extremes once a send has landed — see `flightTrace`. */
  onFlight,
  showsReceipt,
  reveal,
  pan,
  /** The reaction ids stuck to this balloon (array; empty/undefined for none). */
  reactions,
}) {
  if (profiling) {
    work.rows++;
  }
  const counted = useRef(false);
  if (profiling && !counted.current) {
    counted.current = true;
    work.mounts++;
  }
  const mine = message.from === 'me';
  const scheme = useColorScheme();
  const box = useRef(null);
  /*
   * The received-message POP, as a mount-time CSS animation (css-animations-1,
   * run by the renderer's own engine — `animationKeyframes` is the pre-resolved
   * stop list). A received balloon scales up from its bottom-leading corner and
   * fades in, the way the native chat lands an incoming bubble; a sent one has the
   * `entering` flight instead and never takes this. The `arriving` flag is
   * transient (cleared in `receive`, stripped on restore), so a virtualized
   * remount does not replay it. Transform and opacity are the animatable
   * properties the engine supports.
   */
  /*
   * Whether THIS other party's balloon wears a name (and the avatar that goes
   * with it) is decided PER BUBBLE, not once for the whole thread. The default
   * is the group rule — names in a group, none in a 1:1 (see `IS_GROUP`) — but a
   * message may override it, which is what lets a named add-on bot carry its
   * name inside an otherwise-nameless 1:1 while the human it is talking to
   * stays anonymous. Only the run's first bubble actually draws the name; the
   * avatar rides every bubble that wears one.
   */
  const named = !mine && (message.showName ?? IS_GROUP);
  /*
   * A message too long to draw shows a preview and a chevron; see
   * `TRUNCATE_ABOVE`. The whole of it is still in the model — only the balloon
   * is short — so the reader has everything to show.
   */
  const tooLong = (message.text?.length ?? 0) > TRUNCATE_ABOVE;
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
        // Grows out of the tail's corner — bottom-leading for a received bubble.
        transformOrigin: '0% 100%',
      }
    : null;
  /*
   * The flight's two animated quantities, and nothing at all for a message
   * that does not fly. A message arrives flying or it never does, so the pair
   * is built once, by the row that needs it, and is `undefined` in every other
   * row — one component either way.
   */
  const flight = useLazily(
    message.entering === true
      ? () => ({lift: new Animated.Value(0), width: new Animated.Value(0)})
      : null,
  );
  const lift = flight?.lift;
  /*
   * There is NO horizontal one, and that is the shape of the throw.
   *
   * In the native send the balloon's trailing
   * edge is at 376.7 on the frame it appears and at 376.7 on the frame it
   * settles, and every frame between. The whole horizontal motion is the WIDTH
   * springing while that edge stays put.
   *
   * The native send animates `position.x`, but a
   * `CALayer`'s position is its CENTRE, and shrinking a view about a fixed right
   * edge moves the centre by half the width change. Its x animation IS the
   * width animation, expressed in the only geometry a layer has. Ours puts the
   * width on the surface, which the row pins to its trailing edge, so the
   * equivalent translation here is zero and a `translateX` does the same journey
   * a second time: the balloon flies in from the left of the screen, dragging
   * the timestamp column with it because the column is a child of the same row.
   */
  const width = flight?.width;
  /* The bubble's own resting width, once measured. Non-null means "flying". */
  const [restingWidth, setRestingWidth] = useState(null);
  /*
   * How tall the receipt's line is, so the space it opens can be transitioned to
   * a number. Measured, because it is text at the reader's own size — see the
   * receipt at the end of this row.
   */
  const [receiptHeight, setReceiptHeight] = useState(measuredReceiptLine ?? RECEIPT_LINE_SEED);
  /** The receipt's ink, whose line height the space above opens to. */
  const receiptInk = useRef(null);
  /*
   * The receipt's height, SYNCHRONOUSLY, for the same reason as the band below
   * — and here it is not a refinement but the whole bug.
   *
   * `onLayout` reports a frame LATE. Until it lands, `showsReceipt === 'shown'`
   * renders the space with no height at all, so the box stands at its content
   * height as `auto`. That is invisible while it lasts — an auto box around one
   * line of text is exactly the height that line needs — and it is fatal at the
   * end: `auto` is not a number, so when the receipt hands over and the space
   * goes to zero there is no before-value to transition FROM, and the 13 points
   * leave in a single frame instead of over the quarter second. Bubbles jump
   * down when an earlier `Delivered` is hidden, intermittently, because a row
   * that scrolls off and back remounts into that same unmeasured window.
   *
   * Measured in a layout effect the number exists before the frame is painted,
   * so the space is never rendered without one and every later change is a
   * transition between two numbers.
   *
   * `offsetHeight` and NOT `getBoundingClientRect`: the ink rests at
   * `scale(0.62)` while it waits (see `receiptInkWaiting`), and a client rect
   * includes transforms, so the rect would report two thirds of a line and the
   * space would open that short. `offsetHeight` is the layout height with the
   * transform left out, which is the quantity the box needs.
   *
   * LATCHED: this is one line of text at a fixed size, so it never
   * legitimately changes, and re-reading it retargets the height transition
   * mid-flight a fraction of a point at a time — the receipt shivering while it
   * arrives.
   */
  useLayoutEffect(() => {
    /*
     * Gated on the MODULE value, not on `receiptHeight`, which is seeded and
     * therefore never null — gating on the state would leave the seed
     * uncorrected and Dynamic Type unhonoured. Exactly one measurement per run
     * of the app.
     */
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
   * Whether this bubble may be SEEN yet.
   *
   * A sent message is hidden from the moment it mounts until its destination
   * has stopped moving. The native transcript does the same thing: it scrolls
   * to where the message WILL be while it is still hidden, and only then brings
   * it in. That ordering is
   * the whole effect: scrolling and revealing at once reads as the list
   * jumping, and a balloon that flies while the list is still scrolling crosses
   * whatever is between, which is two messages drawn on top of each other.
   */
  const [ready, setReady] = useState(message.entering !== true);


  useEffect(() => {
    if (message.entering !== true) {
      return;
    }
    // Without a flight the message has still arrived: the protocol below has
    // to complete, or `entering` stays set and a remount replays the flight.
    const origin = composerFrame?.current;
    /*
     * A sane origin, or no flight at all.
     *
     * The origin is derived from the transcript's frame and the inset it has
     * reserved, and either can be zero for a frame — before the first layout,
     * or before the first inset has been composed. Taken at face value the
     * balloon starts at the window's top-left corner and sails in diagonally
     * across the whole screen.
     */
    if (origin == null || !(origin.y > 0)) {
      onArrived?.(message.id);
      setReady(true);
      return;
    }

    let cancelled = false;
    let timer = null;
    let previousY = null;
    let agreed = 0;
    let lastStillAt = 0;
    let tries = 0;

    /*
     * STILL, not merely measured.
     *
     * The list is animating to the bottom at the same time, so the first
     * measurement is of a position the bubble is about to leave. Two readings
     * that agree mean the scroll has finished and the destination is real.
     *
     * Sampled once a FRAME, and the tolerance is half a point.
     *
     * Both numbers are load-bearing, in opposite directions. Sampling every
     * 50ms with a one-point tolerance accepts twenty points a second as
     * "still", which the tail of a scroll passes while still visibly moving;
     * and having accepted it, the reveal is up to a whole interval late.
     * The scroll ends in one-point-per-frame steps and settles 280ms after the
     * send; sampled per frame the balloon leaves within about 30ms of that,
     * instead of up to an interval of dead air with the composer empty and
     * nothing yet appeared.
     */
    const attempt = () => {
      if (cancelled) {
        return;
      }
      box.current?.measureInWindow((x, y, w, h) => {
        if (cancelled || !(w > 0)) {
          return;
        }
        /*
         * THREE readings that agree, not two.
         *
         * Two is not enough to mean "the scroll has finished": the transcript
         * eases to the bottom, and two consecutive frames near the end of that
         * ease can sit within half a point of each other while the list still
         * has fifty more to travel. Read two frames early,
         * `lift` comes out a few points where it should be sixty-odd, and the
         * balloon appears low and nudges up instead of launching from the field.
         */
        // Readings at least a 60 Hz frame apart, so a 120 Hz display does not
        // call a still-moving tail "still" twice as fast.
        const now = Date.now();
        if (previousY != null && Math.abs(y - previousY) < 0.5) {
          if (now - lastStillAt >= 15) {
            agreed += 1;
            lastStillAt = now;
          }
        } else {
          agreed = 0;
        }
        if (agreed >= STILL_READINGS) {
          lift.setValue(origin.y - y);
          /*
           * The COMPOSER's width, which is the whole of the correction: the
           * balloon is born as the field. See `THROW_SPRING` for the frames.
           *
           * `origin.width` and not a constant, and not this file's arithmetic
           * either — the composer measures its own pill and says. Falling back
           * to the balloon's own width means a send that looks like the old
           * one rather than one that does not happen, which is the right way
           * for a measurement to be missing.
           */
          width.setValue(origin.width ?? w);
          setRestingWidth(w);
          return;
        }
        previousY = y;
        tries += 1;
        if (tries > BALLOON_SETTLE_FRAMES) {
          // Something is moving that is not going to stop. Show the message
          // rather than leaving it invisible.
          onArrived?.(message.id);
          setReady(true);
          return;
        }
        timer = requestAnimationFrame(attempt);
      });
    };
    timer = requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      if (timer != null) {
        cancelAnimationFrame(timer);
      }
    };
  }, [composerFrame, lift, message.entering, message.id, onArrived, width]);

  /*
   * Started only once the width style is ATTACHED, which is a render after the
   * value is set.
   *
   * Setting the value and starting the spring in one go runs the animation from
   * the wrong place: the spring begins immediately while `{width}` only reaches
   * the view on the next render, so the first frames are unstyled and the
   * balloon picks the motion up already part-way through. Measured — it enters
   * at 132 points wide where it should enter at 290, which reads as a small
   * nudge rather than the field becoming a bubble.
   *
   * `translateY` has no such problem: the outer box is animated from the start,
   * so setting the value takes effect on the frame it is set.
   */
  useEffect(() => {
    if (restingWidth == null) {
      return;
    }
    const throwIn = Animated.parallel([
      /*
       * The rise: a beat on the composer, then the platform's own spring. There is
       * no second axis — see the `lift` declaration for the measurement that
       * says so.
       */
      Animated.sequence([
        Animated.delay(THROW_DELAY),
        Animated.spring(lift, {
          toValue: 0,
          useNativeDriver: true,
          ...THROW_SPRING,
        }),
      ]),
      /*
       * And the width: the field collapsing to the balloon, past it, and back.
       *
       * Two legs rather than one spring because they are two different
       * animations natively — a scale-down and a scale-up that cross — and a
       * single spring cannot both start at the field's width and undershoot by
       * a fixed FRACTION of the balloon's. That distinction is what made the
       * first attempt at this a deflation: an undershoot proportional to the
       * journey took a two-letter message's balloon through zero.
       *
       * Width is layout, and on the SHARED animated backend layout is exactly
       * what the native driver can do: `width` is in the allowlist alongside
       * `height` and the insets when `useSharedAnimatedBackend` is on, which
       * this app turns on. So the driver is native.
       *
       * NOT `false`. A JavaScript-driven layout property is a `setNativeProps`
       * and a commit PER FRAME, and a commit is the whole surface: measured
       * during a send on this screen, the JavaScript thread runs 40% busy on a
       * Mac, most of it Hermes and Yoga, for one balloon changing width. On a
       * phone that is dropped frames.
       */
      Animated.sequence([
        Animated.timing(width, {
          toValue: restingWidth * SQUASH_TROUGH,
          duration: SQUASH_DURATION,
          easing: SQUASH,
          useNativeDriver: true,
        }),
        Animated.spring(width, {
          toValue: restingWidth,
          useNativeDriver: true,
          ...SWELL_SPRING,
        }),
      ]),
      /*
       * And the HEIGHT: the breath, on the same two legs and the same clocks as
       * the width so the balloon deforms as one shape rather than two. The full
       * `SQUASH_TROUGH` on both axes — natively 65 → 51 → 65 is the same 0.77 —
       * with no clamp, because the text scales down WITH the surface (see the
       * body text's `scaleY`) and so never draws on no balloon.
       */
    ]);
    /*
     * The instrument, and it lives here because nothing outside the app can
     * see this animation.
     *
     * `XCUIElement.tap()` returns when the app is next IDLE, which for a send
     * is after the balloon has landed, and screenshots taken from another
     * thread queue behind it — a sampler written that way measured a widest
     * width of 46 points through a flight that starts above 280. The transform
     * is no better: it lands on `layer.transform`, which `accessibilityFrame`
     * does not read, so the tree reports the resting frame throughout.
     *
     * A listener on the value itself has none of those problems. It is the
     * quantity under test rather than a picture of it, it costs one closure per
     * send, and what it records is published as a label — see `flightTrace`.
     */
    let low = Infinity;
    let high = 0;
    const watch = width.addListener(({value}) => {
      low = Math.min(low, value);
      high = Math.max(high, value);
    });
    /*
     * Revealed HERE, with the flight, and not when the measurement finished.
     *
     * `lift` and `width` are animated values written to the view, but the styles
     * carrying them attach a render after the values are set — which is why this
     * effect exists separately at all (see its own note above). Revealing at
     * measure time races the transform: for one frame the balloon is opaque at
     * its RESTING place, before `lift` drops it to the composer to begin the
     * throw. Deferring by one
     * animation frame does not fix it, because the wait needed is a RENDER, not a
     * frame. Starting the throw is exactly the moment the styles are known to be
     * on the view, so it is the moment it is safe to be seen.
     */
    setReady(true);
    throwIn.start(({finished}) => {
      width.removeListener(watch);
      // Stopped from the cleanup: the flight did not land, and nothing below is true of it.
      if (!finished) {
        return;
      }
      onFlight?.({low, high, resting: restingWidth});
      setRestingWidth(null);
      onArrived?.(message.id);
    });
    /*
     * Stop, and DO NOT clear the resting values here.
     *
     * Clearing them in this cleanup is self-triggering: they are in this
     * effect's own dependency list, so writing them from the cleanup schedules
     * the very re-run whose cleanup just wrote them. The stop/restart pair is
     * also how an interrupted flight is meant to heal — the cleanup stops the
     * old animation and the re-run starts a fresh one from the current resting
     * values — and the completion is what hands the surface back to the layout.
     */
    return () => {
      width.removeListener(watch);
      throwIn.stop();
    };
  }, [lift, message.id, onArrived, onFlight, restingWidth, width]);

  /*
   * The reveal moves MY messages, and leaves everyone else's where they are.
   *
   * Dragging the transcript aside brings the times in from the right, and what
   * has to move to make room is what is already over there — the sent run,
   * against the trailing edge. A received balloon sits against the leading edge
   * with the whole width of the screen between it and the time, so moving it
   * makes no room and reads as the page sliding rather than the times arriving.
   * The native chat moves only the sent side.
   */
  /*
   * A sent balloon slides a little FURTHER than the column it uncovers, so a
   * touch more space opens between it and its time than a received one gets.
   * The native chat leaves the sent side that bit clearer of its timestamp.
   * The extra is a fraction of the drag (`SENT_REVEAL_GAP` over the
   * settled travel), so it scales with the reveal and lands with everything
   * else. Received balloons do not move at all — see below.
   */
  const revealShift =
    reveal != null
      ? Animated.multiply(reveal, -(REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED)
      : 0;
  const shift = mine ? revealShift : 0;
  /*
   * ...and the time column travels a LITTLE further than the transcript does.
   *
   * Two points further, which is the column's landing inset: it starts its own
   * width past the edge and has to end that far inside it, while the balloons
   * move by the width and the inset together. A ratio rather than a distance, so
   * the two land together whatever the drag does.
   *
   * The GAP shrinks by `reveal x (rate - 1)`, so a rate much above one brings
   * the time closer to the balloon the harder the drag.
   *
   * The native times do not move at all while the balloons do, so a rate of
   * one is not the faithful answer either; the times being STATIONARY and the
   * balloons sliding off them is what a reveal looks like there. At 1.04 this is
   * very nearly that.
   *
   * A sent row has already been moved by `shift`, so its column only makes up
   * the difference — and `shift` includes the `SENT_REVEAL_GAP` clearance, so
   * the make-up MUST subtract that too or the sent time rides the extra travel
   * and lands left of the received column. Net = row shift + this, and it has to equal `-reveal x RATE` (the
   * received column) on both sides; solving for this gives
   * `RATE - (REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED`. The bubble
   * still slides its full `shift`, so blue keeps its extra clearance while its
   * time sits in the one shared column.
   */
  const timeShift =
    reveal == null
      ? 0
      : Animated.multiply(
          reveal,
          mine
            ? -(REVEAL_COLUMN_RATE - (REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED)
            : -REVEAL_COLUMN_RATE,
        );
  /*
   * The reveal column is centred on the bubble BODY, so it insets past whatever
   * sits above and below the body in the row: a run-start sender name on top
   * (received balloons have one, sent do not, so the two sides differ in
   * height), and the tail drop plus any open receipt on the bottom. A named
   * variable rather than an inline object so the style stays lint-clean.
   */
  return (
    <AnimatedDiv
      {...(pan != null ? pan.panHandlers : null)}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        separatesRun ? styles.rowEndsRun : styles.rowEndsRunLeaving,
        {
          // Only the reveal drag moves a row sideways. The throw does not —
          // see `lift`, which a row that is not flying does not have.
          transform:
            lift != null
              ? [{translateY: lift}, {translateX: shift}]
              : [{translateX: shift}],
        },
        // Hidden until its destination is still. A sheet entry rather than an
        // inline object so the two states are named things.
        ready ? styles.rowReady : styles.rowWaiting,
      ]}>
      {/* Received messages sit beside a face; sent ones have no such column. */}
      {named && <Avatar from={message.from} show={endsRun} />}
      {/*
        The balloon's SURFACE is a sibling of its text, not a box around it.

        Animating the box's own width reflows what is inside it: the spring
        deliberately undershoots the final width, the text rewraps to fit, and a
        four-character message becomes a one-character-per-line vertical sliver
        for a fifth of a second — a layout animation on a box that lays out text.

        The native chat has no such problem because its balloon is a MASK behind a
        label that never moves. This is the same shape: the text sits in a box
        sized by the text, and the surface is an absolutely-positioned sibling
        pinned to the trailing edge whose width is what springs. Nothing
        reflows, because nothing that lays out text changes size.
      */}
      {/*
        The name sits OUTSIDE the balloon, above it — which is where the platform
        puts it.

        Inside, it is a line of the balloon's own text: it takes the balloon's
        padding, widens the balloon to fit it, and moves with it. Outside, the
        balloon is sized by the message alone and the name is a caption over it.
        That is also why this wrapper exists at all — the row lays out
        horizontally, avatar beside balloon, so a name above the balloon needs a
        column of its own to sit in.
      */}
      <div style={[styles.stack, mine ? styles.stackMine : styles.stackTheirs]}>
        {/* Once per RUN, not once per message: a name says who is speaking, and
            repeating it on every line of the same person's paragraph is noise —
            the same rule the tail follows. */}
        {named && startsRun && <p style={styles.sender}>{message.from}</p>}
        {/*
          A tail only on the LAST message of a run from one sender, which is
          the platform's rule: a tail says who is speaking, and saying it again on
          every line of the same person's paragraph is noise.

          The balloon knows what a tail costs — it is 6.62 points of HEIGHT and
          nothing else — so this says which side and stops there.
        */}
        {/*
          The PLAIN component, not the animated wrapper — and that is the whole
          send animation.

          `createAnimatedComponent` around a composite hands the animated value
          to that composite's own ref through `setNativeProps`, and this one's
          ref is the box, not the surface. Wrapped, `surfaceWidth` arrives as a
          number frozen at whatever it was on the frame the flight began.
          Measured off a recording: the balloon flies in over three frames, sits
          at the composer's full width for sixty-nine of them, then snaps to its
          real width in one — the only change being the re-render at the end.

          Given the value directly, `NativeChatBubble` puts it in the SURFACE's
          own style, and the surface is an animated host element, so the driver
          reaches the view it is meant to move.
        */}
        {/*
          The balloon and its reaction badge share a `relative` box so the badge
          can anchor to the balloon's corner (its `absolute` offsets are measured
          against this wrapper). The badge is the balloon's SIBLING here, never
          its child: the peek lifts the `native-chatbubble` alone, so a reaction
          stays put on the page while the balloon rises above it — the native
          behaviour. The wrapper sizes to the balloon, so it adds nothing to the
          send flight, which springs the surface's width inside the balloon.
        */}
        {/*
          The balloon's LINE: the balloon and its revealed time, which the line
          gives the same height by layout. The time is an absolute child of the
          line, so its band is the balloon's — top to bottom, less the tail's
          drop when the balloon has one — with nothing measured.
        */}
        <div
          style={[
            styles.balloonLine,
            mine ? styles.balloonLineMine : styles.balloonLineTheirs,
          ]}>
          <div style={styles.balloonWrap}>
          <NativeChatBubble
            ref={box}
            tail={TAIL_SIDE[tail]}
            radius={BUBBLE_RADIUS}
            onCommand={event => onCommand?.(message.id, event.nativeEvent.id)}
            /*
             * Take UIKit's own long press rather than the element's timer.
             *
             * With it, the hold, the lift out of the page, the haptic, the blur,
             * the platter and the dismissal are the system's — the same
             * interaction the platform uses. The `<menu>` below says what the platter
             * presents; nothing here draws any of it.
             */
            wantsContextMenu={true}
            style={[styles.bubble, popIn]}
            surfaceStyle={
              mine
                ? [styles.mineBalloon, {backgroundImage: balloonGradient(scheme)}]
                : styles.theirsBalloon
            }
            surfaceWidth={restingWidth != null ? width : undefined}>
            {/*
              The peek's MENU, as a `<menu>` — HTML's list of commands, handed to
              the platform exactly as `<button>` hands its own over.

              The reactions are TWO groups of three, and the split is the platform
              showing through. A group of icons is drawn at
              `UIMenuElementSizeSmall`, UIKit's compact row — which holds four.
              Six in one group came out as a row of four and two ordinary rows;
              two groups of three come out as a tidy three-by-two. The platform fits
              six because its row is not a menu at all but a private accessory
              view hung above the platter, which is not on offer here. See
              `DOM-CSS-LIMITATION(compact-menu-row-holds-four)`.
            */}
            <menu>
              {/*
                Command rows only — Copy, Translate, Select, More. Reactions are not
                in this menu: in a list they read as emoji clutter, and they are
                not where the platform puts them (a floating pill above the platter, a
                private accessory view a `<menu>` cannot produce). So the popout
                is the command menu alone.

                HTML `<li>` with a `system:` icon is how a `<menu>` names a
                platform action; the handler is `applyCommand`. Copy is honest (it
                writes the pasteboard); the others are present for fidelity and
                report rather than pretending at a feature a demo has no backend
                for.
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
            {/*
              The text travels with the surface's LEADING edge, and squeezes
              rather than spilling out of it.

              Both halves come off the native recording. On the frame the
              balloon appears it is the composer's pill, full width, with the
              message where the FIELD's text was — which is `restingWidth - width`
              to the left of where it will end up, because the surface is pinned
              to its trailing edge and the leading one is what moves. And at the
              trough, where the surface is 0.77 of its final width and narrower
              than the text, the native chat compresses the text into it; zoomed in on
              those frames, "Watching the throw" is visibly squashed for about six
              frames before the balloon takes over.

              `scaleX` is clamped at 1 so the text is never STRETCHED: a surface
              wider than the balloon is the field, and the field's text is not
              enlarged, it just sits further left.

              There is no vertical squeeze, deliberately. An animated height
              would pin the surface to an explicit value while the box shrinks
              around it as the tail leaves, and the balloon would GROW. Height
              belongs to the box and its tail reserve alone; the throw is a width.
            */}
            <AnimatedP
              style={[
                styles.bubbleText,
                mine ? styles.mineText : styles.theirsText,
                restingWidth != null && styles.bubbleTextFlying,
                restingWidth != null && {
                  transform: [
                    {translateX: Animated.subtract(restingWidth, width)},
                    {
                      scaleX: width.interpolate({
                        inputRange: [0, restingWidth],
                        outputRange: [0, 1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
              ]}>
              {tooLong ? `${message.text.slice(0, TRUNCATE_PREVIEW).trimEnd()}…` : message.text}
            </AnimatedP>
            {tooLong && (
              /*
               * The chevron that says there is more, at the balloon's trailing
               * edge on the last line — where the native chat draws it. An ornament
               * rather than a character in the text: it has to sit against the
               * edge whatever the last line happens to end with.
               */
              <a
                href="#"
                aria-label="Show the whole message"
                onClick={event => {
                  event.preventDefault();
                  onOpenReader?.(message);
                }}
                style={mine ? styles.moreChevronMine : styles.moreChevronTheirs}>
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
          {/*
            The time, revealed by dragging the transcript aside.

            Parked OUTSIDE the line's right edge, so it never takes width from a
            balloon, and brought in by its OWN translate rather than by the
            row's: the row stopped moving for received messages, and every
            message has a time.
          */}
          {reveal != null && (
            <AnimatedDiv
              style={[
                styles.revealColumn,
                endsRun ? styles.revealColumnTailed : null,
                {transform: [{translateX: timeShift}]},
              ]}>
              <span style={styles.revealTime}>{timeOf(message.at)}</span>
            </AnimatedDiv>
          )}
        </div>
        {/*
          INSIDE the stack, under the balloon it belongs to.

          A sibling of the whole row instead takes the run's own eight points of
          separation between the balloon and its receipt: measured, the ink sits
          11.6 points below the tail's tip where the platform puts it at 3.0.

          In the column the gap is the column's, the run's separation comes after
          the receipt where it belongs, and the trailing alignment is the stack's
          rather than a `text-align` of its own.
        */}
        {/*
          The receipt arrives AFTER the balloon has settled, and its arrival is
          three things at once.

          The order is the point. A receipt that mounts the instant a message is
          sent lands on top of the throw; one that mounts with its own height
          moves everything above it in the same frame its words appear.

          What is wanted is: the balloon settles; THEN the space opens and the
          column slides up; and the ink fades in and grows into it. So the space
          is a `height` transition on the box, and the ink is `opacity` and
          `transform` on the receipt inside it — a SCALE, because it must grow
          from its own centre without moving anything, and a transform is the
          only growth that costs no layout.

          The box's height is measured rather than stated: it is a line of text
          whose size follows the reader's, and the ink's `offsetHeight` reports
          it while the box is still closed — a Yoga child is laid out at its
          content height whatever its parent's box says, and `overflow: hidden`
          is what keeps it out of sight until there is room.
        */}
        {/*
          ALWAYS mounted, and driven entirely by style.

          A CSS transition needs a before-change value, so an element that
          appears or disappears in the same commit as its style change cannot
          transition — it cuts. Mounting this subtree on `showsReceipt !== 'none'`
          puts a mount and a fade in the same frame, which is a flash rather
          than an arrival: the receipt flickers for a frame while its position
          stays still.

          The space has a CLOSED state for exactly this shape — a box of zero
          height with the ink at zero opacity — so keeping the subtree present
          costs a closed box and no layout. Stable identity is what makes
          every change a transition FROM something.
        */}
        {(
          <div
            /*
             * The DEPARTING receipt is not announced, and only that one.
             *
             * A leaving receipt is a second copy of words that are already on
             * screen under the newer message: VoiceOver reads it twice, and
             * `ReceiptCheck` matches the invisible `Delivered` and then fails
             * with "no matches found" asking for the frame of an element it has
             * just seen.
             *
             * NOT applied to `waiting`: `aria-hidden` takes the whole subtree
             * out, and a subtree that is taken out and put back does not come
             * back, so the receipt leaves the tree entirely. A waiting receipt
             * becomes the shown one, so it must never be hidden; a leaving one
             * never returns.
             */
            aria-hidden={
              showsReceipt === 'leaving' || showsReceipt === 'none' ? true : undefined
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
              /* Measured in a layout effect above, not by `onLayout`. */
              elementRef={receiptInk}
              style={
                showsReceipt === 'shown'
                  ? styles.receiptInkShown
                  : showsReceipt === 'leaving'
                    ? styles.receiptInkLeaving
                    : styles.receiptInkWaiting
              }
            />
          </div>
        )}
      </div>
    </AnimatedDiv>
  );
}

/*
 * MEMOISED, and it is load-bearing on a long transcript. `Chat` re-renders on
 * every keystroke — the composer's `draft` lives there — and without this every
 * mounted balloon re-renders for one changed character (two hundred of them on
 * a seeded transcript). Every prop the row takes is a primitive, a stable ref,
 * or a `useCallback`, so the default shallow compare skips a row whose message,
 * run position, receipt state and reaction are all unchanged — which, during
 * typing, is all of them. The send flight still animates: it runs off this
 * bubble's OWN state (`restingWidth`) and `Animated` values, not a
 * parent re-render.
 */
const Bubble = React.memo(BubbleImpl);

/* ------------------------------------------------------------------- chat  */

/*
 * The conversation OUTLIVES the screen. Popping back unmounts `Chat`, and a
 * conversation that forgets its messages, its draft and its reactions on every
 * visit reads as a broken app. The native chat keeps a conversation's state per thread;
 * with one thread, one module-level slot is that store. Transient state — the
 * picker, the typing indicator, in-flight sends — deliberately is not here:
 * it belongs to a visit, not to the conversation.
 */
const persistedChat = {messages: null, draft: '', reactions: null, seed: null};

/*
 * How a long conversation opens.
 *
 * Every row is a `VirtualView`. One that starts NOT hidden renders, measures
 * and mounts its balloon before the first layout can hide it — a thousand
 * balloons of work for a screen that shows twenty. So only the newest rows
 * start that way; the rest start in the view's own hidden mode, a placeholder
 * at an estimated height that renders nothing until the container brings it
 * near the viewport. Rows added later are newest by definition.
 */
const OPEN_ROWS = 40;
const ESTIMATED_ROW_HEIGHT = 60;
const HiddenRow = createHiddenVirtualView({height: ESTIMATED_ROW_HEIGHT});

/*
 * The work one event caused, for the caption: how many times the screen and
 * its rows rendered between the event and its rows reaching the screen, and
 * how long that took. Counted in the render bodies, which is the only place a
 * release build can count a render. One event at a time; the first layout
 * that answers it reports and clears it.
 */
const work = {event: null, since: 0, chat: 0, rows: 0, mounts: 0, longFrames: 0};
/*
 * Whether any of this runs at all. The home screen's switch sets it, and it is
 * off unless someone asks: the counting is cheap but it is not free, and a
 * demo of how a chat performs should not be measuring itself by default.
 */
let profiling = false;
function beginWork(event) {
  if (!profiling) {
    return;
  }
  work.event = event;
  work.since = performance.now();
  work.chat = 0;
  work.rows = 0;
  work.mounts = 0;
  work.longFrames = 0;
}
function endWork(lead) {
  const report =
    `${lead} — ${Math.round(performance.now() - work.since)} ms; ` +
    `Chat ×${work.chat}, rows ×${work.rows} (${work.mounts} mounted)` +
    (work.event === 'scroll' || work.event === 'reveal'
      ? `, long JS frames ×${work.longFrames}`
      : '');
  work.event = null;
  return report;
}
/*
 * A JavaScript frame that arrives late is one the thread was busy through.
 * Two frames at sixty is the line; the loop runs only while a fling does.
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
  const tick = () => {
    const now = performance.now();
    if (now - last > 34) {
      work.longFrames++;
    }
    last = now;
    frameMeter = requestAnimationFrame(tick);
  };
  frameMeter = requestAnimationFrame(tick);
}

function Chat({onExit, seedMessages, onOpenReader, showsPerformance}) {
  // Set before anything counts, including this render's own `work.chat`.
  profiling = showsPerformance === true;
  /*
   * `seedMessages` is the TOTAL conversation length: the home screen's picker,
   * or the app's initial props (`EXP_SEED_MESSAGES` in the launch environment)
   * for the tests. Three is the conversation a person sees, and zero is the
   * empty transcript — a composer with nothing above it, which is a state the
   * layout has to hold as much as a thousand rows is. A persisted conversation
   * is kept only while the seed it was made from stands.
   */
  const seed = seedMessages ?? 3;
  const [messages, setMessages] = useState(() => {
    beginWork('open');
    return persistedChat.messages == null || persistedChat.seed !== seed
      ? mockConversation(seed)
      : /*
         * `entering` (the send flight) and `arriving` (the received pop) are
         * both transient — restored with either on, every remount would replay
         * the animation. Stripped at the boundary.
         */
        persistedChat.messages.map(message =>
          message.entering === true || message.arriving === true
            ? {...message, entering: false, arriving: false}
            : message,
        );
  });
  // Counted after the open began, so the first render is the open's first.
  if (profiling) {
    work.chat++;
  }
  const [draft, setDraft] = useState(() => persistedChat.draft);
  /* The rows that were there when the chat opened; older ones start hidden. */
  const openedWith = useRef(messages.length);
  /*
   * The load caption: how long the chat took to render and to reach the
   * screen. Laid over the transcript's top edge — the scroll view's top inset
   * is where its content begins under the header — rather than in the
   * transcript, whose resting geometry is the platform's and not to be moved.
   */
  const [report, setReport] = useState(null);
  const [captionTop, setCaptionTop] = useState(0);
  const committedAt = useRef(null);
  useLayoutEffect(() => {
    committedAt.current = performance.now();
  }, []);
  // A keystroke changes no row's layout, so it reports from its own commit.
  useLayoutEffect(() => {
    if (work.event === 'typing') {
      setReport(endWork('typing'));
    }
  }, [draft]);
  /*
   * The reaction stuck to each message, keyed by message id. A reaction is NOT a
   * transient like `entering`/`arriving` — once set it stays — so it survives a
   * remount intact rather than being stripped at the boundary. This demo carries
   * one reaction per message (the "React to the last message" command cycles
   * through the six); the native multi-person pile is a separate build.
   */
  const [reactions, setReactions] = useState(() => persistedChat.reactions ?? {});
  const transcript = useRef(null);
  const composer = useRef(null);
  /*
   * Where the composer's pill is IN THE APP'S WINDOW, so a sent balloon can
   * start there.
   *
   * The two halves of it come from DIFFERENT places, and that is the whole
   * subtlety.
   *
   * `x` and `width` are measured on the field itself, which is right: the
   * windows are the same size and aligned, so a horizontal position means the
   * same thing in both.
   *
   * `y` cannot be. Measured on the field it came back about 416 points too
   * low — the accessory is in the keyboard's window and answers in ITS space —
   * and a balloon starting 500 points below its resting place spends five
   * sixths of the flight behind the composer, so the reader sees only the last
   * fifth of the curve. The whole visible rise is
   * SEVEN frames of a four-hundred-millisecond animation.
   *
   * Derived instead from two things that are both in the app's window: this
   * scroll view's own frame and the bottom inset it has reserved, which IS the
   * bar's height because reserving exactly the obstruction is what the element
   * does. The platform starts its balloon the same distance under the same edge —
   * measured on the reference recording, its top begins 4.7 points below the
   * clip of a 60.7-point rise, so 92% of the travel is in view.
   */
  /*
   * Where the send flight starts, assembled from two sources.
   *
   * `y` comes from the transcript's inset below, because the composer's own
   * `measureInWindow` would be in the KEYBOARD's window; `width` and `height`
   * come from the composer's `onFieldSize`, because a layout size is the same
   * in any window and this file cannot derive the pill's width without
   * duplicating the composer's own metrics. Neither half can be taken from the
   * other's place.
   */
  const composerFrame = useRef(null);
  useEffect(() => {
    persistedChat.messages = messages;
    persistedChat.draft = draft;
    persistedChat.reactions = reactions;
    persistedChat.seed = seed;
  }, [messages, draft, reactions, seed]);
  /*
   * How far the transcript is dragged aside to show the times.
   *
   * A responder rather than a scroll view: the transcript scrolls vertically and
   * a horizontal drag is not its gesture, so this claims one only once the
   * finger has clearly gone sideways — twice as far across as down, and at least
   * eight points. Anything less belongs to the list.
   */
  const reveal = useLazily(() => new Animated.Value(0));
  /*
   * Driven natively from the start, rather than from the first settle.
   *
   * Every balloon's time subscribes to this value, so a JavaScript-driven
   * update writes to each of them on every frame of the drag — twenty-one
   * frames over their budget on a three-hundred-message conversation, and far
   * worse on a long one. Native, the drag sends ONE value per move and the
   * views are moved off the JavaScript thread; the drag's own `setValue` keeps
   * JavaScript's copy honest, which is what a row mounted later reads.
   *
   * A value becomes native when an animation asks for it, so this is that
   * animation: it goes nowhere, and it goes there immediately.
   */
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 0,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, [reveal]);
  const pan = useLazily(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (event, gesture) =>
        gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderGrant: () => {
        beginWork('reveal');
        meterFrames(true);
      },
      onPanResponderMove: (event, gesture) => {
        /*
         * iOS's own rubber band, and the reason the drag never bottoms out: the
         * curve approaches its limit without reaching it, so pulling further
         * always does a little more.
         */
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
  /**
   * A command chosen from the balloon's own peek menu.
   *
   * `copy` actually writes the pasteboard — an honest command, unlike a row
   * that pretends. `translate`/`select`/`more` are present for menu fidelity
   * and have no backend in a demo, so they are accepted and do nothing rather
   * than faking a feature.
   */
  /* The messages as of the last commit, for a handler whose identity must not follow them. */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const applyCommand = useCallback(
    (messageId, commandId) => {
      if (commandId === 'copy') {
        const message = messagesRef.current.find(m => m.id === messageId);
        if (message != null) {
          Clipboard.setString(message.text);
        }
      }
      // translate / select / more: no backend in a demo — see the `<menu>`.
    },
    [],
  );
  const transcriptBox = useRef(null);
  /*
   * How much of the transcript is still showing, which the composer asks for
   * when it decides how far to grow — see `Composer`'s `getRoom`. A ref, and
   * read through a callback, because the inset changes on every frame of a
   * keyboard drag and re-rendering the transcript for each of those would be
   * paying for a number only the composer reads and only while typing.
   */
  const room = useRef(null);
  const getRoom = useCallback(() => room.current, []);

  /* Who is currently typing, or null. */
  const [typing, setTyping] = useState(null);

  /* Timers this screen has pending, cleared if it goes before they fire. */
  const pendingTimers = useRef([]);
  useEffect(() => () => pendingTimers.current.forEach(clearTimeout), []);
  const receive = useCallback(() => {
    /*
     * The dots first, then the message — which is the order a real one arrives
     * in and the reason a chat feels live rather than instantaneous.
     *
     * Someone ELSE's message. A reader who has scrolled up must not be moved by
     * it, which is the whole of behaviour 3 — so nothing here scrolls.
     */
    const who = CAST[messages.length % CAST.length];
    setTyping(who);
    const reply = setTimeout(() => {
      setTyping(null);
      /*
       * `arriving` is the received-message POP: a mount-time CSS animation
       * that scales and fades the balloon in, the way the native chat lands an
       * incoming bubble rather than having it blink into place. It is the
       * received counterpart to a sent message's `entering` flight, and like
       * `entering` it must be a TRANSIENT flag — left on, a virtualized
       * remount would replay the pop on every scroll-past (the trap
       * `a-transient-flag-must-be-cleared` records). So it is cleared a beat
       * after the message lands, and stripped on restore just as `entering`
       * is.
       */
      beginWork('receive');
      const base = makeMessage(who, '');
      const message = {
        ...base,
        text: REPLIES[(base.id - 1) % REPLIES.length],
        arriving: true,
      };
      setMessages(current => [...current, message]);
      const settle = setTimeout(() => {
        setMessages(current =>
          current.map(m =>
            m.id === message.id ? {...m, arriving: false} : m,
          ),
        );
      }, RECEIVE_POP_MS + 60);
      pendingTimers.current.push(settle);
    }, 1600);
    pendingTimers.current.push(reply);
  }, [messages.length]);

  /*
   * Behaviour 5's other half: STARTING to compose is a move to the present.
   *
   * The native transcript treats the composer becoming active as its own
   * trigger, a different event from the keyboard arriving. A reader who has
   * scrolled up into last week and taps the field has said they want to write
   * now, so the platform takes them to now; the inset growing underneath them would
   * otherwise leave them reading history with a composer they cannot see the
   * context for.
   *
   * Messenger answers the same question the other way: it shifts everything up
   * by the inset and leaves you where you were. Both are defensible and the
   * element supports both — this is the app's policy, not the scroll view's,
   * which is why it is three lines here rather than a prop.
   */
  const compose = useCallback(() => {
    transcript.current?.scrollToLatest();
  }, []);

  /*
   * Which sent messages have finished arriving.
   *
   * The receipt waits for it. `Delivered` appearing under a balloon that is
   * still in the air says the message got there before it left, and it also
   * moves the balloon: the row grows to make room and everything above shifts.
   * The platform puts the receipt in after the throw lands, which is the only order
   * in which the reader sees one thing at a time.
   *
   * A set rather than a flag on the message, because the message objects are
   * the conversation's data and this is the view's state about them.
   */
  const [landed, setLanded] = useState(() => new Set());
  /*
   * Arrived — and `entering` stops being true, which is the whole of it.
   *
   * `entering` means "is arriving". Left set, a sent message stays permanently
   * mid-arrival: nothing shows while the row stays mounted, and a row is a
   * `VirtualView`, so scroll it far enough away and it unmounts, scroll back and
   * it MOUNTS AGAIN — a fresh mount reads `entering` and starts its arrival
   * over. `ready` initialises to false, the balloon hides, and the flight
   * replays.
   *
   * Only a SENT message ever carries `entering`, which is why blue balloons
   * replay and grey ones do not.
   *
   * So the flag is cleared when the balloon lands. `landed` is kept beside it:
   * it is the parent's record and survives the row, where `ready` cannot.
   */
  const rememberArrival = useCallback(id => {
    setLanded(previous => new Set(previous).add(id));
    setMessages(previous =>
      previous.map(message =>
        message.id === id && message.entering === true
          ? {...message, entering: false}
          : message,
      ),
    );
  }, []);

  /*
   * What the last send's width actually did, published where a test can read it.
   *
   * The send animation is the one thing in this app that cannot be checked from
   * outside: XCUITest's `tap()` does not return until the app is idle, which is
   * after the balloon has landed, and the transform that carries the text is on
   * `layer.transform`, which the accessibility tree does not report. So the app
   * says. `SendMorphCheck` reads this label and asserts on the three numbers in
   * it; without them the case could only assert that a message arrived.
   *
   * The same shape as the safe-area screen's own readout, which is the demo's
   * habit: when a number matters and nothing can see it, put it on the screen.
   * This one is a point square and carries no ink, because a transcript being
   * compared against the native chat cannot afford a caption.
   *
   * It IS in the accessibility tree, which is the point and also the cost: a
   * screen reader lands on it and reads three numbers. Not hidden, because
   * `accessibilityElementsHidden` takes it out of the same tree the test reads —
   * there is no "visible to XCUITest but not to VoiceOver". Rendered only after
   * a send, so a reader who never sends one never meets it, and accepted here
   * because this app exists to be measured.
   */
  const [flightTrace, setFlightTrace] = useState(null);
  const rememberFlight = useCallback(({low, high, resting}) => {
    setFlightTrace(
      `flight ${low.toFixed(1)} ${high.toFixed(1)} ${resting.toFixed(1)}`,
    );
  }, []);

  /*
   * The last message that was SENT, which is the only one wearing a receipt.
   * Derived rather than stored, because "the last one" changes whenever the
   * list does and an index would go stale on a reset.
   */
  /*
   * Which message is WEARING the receipt, which is not always the last one sent.
   *
   * The platform never leaves the transcript without one. Measured off a recording
   * of it beside ours, same send, same window: its previous `Read 4:13 PM` stays
   * on screen through the new balloon's arrival and through `Delivered`, and
   * only goes when `Read 4:14 PM` takes over about 1.5 seconds later.
   *
   * Removing the old one the instant the message is sent and putting the new one
   * up when it lands leaves **2.2 seconds with no receipt anywhere**, which is
   * the read indicator flickering: the arrival is right, and so is the departure
   * on its own; they do not overlap.
   *
   * So the receipt stays on the PREVIOUS sent message until the newest one is
   * ready to wear it. The newest still holds its space while it waits — see
   * `showsReceipt` — so nothing moves when the two swap.
   */
  // The last two sent messages, from the end: a receipt concerns no others.
  let lastSent = -1;
  let previousSent = -1;
  for (let i = messages.length - 1; i >= 0 && previousSent < 0; i--) {
    if (messages[i].from === 'me') {
      if (lastSent < 0) {
        lastSent = i;
      } else {
        previousSent = i;
      }
    }
  }
  const lastSentReady =
    lastSent >= 0 &&
    (messages[lastSent].entering !== true || landed.has(messages[lastSent].id));
  const wearsReceipt = lastSentReady ? lastSent : previousSent;

  const send = useCallback(() => {
    const text = draft.trim();
    if (text === '') {
      return;
    }
    const sent = makeMessage('me', text, true);
    beginWork('send');
    setMessages(previous => [...previous, sent]);
    setDraft('');
    /*
     * Delivered, then Read — the two states in sequence rather than one of
     * them, because the interesting part is that the line CHANGES under a
     * message that is already on screen and does not move anything when it
     * does. A receipt that grew the row would push the transcript, which is
     * exactly what the native chat is careful not to do.
     */
    pendingTimers.current.push(
      setTimeout(() => {
        setMessages(previous =>
          previous.map(message =>
            message.id === sent.id
              ? {...message, status: 'Read', readAt: Date.now()}
              : message,
          ),
        );
      }, BALLOON_SETTLE + 900),
    );
    // Behaviour 4: the user's OWN message means "take me to the present",
    // wherever they were reading. The anchor deliberately does not do this.
    transcript.current?.scrollToLatest();
    /*
     * NO automatic reply.
     *
     * A reply a beat after each send would be wrong twice over: it would
     * arrive while the balloon was still flying, so two animations run on one
     * list and read as jitter — and even sequenced it is a machine talking back
     * at you, which is not a behaviour the native chat has and not something a demo
     * should spend the reader's attention on. "Receive a message" is in the `+`
     * menu, for when the arriving case is what you want to look at.
     */
  }, [draft]);

  /*
   * The states worth looking at, behind the `+` the way the platform puts its own
   * options there. A row of buttons under the field is not something the native
   * chat has, and takes a second line of the bar to draw.
   */
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
      id: 'react',
      symbol: 'heart',
      tint: 'systemPink',
      label: 'React to the last message',
      /*
       * Sticks a reaction on the newest balloon, cycling through the six on
       * repeated taps. The native chat sets a reaction from a pill floating above the
       * held balloon's platter — a private accessory view a `<menu>` cannot make
       * (see [[reactions-peek-architecture]]) — so the demo triggers it from the
       * panel the same way it triggers every other transcript state. The DISPLAY
       * (the corner badge) is the faithful half; where the picker lives is the
       * platform limitation.
       */
      onPress: () =>
        setReactions(previous => {
          const last = messages[messages.length - 1];
          if (last == null) {
            return previous;
          }
          // A message's reactions are an array; YOURS is the first slot, and
          // the others (from `react-others`) keep their places behind it.
          const current = previous[last.id] ?? [];
          const next = [cycleReaction(current[0]), ...current.slice(1)];
          return {...previous, [last.id]: next};
        }),
    },
    {
      id: 'react-others',
      symbol: 'person.2',
      tint: 'systemPink',
      label: 'Others react to the last message',
      /*
       * Two more participants react to the newest message, which is what turns
       * the single corner badge into the native AGGREGATE pile — its container
       * is 46×40 against a lone badge's 36, measured on the platform. Distinct
       * reactions so the pile
       * shows more than one face; a demo has no real other participants, so this
       * stands in for them the same way the panel stands in for every state.
       */
      onPress: () =>
        setReactions(previous => {
          const last = messages[messages.length - 1];
          if (last == null) {
            return previous;
          }
          const current = previous[last.id] ?? [];
          const toAdd = ['ha', 'up', 'bang'].filter(
            id => !current.includes(id),
          );
          return {...previous, [last.id]: [...current, ...toAdd.slice(0, 2)]};
        }),
    },
    {
      id: 'earlier',
      symbol: 'arrow.up.to.line',
      tint: 'systemBrown',
      label: 'Load earlier messages',
      /*
       * PREPENDED, which is the case a bottom-anchored list has to survive and
       * the one nothing else here exercises.
       *
       * Appending happens below the reader and moves nothing. Prepending adds
       * height ABOVE them, and since a scroll offset is measured from the top,
       * everything they are looking at slides down by exactly what arrived
       * unless the view corrects for it. `<native:scroll>` does that correction
       * for `contentAnchor="bottom"` — see `-mountingTransactionWillMount:` —
       * and `AnchorCheck` is what says so.
       *
       * Ids count DOWN, because these are older than everything already there
       * and an id has to say which.
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
      /*
       * Back to the conversation this screen was opened with, whatever the home
       * screen asked for — including none, which is how the transcript is
       * emptied without leaving the screen.
       */
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
          onClick={() => setReport(null)}>
          {report}
        </p>
      )}
      {/* The send's own numbers, for `SendMorphCheck` — see `flightTrace`. */}
      {flightTrace != null && (
        /*
         * `accessible` is what puts it in the tree. A label alone does not: on
         * a `<div>` with no children it names an element that was never made
         * one, and `SendMorphCheck` finds nothing at all.
         */
        <div accessible={true} aria-label={flightTrace} style={styles.trace} />
      )}
      <NativeScroll
        /* The header's fade is the scroll view's top edge effect; iOS 27 defaults it to a hard cut. */
        edgeEffects={{top: 'soft'}}
        ref={element => {
          transcript.current = element;
          transcriptBox.current = element;
        }}
        onInsetChange={event => {
          const {inset, containerSize} = event.nativeEvent;
          setCaptionTop(inset.top);
          /*
           * What is left of the transcript, which is what the composer is
           * allowed to grow into — see `Composer`'s `room`. The header's
           * reserve is `inset.top`, so this is measured BELOW the header and a
           * composer that takes all of it stops exactly where the native one does.
           */
          room.current = Math.max(
            0,
            containerSize.height - inset.top - inset.bottom,
          );
          /*
           * And the composer's top edge with it, in THIS view's window — see
           * `composerFrame`. Taken here rather than at send time because this
           * is the event that means it moved: the inset is the bar's height,
           * so a new inset is a new edge.
           */
          transcriptBox.current?.measureInWindow?.((x, y, width, height) => {
            if (height > 0) {
              composerFrame.current = {
                ...composerFrame.current,
                y: y + height - inset.bottom + BAR_TOP_PADDING,
              };
            }
          });
        }}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        onMomentumScrollBegin={() => {
          beginWork('scroll');
          meterFrames(true);
        }}
        onMomentumScrollEnd={() => {
          meterFrames(false);
          if (work.event === 'scroll') {
            setReport(endWork('scroll'));
          }
        }}
        contentAnchor="bottom">
        {/*
          The responder is on the CONTENT, not on the scroll view.

          A scroll view's own pan is a gesture recogniser, and taking that away
          would take the list's scrolling with it. This claims a touch only once
          it has clearly gone sideways, which is a question the responder system
          asks on every move and the recogniser never has to answer.
        */}
        {/* The transcript's own box, for the arithmetic above. */}
        {messages.map((message, index) => {
          const Row =
            index < openedWith.current - OPEN_ROWS ? HiddenRow : VirtualView;
          const previous = messages[index - 1];
          const next = messages[index + 1];
          /*
           * The native chat GROUPS a run from one sender, and the grouping is three
           * things at once: the tail is on the last of the run, the sender's
           * name is on the first, and the gap within a run is tighter than the
           * gap between them. Any one of the three alone reads as a bug — and
           * the one non-obvious rule, that a message wearing the receipt keeps
           * its tail (`index === wearsReceipt`), keeps the
           * receipt line still through a second send. The rules and why are in
           * `runFlags`; `runGrouping-test.js` guards them.
           */
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
              Each message is a `VirtualView`, so a long history costs the tree
              only what is near the viewport.

              The whole ROW, stamp included, because the stamp belongs to the
              message under it and a stamp left behind by a hidden balloon is a
              date with nothing after it. Hidden, the row renders nothing and
              keeps its measured height, so the scroll range and the bottom
              anchor see the same list either way.

              A message on its way in is wrapped like any other, and safely: a
              sent message is at the BOTTOM, where the viewport is, so it is
              never hidden while it is flying. By the time one could be, it has
              landed and been re-measured at its resting size.
            */
            <Row key={message.id} nativeID={`msg-${message.id}`}>
              {stamp != null && (
                <Stamp
                  day={stamp.day}
                  time={stamp.time}
                  /* Arriving only if this row was not here when the screen
                     opened: the stamps above an existing conversation were
                     always there and have nothing to arrive from. */
                  arriving={index >= openedWith.current}
                />
              )}
              <Bubble
                message={message}
                composerFrame={composerFrame}
                tail={endsRun ? mineSide(message) : ''}
                startsRun={startsRun}
                endsRun={endsRun}
                separatesRun={separatesRun}
                onCommand={applyCommand}
                onOpenReader={onOpenReader}
                onArrived={rememberArrival}
                onFlight={rememberFlight}
                /*
                 * THREE states, not two: shown, holding its space, and absent.
                 * A message on its way owns the space its receipt will take, so
                 * that nothing moves when the words arrive. See the render.
                 *
                 * The outgoing receipt is NOT animated away. Keeping it mounted
                 * at `'waiting'` so it closes on the springs that opened it puts
                 * two receipts on screen together and shuts the old one late:
                 * the collapse does not run when the send does, so the earlier
                 * receipt drops instead of scaling out.
                 */
                showsReceipt={
                  index === wearsReceipt
                    ? 'shown'
                    : index === lastSent
                      ? 'waiting'
                      : index === previousSent && lastSentReady
                        ? 'leaving'
                        : 'none'
                }
                reveal={reveal}
                pan={pan}
                reactions={reactions[message.id]}
              />
            </Row>
          );
        })}
        {typing != null && <TypingIndicator from={typing} />}
        {/*
          Laid out with the rows, after the first mount — the moment the
          conversation is on screen, which nothing in JavaScript can otherwise
          know.
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
      </NativeScroll>

      {/*
        The material is on the BAR, not on a box inside it.

        A docked accessory is taller than the content React laid out — it
        reaches through the home indicator's strip to the bottom of the screen —
        and a child box can only ever be as tall as its own layout. Written on
        one, the surface stops at the content's edge and leaves the last
        thirty-four points bare, which reads as a seam under the bar.

        NOT a `linear-gradient` of translucent white, which is wrong twice: a
        colour, so it stays white in dark mode, and merely translucent, so the
        transcript behind it stays sharp and bubbles read as sitting ON the
        buttons. A material blurs what is behind it, which is
        the signal that says this is chrome and that is content — and it has no
        colour of its own to keep in step with the appearance.
      */}
      <ComposerBar>
        <Composer
          /* A conversation with a draft opens ready to finish it: the field
             asks for the keyboard as it enters the window, inside the push, and
             the covered screen hands it over rather than dismissing it. An
             empty composer opens with the keyboard down. */
          autoFocus={draft !== ''}
          value={draft}
          onChangeText={text => {
            beginWork('typing');
            setDraft(text);
          }}
          onSend={send}
          onFocus={compose}
          inputRef={composer}
          /*
           * The pill's own size, into the same ref the inset writes `y` into.
           * Two halves of the field's frame from the two places that can
           * measure them honestly — see `onFieldSize` in `Composer`.
           */
          onFieldSize={size => {
            composerFrame.current = {...composerFrame.current, ...size};
          }}
          actions={actions}
          getRoom={getRoom}
        />
      </ComposerBar>
    </div>
  );
}

const styles = StyleSheet.create({
  /*
   * `display: 'flex'` is written out on every flex container in this file.
   *
   * `<div>` is display:block, which is correct and is the whole point of the
   * element — where `View` is flex by default and applies
   * `flexDirection`/`gap`/`justifyContent` without being asked for. Under block
   * layout those are simply ignored: rows stack, and every gap between items
   * goes.
   */
  /*
   * A point square in the corner, carrying a label and no ink. The send's
   * measurements have to leave the app somehow and a caption on a transcript
   * being compared against the native chat is not an option — see `flightTrace`.
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
  /*
   * The space above the first message and below the last, both the platform's:
   * 15.667 above and 16 below.
   */
  transcriptContent: {paddingTop: 15.667, paddingBottom: 16},
  /*
   * Two points between messages in a run, eight after it.
   *
   * The native spacing is what makes a run read as one person speaking rather
   * than as several separate remarks, and the difference between the two gaps
   * is the whole signal.
   */
  row: {
    display: 'flex',
    /*
     * SIXTEEN, measured off the native chat on a 393-point window: a received
     * balloon's left edge is at 16.0 and a sent one's right edge at 376.7, so
     * 16.3 the other side.
     *
     * Not the same number as the composer's trailing margin, which is twelve —
     * see `COMPOSER_MARGIN_TRAILING`. The transcript and the bar are measured
     * separately because the platform measures them separately.
     */
    paddingHorizontal: TRANSCRIPT_MARGIN,
    paddingTop: 2,
    paddingBottom: 2,
    flexDirection: 'row',
  },
  /*
   * The revealed time, parked OUTSIDE the balloon's line.
   *
   * Just past the screen's edge, so the column costs nothing until it is asked
   * for: off screen it takes no width, no touch and no place in the
   * accessibility tree. Laying it out in flow would take its width away from
   * every balloon whether or not anyone ever dragged.
   *
   * The band is the line's: top to bottom, which is the balloon's height —
   * and `revealColumnTailed` lifts the bottom clear of the tail's drop, so a
   * run-ending balloon carries its time where every other balloon does.
   */
  revealColumn: {
    position: 'absolute',
    right: -REVEAL_LINE_OFFSET,
    top: 0,
    bottom: 0,
    /*
     * Wider than the column OCCUPIES, by exactly the trailing padding below.
     * The width the balloons move for is `REVEAL_SETTLED`, and this box is
     * positioned, not in flow, so its own width costs nothing — but the ink
     * needs `REVEAL_COLUMN` of content space to its left of the padding, or
     * "11:48 PM" wraps to two lines inside a box the padding had narrowed.
     * The extra points hang over the transcript's edge at rest, empty.
     */
    width: REVEAL_BOX_WIDTH,
    display: 'flex',
    alignItems: 'center',
    /*
     * The times are right-aligned to ONE trailing edge — the transcript's own
     * margin — which is how the platform parks them: "11:04 PM" and "3:41 PM" end
     * in the same place, sixteen points in from the screen, and only their
     * leading edges differ. Laid out from the leading edge instead, a narrow
     * time sat right and a two-digit hour ran to the screen's edge. The
     * fourteen is the margin minus the column's own two-point landing.
     */
    justifyContent: 'flex-end',
    paddingRight: TRANSCRIPT_MARGIN - REVEAL_COLUMN_LANDING,
  },
  /* The drop is the balloon's only where a tail is drawn; elsewhere the band is
     the whole balloon, because the whole balloon is the body. */
  revealColumnTailed: {
    bottom: CHAT_BUBBLE_DRAWS_TAIL ? CHAT_BUBBLE_TAIL_DROP : 0,
  },
  /* Centred on the balloon, not sitting on its first line. */
  revealTime: {
    /* Never shrunk to the box: a flex child defaults to shrinking, and a
       shrunk span WRAPS "11:48 PM" into two lines instead of overflowing. */
    flexShrink: 0,
    fontSize: 11,
    /*
     * Tabular figures, because this is a COLUMN of numbers. The times are
     * right-aligned to one trailing edge, and with proportional figures a
     * "1:11 PM" and a "10:00 PM" drag differently-shaped left edges past the
     * reader as the rows reveal together; equal-width digits are what makes a
     * revealed column read as a table instead of a ragged list.
     */
    fontVariant: ['tabular-nums'],
    color: uiColor('secondaryLabel'),
    /*
     * One line, whatever the time says. Without it a column a hair too narrow
     * for its contents wraps rather than overflowing, and "10:38 PM" becomes two
     * lines of five points each in the middle of a transcript.
     */
    whiteSpace: 'nowrap',
    marginBlock: 0,
  },
  /* The receipt's space, held while the message it belongs to is still on its
     way. See the render — the height is the point, the ink is not. */
  /*
   * The space the receipt opens, and the ink that grows into it.
   *
   * A TRANSITION on both, not an animation. An animation
   * runs from the moment its element mounts, which was right while the receipt
   * mounted at the moment it became visible and wrong as soon as it started
   * mounting early: it faded in behind an invisible box, finished, and the box
   * switched to opaque in one frame. A transition runs on a CHANGE, which is
   * what "the balloon has landed" is, and it also cannot re-run when a row
   * scrolls off and back — mounting at the final value is a starting value and
   * not a change.
   *
   * Declared on BOTH faces of each pair. A transition that arrives in the same
   * commit as the value it should animate has nothing to animate from.
   *
   * `overflow: hidden` is what makes the closed box hide a receipt that is laid
   * out at its full height inside it — see the comment at the call site.
   */
  receiptSpace: {
    overflow: 'hidden',
    alignItems: 'flex-end',
    transitionProperty: 'height',
    transitionDuration: `${RECEIPT_SPACE}ms`,
    /* The tail's curve — see `RECEIPT_LAYOUT_CURVE`. Sharing the duration is
       not enough on its own; two boxes easing differently over the same 250ms
       still move the column twice. */
    transitionTimingFunction: RECEIPT_LAYOUT_CURVE,
  },
  /*
   * The "there is more" chevron. Positioned against the balloon's trailing
   * edge and baseline-ish on its last line; the tail's own drop is why the
   * bottom is not zero.
   */
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
   * The space a LEAVING receipt gives back.
   *
   * Same zero height as `receiptSpaceClosed`, and it closes over the shared
   * layout window with no delay — but it stops clipping while it does, which is
   * the whole of the difference and the reason this state exists.
   */
  receiptSpaceLeaving: {
    height: 0,
    /*
     * Not clipping, so the ink can fade where it stands while the box goes.
     *
     * Three arrangements, each measured off the balloon above it:
     *
     *   closing at once, still clipping   the ink is cut off, not faded — solid
     *                                     on one frame, gone 65ms later
     *   closing after the fade            the ink fades, and the column rises
     *                                     13.3pt as the new space opens and
     *                                     falls 13.3pt back when this one shuts,
     *                                     600ms apart: a wobble that reads as a
     *                                     jump once everything has settled
     *   closing with the fade, uncl'pped  the words dissolve in place over the
     *                                     same hundred milliseconds the column
     *                                     takes to close over them
     *
     * The third is the native one: `RECEIPT_LEAVE_MS` is `RECEIPT_LAYOUT_MS`, so the
     * ink is gone by the time its row is, and nothing is left overlapping. The
     * clipping has to go for that — a box animating to zero height clips its
     * contents from the first frame, which turns a fade into a wipe.
     */
    overflow: 'visible',
  },
  /*
   * Going, and it is NOT the arrival run backwards.
   *
   * It leaves by FADING, at full size, in the window its row is closing in —
   * and then nothing is on screen for a quarter of a second. The platform does not
   * cross-fade the two: ink counted per frame in the old receipt's row goes 154,
   * 121, 0 across t=2530 to t=2630, and the new one does not appear until
   * t=2880. What looks like both at once is one of them fading while the column
   * moves under it. See `RECEIPT_HANDOVER_GAP_MS`, which is that pause.
   *
   * No scale, which is the difference from `receiptInkWaiting`. That state is
   * the ink before it has ever been seen, and it starts small because it is
   * about to grow. This one has been read; shrinking it would be a second
   * animation on something the reader has already finished with.
   */
  receiptInkLeaving: {
    opacity: 0,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity',
    /*
     * Its OWN duration, and a short one.
     *
     * Measured off the native chat by counting the old receipt's ink per frame: 154,
     * then 121, then nothing — about a hundred milliseconds, with the column
     * sliding up in the same window. On the arrival's 600 it would be
     * nearly a second of a receipt that has already been read hanging about
     * over a moving column.
     */
    transitionDuration: `${RECEIPT_LEAVE_MS}ms`,
    transitionTimingFunction: 'ease-out',
  },
  receiptInkWaiting: {
    opacity: 0,
    transform: [{scale: RECEIPT_GROW_FROM}],
    /*
     * The CENTRE, which is what it looks like beside the native chat.
     *
     * Not the trailing edge, whatever a bounding-box measurement suggests: a
     * bounding box is not a transform, and right-aligned text whose width
     * changes for any reason reads as a right-anchored scale.
     */
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${RECEIPT_FADE}ms, ${RECEIPT_GROW}ms`,
    transitionTimingFunction: 'ease-out',
  },
  /*
   * The ink waits for the space, and `transition-delay` is how that is said.
   *
   * Without it the words finish growing before the column has begun to move,
   * and the reader gets the label before the room for it.
   *
   * The delay is `RECEIPT_INK_DELAY_MS`, which is longer than the space it is
   * waiting on — the old receipt has to be gone AND the pause after it served
   * before this one is allowed to start. So the order is: the old ink dissolves
   * as its row closes and this one opens, a quarter second of nothing, then the
   * words.
   *
   * On the way OUT there is no delay, because there is no way out: a receipt
   * that exists stays.
   */
  receiptInkShown: {
    opacity: 1,
    transform: [{scale: 1}],
    transformOrigin: '50% 50%',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${RECEIPT_FADE}ms, ${RECEIPT_GROW}ms`,
    transitionDelay: `${RECEIPT_INK_DELAY_MS}ms`,
    transitionTimingFunction: 'ease-out',
  },
  /* A sent balloon is invisible until the list it is joining has settled. */
  rowWaiting: {opacity: 0},
  rowReady: {opacity: 1},
  /*
   * The space BETWEEN runs, which the last row in the transcript does not pay
   * — see `separatesRun`. The two directions of the change animate
   * DIFFERENTLY, and css-transitions-1 §3 is the mechanism: a transition runs
   * on the after-change style's declaration, so declaring it on only one face
   * makes the change one-way.
   *
   *   - GAINING the separation happens at a send, inside the same commit as
   *     the insert — and the send flight owns that movement. A declaration
   *     here makes the whole column glide 250ms under the throw: two writers,
   *     and the send path goes linear and skips frames.
   *   - LOSING it happens at the receipt handover, where everything else that
   *     moves the column is already on this clock — so the after-change face
   *     (`rowEndsRunLeaving`) declares it, and the eight points leave with
   *     the tail and the receipt instead of snapping.
   */
  rowEndsRun: {paddingBottom: 8},
  /*
   * TWO, not zero. This declaration overrides the row's own `paddingBottom`,
   * so landing at zero silently halves the gap between grouped bubbles: the
   * base style says 2, and zero here renders every non-separating row
   * 2 points from its neighbour where the native chat renders 4 — measured at
   * exactly 12px @3x against ours at 6. The leave
   * animates 8 → 2, and the resting value IS the base style's, restated
   * because a cascade override cannot decline to answer.
   */
  rowEndsRunLeaving: {
    paddingBottom: 2,
    transitionProperty: 'padding-bottom',
    transitionDuration: `${RECEIPT_LAYOUT_MS}ms`,
    transitionTimingFunction: RECEIPT_LAYOUT_CURVE,
  },
  rowMine: {justifyContent: 'flex-end'},
  rowTheirs: {justifyContent: 'flex-start'},
  /*
   * The box the TEXT lays out in. It never changes size, which is the point.
   * `position: relative` so the surface behind it can be pinned to its edges.
   */
  /*
   * The text's box inside the balloon, measured off the native chat.
   *
   * Its one-line balloon is 40 tall and holds a 17-point line: the glyph's cap
   * sits 14 points below the top and its baseline 14 above the bottom, which
   * puts the padding either side of a 21-point line box at ten. Horizontally
   * the ink starts 16 in, which is 14 of padding and the glyph's own bearing.
   *
   * The tail takes no width, so nothing is added on the tail side: a balloon's
   * text is inset the same on both.
   */
  bubble: {
    /*
     * A POINT cap, not a percentage, and the reason is the column the name sits
     * in.
     *
     * A percentage resolves against the containing block, and the balloon's is
     * that column rather than the row. A flex item sized by `flexGrow`
     * has a width the layout computes rather than one the style states, and the
     * percentage comes back unresolved: every balloon runs the full width of the
     * screen and the text stops wrapping.
     *
     * The window's width is the same quantity the row's is derived from, so
     * this is the number a percentage of the row would give. It does not follow a
     * rotation, which this demo does not do, and the alternative — an explicit
     * width on the column — would make the balloon's own size depend on a box
     * that exists only to hold a caption.
     */
    maxWidth: BALLOON_MAX_WIDTH,
    /* The balloon's shape inset from its text box — see `BUBBLE_PADDING`. */
    paddingHorizontal: BUBBLE_PADDING,
    paddingVertical: BUBBLE_PADDING_V,
    position: 'relative',
  },
  /*
   * The dots' own row, and the cluster's breath — see `TypingIndicator` for
   * where every number comes from.
   */
  /*
   * The cluster's box, which is what breathes — the bubble and both tail
   * circles together, so the whole shape pulses rather than the dots inside a
   * still bubble.
   */
  typingCluster: {
    position: 'relative',
    width: 78.5,
    height: 43,
    animationKeyframes: TYPING_BREATH_FRAMES,
    animationDuration: `${TYPING_PULSE}ms`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  /* The arrival — see `TYPING_GROW_DELAY`. One pass, and the committed style is
     where the last keyframe leaves it, so nothing has to be held. */
  typingEntry: {
    animationKeyframes: TYPING_GROW_FRAMES,
    animationDelay: `${TYPING_GROW_DELAY}ms`,
    animationDuration: `${TYPING_GROW}ms`,
    animationTimingFunction: 'ease-out',
    transformOrigin: 'left center',
  },
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
  /* The native medium bubble's offset is x 7, y -7.5 — seven in
     from the edge and seven and a half up from the small one's row. */
  typingMedium: {
    position: 'absolute',
    left: 7,
    top: TYPING_BUBBLE_H - TYPING_MEDIUM / 2 - 2,
    width: TYPING_MEDIUM,
    height: TYPING_MEDIUM,
    borderRadius: TYPING_MEDIUM / 2,
    backgroundColor: BUBBLE_GREY,
  },
  /* The native small bubble's frame is `{2, 38, 5, 5}` exactly. */
  typingSmall: {
    position: 'absolute',
    left: 2,
    top: 38,
    width: TYPING_SMALL,
    height: TYPING_SMALL,
    borderRadius: TYPING_SMALL / 2,
    backgroundColor: BUBBLE_GREY,
  },
  /* Layout only: the breath is on `typingCluster`, so the bubble and its
     two tail circles pulse together rather than the dots alone. */
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
    /*
     * The beat, as four style properties. `alternate` is `autoreverses`, and the
     * committed `opacity` below is the stop it rests at — so a dot that has not
     * started yet, because of its delay, is already the right colour.
     *
     * The cubic is the platform's own, off the native layer's `CAKeyframeAnimation`.
     */
    animationKeyframes: TYPING_BEAT_FRAMES,
    animationDuration: `${TYPING_BEAT}ms`,
    animationTimingFunction: 'cubic-bezier(0.75673, 0.015306, 0.58, 1)',
    animationDirection: 'alternate',
    animationIterationCount: 'infinite',
    opacity: 0.2,
    /*
     * BLACK at a fifth, not a grey at full strength.
     *
     * The native typing indicator's dot is monochrome 0 with the layer's opacity
     * at 0.2, which over the received balloon's own grey comes out at about
     * (187, 187, 188). `label` is the semantic spelling of that black — white in
     * dark mode, where the native chat flips it the same way by the transcript's
     * background luminance.
     */
    backgroundColor: uiColor('label'),
  },
  mineBalloon: {experimental_backgroundAttachmentFixed: true},
  /*
   * Both bubble fills are SEMANTIC, so they follow the appearance. A literal
   * `#e5e5ea` is correct in light mode and, in dark, a pale grey slab carrying
   * `CanvasText`, which is white there: white on ice grey, unreadable, and
   * invisible to anyone testing in light mode.
   */
  /*
   * The sent bubble is a WINDOW onto a screen-sized gradient, which is what
   * makes two bubbles at different heights different colours and one bubble
   * change shade as it climbs.
   *
   * `background-attachment: fixed` is the whole mechanism: the background's
   * positioning area becomes the viewport instead of this box, so every bubble
   * shares one gradient and pixels at the same screen position are the same
   * colour. The platform does the same thing: its gradient tracks the screen
   * position too.
   *
   * Driving each bubble's `backgroundColor` from the scroll offset through
   * `Animated` draws the same picture in the wrong shape — a declaration about
   * what the background IS, expressed as a subscription to scrolling — and costs
   * a JavaScript frame, because `useNativeDriver: true` silently does nothing on
   * this element.
   */
  theirsBalloon: {backgroundColor: BUBBLE_GREY},
  /*
   * 17 points, which is the body size the platform uses — and the size the rest of
   * iOS uses for a row's title.
   */
  mineText: {
    color: '#ffffff',
    fontSize: 17,
    lineHeight: MESSAGE_LINE_HEIGHT,
    marginBlock: 0,
  },
  theirsText: {
    color: systemColor('CanvasText'),
    fontSize: 17,
    lineHeight: MESSAGE_LINE_HEIGHT,
    marginBlock: 0,
  },
  /*
   * Right-aligned under the bubble, at the native receipt's own size and colour.
   * The native status colour is `#3C3C43` at 60% — the recipe for `secondaryLabel`,
   * which is what is written here so it follows the appearance.
   */
  /*
   * Under the balloon's trailing edge, and inset from it.
   *
   * Measured off the native chat on a 393-point window: the receipt's ink ends at
   * 368.3 where the balloon's edge is at 376.7 — EIGHT points inside it, not
   * flush — and its ink is 7.67 points tall, which is the cap height of an
   * eleven-point line.
   *
   * The margin is stated from the window rather than from the balloon because
   * the receipt is a sibling of the row rather than a child of it: the balloon's
   * own edge is `TRANSCRIPT_MARGIN` in, and this is that plus the inset.
   */
  receipt: {
    fontSize: 11,
    marginBlock: 0,
    /*
     * MINUS ONE, measured natively on this simulator.
     *
     * The native chat will send to itself over SMS here, so there is a real balloon
     * with a real receipt to measure — see the README. On the same window, same
     * two-line message, same threshold:
     *
     *                                   native     ours
     *   receipt ink below the body       8.00 pt   11.00 pt
     *   receipt ink below the tail's tip 1.33 pt    4.33 pt
     *
     * Three points, all of it here. The value is negative
     * because the line box has its own leading above the ink, and the platform puts
     * the ink nearer the tail than that leading allows.
     */
    /*
     * Where no tail is drawn the box ends at the BODY rather than a tail's tip,
     * and the same margin would put the ink a drop closer to the balloon than
     * the platform puts it. The tail's height becomes the receipt's space —
     * plus three, because the gap is read against what is directly above it: a
     * tail's tip is a narrow point of ink, a tailless balloon ends in a flat
     * edge the width of the message, and the same distance under a wide edge
     * looks shorter.
     */
    marginTop: -1 + RECEIPT_AIR,
    /* Aligned with the balloon's glyphs — see `RECEIPT_INSET`. */
    marginRight: RECEIPT_INSET,
    /* Equal-width digits, same as the reveal column's — a receipt's time is
       the same kind of number and should not reflow the line as it ticks. */
    fontVariant: ['tabular-nums'],
    color: uiColor('secondaryLabel'),
  },
  /* The word, in the native status font — see `Receipt`. */
  receiptStatus: {fontWeight: '600'},
  /*
   * The date separator, centred, in the same secondary colour as a receipt.
   * The native chat shows one at the top of a conversation and whenever there is a
   * real gap in time — not between every message.
   */
  stamp: {
    /*
     * ELEVEN, both ways round: the native separator's text attributes
     * set Caption2 at 11, and measured off a real separator on this simulator
     * the ink of "Today 3:25 AM" is 10.0 points from the T's cap to the y's
     * descender, which is 11-point text and not twelve.
     */
    fontSize: 11,
    textAlign: 'center',
    marginBlock: 0,
    marginTop: 16,
    marginBottom: 10,
    color: uiColor('secondaryLabel'),
  },
  /* The two faces of a stamp's arrival. The centring is the row's and neither
     face touches it. */
  stampWaiting: {opacity: 0},
  stampShown: {
    opacity: 1,
    transitionProperty: 'opacity',
    transitionDuration: `${STAMP_FADE}ms`,
    transitionTimingFunction: 'ease-out',
  },
  /*
   * The DAY is heavier than the time beside it, and it is MEDIUM rather than
   * semibold: measured on the same separator, "Today" draws a 1.0-point stem
   * against the time's 0.67 to 1.0, and semibold at this size is 1.24. The
   * receipt's own word is the semibold one — see `receiptStatus`, whose stem
   * measures 1.33.
   */
  stampDay: {fontWeight: '500'},
  /*
   * The avatar column: a 24-point circle, aligned to the bottom of the run's
   * last bubble. MEASURED off a real group thread — the circle spans x 16..40
   * in a 393-point window.
   */
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    /* The native contact-photo margin is 7. */
    marginRight: CONTACT_PHOTO_MARGIN,
    alignSelf: 'flex-end',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColor('systemGray3'),
  },
  /* ------------------------------------------------------------ reactions */
  /*
   * The badge's box, pinned to the corner AWAY from the balloon's tail.
   *
   * `top` is negative, and deliberately: the disc overlaps the balloon's top
   * corner rather than sitting above it, which is what makes it read as stuck
   * to the balloon instead of floating over the row.
   */
  badgeAnchor: {
    position: 'absolute',
    // The disc's CENTRE, measured, turned into an edge: 10.5 above the
    // balloon's top and 2.5 inside its leading edge.
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
   * The small end of the thought-bubble tail, below the disc and just outside
   * it — on the side AWAY from the balloon.
   *
   * Away, not towards, and that is the measurement: on a sent balloon the disc
   * sat at x 261..294 and the dot at 258..262, so it trails off the outer edge.
   * A thought bubble's small bubbles lead back to whoever is thinking, and the
   * balloon is not who is thinking here.
   */
  /*
   * The tail's two circles. Positioned from the DISC's box, which is
   * `badgeAnchor`'s own size, so the numbers read as the measured centres do:
   * the intermediate's centre 15 below the disc's centre, the anchor's 22.
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
  // The line box is the glyph's own size: one as tall as the badge cannot be
  // centred inside the badge, and sits the glyph low.
  badgeGlyph: {fontSize: 17, lineHeight: 17, textAlign: 'center'},
  /** Stacked glyph lines — see the `ha` reaction's artwork. */
  badgeLines: {display: 'flex', flexDirection: 'column', alignItems: 'center'},
  /* At the symbol's own size in its box, not stretched: `<img>`'s initial
     `object-fit` is `fill`, which squashes a glyph. */
  badgeSymbol: {objectFit: 'contain'},
  /*
   * The pile's stacked discs. The pile reuses the single badge's anchor, dot and
   * disc (`badgeAnchor`/the tail circles/`badgeDisc`) so it hangs off the same corner
   * at the same size; these two only add the STACK. `pileBehind` is a disc
   * pushed behind the front one (its `top`/`left`|`right` offset is inline, from
   * `PILE_PEEK`); `pileFront` sits on top so its glyph is the one that reads.
   */
  pileBehind: {position: 'absolute'},
  pileFront: {zIndex: 1},
  avatarSpacer: {width: AVATAR, marginRight: CONTACT_PHOTO_MARGIN},
  avatarInitials: {
    fontSize: 11,
    fontWeight: '600',
    color: uiColor('systemBackground'),
  },
  /*
   * The sender's name above the first bubble of their run, indented to the
   * bubble's own text rather than to the row.
   */
  /*
   * The column the name and the balloon share, STRETCHED — which is what makes
   * a percentage cap on the balloon mean anything.
   *
   * A percentage resolves against its containing block, and a column sized by
   * its own content has no width to resolve against: the cap is ignored and
   * every balloon runs the width of the screen. Giving the column the row's
   * width makes it definite, and the cap sits on the balloon.
   */
  stack: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
  },
  /*
   * The balloon and its badge, together. `relative` makes it the badge's
   * containing block so the badge's `absolute` corner offsets are measured
   * against the balloon; it carries no size of its own, so the stack's
   * `alignItems` still hugs it to the balloon's width and pins it to the right
   * edge. Nothing here reflows during the send — the flight springs the
   * surface's width WITHIN the balloon, not this box.
   */
  balloonWrap: {position: 'relative'},
  /*
   * The balloon's line spans the column, so the time's `right` is the column's
   * and the line's height is the balloon's.
   *
   * A FLEX row, stated: a `<div>` here is a block box, and a block child fills
   * its container's width — which took the balloon off its own trailing edge
   * and out of the width the send flight springs.
   */
  balloonLine: {
    display: 'flex',
    flexDirection: 'row',
    alignSelf: 'stretch',
    position: 'relative',
  },
  balloonLineMine: {justifyContent: 'flex-end'},
  balloonLineTheirs: {justifyContent: 'flex-start'},
  /*
   * The cap belongs on the TEXT.
   *
   * As a flex item in the ROW, a `maxWidth` on the balloon is not what makes it
   * wrap — flex SHRINK is. The name above it makes the balloon a child of a
   * column instead, where the width is the cross axis and
   * nothing shrinks, so it takes its max-content width and runs off the screen.
   * A cap on the balloon's box does not help either: it does not re-wrap text
   * that has already measured itself.
   *
   * So the limit is stated where the wrapping happens — the balloon's cap less
   * its own horizontal padding, which is the width the text gets.
   */
  /*
   * The origin the send squeezes about — the LEADING edge on X, so a compressed
   * line stays pinned where its first word starts (scaling about the centre
   * would pull the first word in and read as sliding rather than squashing);
   * and the BOTTOM on Y, with the surface, so the height breath and the text's
   * vertical squeeze both grow up out of the composer and share a floor. `left
   * bottom` serves both — the vertical origin is inert for `scaleX` and the
   * horizontal one for `scaleY`.
   */
  bubbleTextFlying: {transformOrigin: 'left bottom'},
  bubbleText: {
    maxWidth: BALLOON_MAX_WIDTH - 2 * BUBBLE_PADDING,
    /*
     * A typed newline SURVIVES, and the default is that it does not.
     *
     * `white-space: normal` collapses a segment break to a space — which is
     * correct CSS and correct HTML, and wrong for a message. Typed as two
     * lines, "first" and "second", the balloon reads "first second".
     *
     * `pre-wrap` rather than `pre-line`, because a run of spaces is a message's
     * own too: someone who types three spaces meant three. Both still wrap,
     * which `pre` would not.
     *
     * The composer needs nothing: a `<textarea>`'s value is its value, and the
     * collapsing is a property of how a BLOCK lays its text out.
     */
    whiteSpace: 'pre-wrap',
  },
  /* Sent balloons hug the trailing edge of their column, received ones the
     leading edge — so a short message sits against the side it came from. */
  stackMine: {alignItems: 'flex-end'},
  stackTheirs: {alignItems: 'flex-start'},
  sender: {
    /*
     * ELEVEN. The native sender label is SF Regular 11, measured at runtime.
     * Twelve puts a point of extra weight on the
     * one label in the transcript that is meant to recede.
     */
    fontSize: 11,
    color: uiColor('secondaryLabel'),
    marginBlock: 0,
    marginBottom: 3,
    marginLeft: 2,
  },
  /*
   * NO background, which is what the platform does: the transcript runs behind the
   * composer rather than stopping at an opaque bar, and the only filled thing is
   * the field itself.
   *
   * The other demos deliberately go the other way — see the safe-area screen,
   * whose bar is opaque so its bounds can be seen. Both are supported and the
   * element has no opinion: it carries whatever background the author sets, and
   * none if they set none.
   */
  /*
   * The accessory itself carries NOTHING: no fill, no padding, no colour.
   *
   * Everything visible is the material box inside it, which is what lets the
   * material be the full width and height of the bar — including the part below
   * the safe area — while the content inside keeps its own margins.
   */

  /*
   * The field carries its own fill and outline, because the BAR does not.
   *
   * An opaque bar separates a field the same grey as the transcript. Without
   * one, as the platform has it, the field disappears into the page — so the
   * platform draws a rounded outline around the field rather than a slab behind
   * the bar.
   */
});

export default Chat;
