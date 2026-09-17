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
import env from '../../expo-intrinsics/src/env';
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
  VirtualViewMode,
  VirtualViewRenderState,
  createHiddenVirtualView,
} from '../../react-native/src/private/components/virtualview/VirtualView';
import Composer, {BAR_TOP_PADDING, ComposerBar} from '../Composer';
import useHeaderEdgeEffects from '../headerEdge';
import RenderStats from '../NativeRenderStats';
import {REACTIONS, cycleReaction} from '../reactions';
import {
  RECEIPT_FADE_MS,
  RECEIPT_GROW_CURVE,
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
  resistedReveal,
  revealInkRamp,
} from '../reveal';
import {runFlags} from '../runGrouping';
import {uiColor} from '../uiColors';
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
 * The receipt's arrival: how long, how small it starts, and on what curve.
 *
 * The platform will send to itself over SMS on this simulator, so there is a
 * real balloon with a real `Delivered` under it — see the README, and
 * `receiptTiming.js`, which holds the fit and the frames it came from. Every
 * number here is one of three that were fitted TOGETHER over twenty-three
 * frames, because they trade against each other and cannot be read one at a
 * time.
 *
 * It grows about its CENTRE, which the same frames settle rather than infer:
 * the ink's horizontal centre does not move by a pixel across the whole
 * animation, and its top and bottom travel eleven pixels each, in opposite
 * directions.
 */
const RECEIPT_FADE = RECEIPT_FADE_MS;
const RECEIPT_GROW = RECEIPT_GROW_MS;
const RECEIPT_GROW_FROM = 0.21;
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
 * The longest a send may hold the field's own events — see `sending`.
 *
 * Longer than any send: the takeoff clears the flag within a frame or two of
 * the tap, so this is never what ends the window. It is the floor under it.
 */
const SENDING_FLOOR_MS = 2000;
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
/*
 * And the cap that binds instead once the column is wide — the platform's
 * `balloonMaxWidthPercent`, which is half of its rule: the smaller of this and
 * the reserve above wins. Stated on `balloonWrap`, which is the box that can
 * resolve a percentage against the column.
 */
const BALLOON_MAX_WIDTH = '85%';
/*
 * And the reason that reserve is the number to state rather than a width: it
 * makes the balloon's text column and the FIELD's the same width at every
 * window size, which is what keeps a message from re-wrapping as it is sent.
 *
 * Both are the container less a sum of constants, so their difference is a
 * constant too — a sixth of a point, which is under a pixel at 3x and a
 * twentieth of the narrowest glyph:
 *
 *   balloon   container − 16 − 16 (the transcript's margins)
 *                       − 89.333 (this)
 *                       − 28     (twice `BUBBLE_PADDING`)      = c − 149.333
 *   field     container − 16 − 16 (the composer's margins)
 *                       − 40 − 12 (the `+` and its gap)
 *                       − 16 − 5  (the field's own padding)
 *                       − 38 − 6.5 (the send button and its clearance)
 *                                                              = c − 149.5
 *
 * Nothing in either sum depends on the width, so agreeing at one width is
 * agreeing at all of them — a rotation and a split view dragged under a finger
 * included. `WrapCheck` is what pins the sums, at the width the gate runs.
 */
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
/** The transcript's own bottom padding — `styles.transcriptContent`. */
const TRANSCRIPT_BOTTOM_PAD = 16;

const BALLOON_SETTLE = 500;
/*
 * How long a sent message has nothing to say, before it is delivered.
 *
 * The server's answer on the platform, and so not ours to know — but its
 * LENGTH is the thing being copied, because it is what the previous message's
 * receipt survives on. Counted off a 60fps capture of the platform: the older
 * "Read 8:53 PM" is still fully drawn 68 frames after the send, and the new
 * "Delivered" arrives over the four frames after that.
 *
 * A demo has no server, so the wait is a number. It is this one.
 */
const DELIVERED_AFTER = 1130;

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
/* The narrowest a balloon is ever drawn — see `bubble`. Measured off Messages. */
const BUBBLE_MIN_WIDTH = 48;
const BUBBLE_PADDING_V = 10;
/** The message's own type size, which the reader's setting scales. */
const MESSAGE_FONT_SIZE = 17;
/**
 * How much taller than its type the platform's message line box is.
 *
 * THREE, at every text size, which is the whole reason this is a leading rather
 * than a line height. Measured as the ink's baseline-to-baseline pitch in a
 * native balloon, at three settings of the reader's text size:
 *
 *   text size    body type    native pitch    the font's own lineHeight
 *   large (default)  17          20.000                 20.2871
 *   extra large      19          22.028                 22.67
 *   XXL              21          24.000                 25.06
 *
 * Twelve gaps in a thirteen-line balloon at each of the outer two, so the
 * numbers are the platform's and not a rounding. The font's own line height
 * grows by 2.39 for every 2 points of type; the native chat's grows by exactly
 * 2, which no font metric produces and a constant three does.
 *
 * It falls out of the balloons too: `2 × BUBBLE_PADDING_V + lineBox × lines` is
 * 40.00, 60.00 and 240.00 for one, two and eleven lines at the default size, and
 * 44.00 for one line at XXL — every one of those measured on the platform's own
 * balloons, and every one exact.
 */
const MESSAGE_LEADING = 3;
/**
 * The balloon's metrics at the reader's current text size.
 *
 * `lineHeight` is stated in UNSCALED points because the renderer multiplies it
 * by the same factor as the font (`RCTNSTextAttributesFromTextAttributes`), so
 * what has to be written down is the value that scales INTO `type + 3`. At the
 * default size it is 20, which is what this file said when it was a constant.
 *
 * The radius is half the one-line balloon, which is how the platform derives it
 * — so it grows with the text size too — and it is a plain view property rather
 * than a text one, so it is stated in drawn points.
 */
/*
 * The numbers every balloon is drawn from, including how wide it may get.
 *
 * The CAP takes the window's width as an argument rather than reading it once:
 * a balloon's limit is the column less a constant reserve, and the column
 * changes under a rotation and under an iPad's split view being dragged. Read
 * at module scope — which is what this did — every balloon stays sized for the
 * width the app started at while the composer's own column follows the new one,
 * and the two wrap the same message differently, which is a message re-wrapping
 * as it is sent.
 *
 * It is a NUMBER and not a layout constraint, and not for want of trying: see
 * `bubble` for the two structural forms that lose the hug. The cost is that a
 * width change re-renders the rows — the layout pass it causes is one the
 * transcript pays for a resize anyway, but the render is not. What would make a
 * resize cheap at thousands of rows is laying rows out lazily, the way a
 * collection view measures the cells it is about to show, and that is a
 * different piece of work from this number.
 */
function balloonMetrics(fontScale, windowWidth) {
  const lineBox = MESSAGE_FONT_SIZE * fontScale + MESSAGE_LEADING;
  return {
    lineHeight: lineBox / fontScale,
    radius: (lineBox + 2 * BUBBLE_PADDING_V) / 2,
    maxWidth: windowWidth - 2 * TRANSCRIPT_MARGIN - BALLOON_PLUS_RESERVE,
  };
}

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
 * How near the row the flying copy has to be for the row to take the message
 * back: half a point over the longest flight a send can make, as a fraction of
 * the journey, which is the quantity the value carrying it runs on. See
 * `FlyingBalloon` for why the arrival is read off the value rather than waited
 * for.
 */
const ARRIVAL_TOLERANCE = 0.005;

/*
 * The same half point, in the SQUEEZE's units.
 *
 * A fraction cannot be shared between the two: the rise's 0.005 is half a point
 * because its journey is a fixed distance, and the squeeze's journey is the
 * balloon's own size — 0.005 of a wide one is nearly a point and a half. So the
 * squeeze states the half point itself and divides by the width it is scaling,
 * which is the same quantity the rise's constant was derived from.
 */
const ARRIVAL_POINTS = 0.5;

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
     * to show you — and for a message still on its WAY: the platform does not
     * say "Delivered" until it has been, which is the server's answer and about
     * a second later. A message arrives in the transcript with nothing to show.
     *
     * That silence is the whole mechanism behind the previous message keeping
     * its receipt, so it is written here rather than arranged elsewhere. A
     * seeded message is history and has already been delivered.
     *
     * `edited` is separate because it is not a receipt: a message can be both
     * read and edited, and the native chat shows both.
     */
    status: from === 'me' && entering !== true ? 'Delivered' : null,
    edited: false,
  };
}

/** A conversation of `count` messages, for reaching the long case without typing. */
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
function Receipt({message, shown, style, elementRef}) {
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
  /*
   * What is DRAWN, which lags what the message says while the words are
   * changing: `Delivered` fades out, nothing is on screen for a sixth of a
   * second, and only then does the line become `Read`. The row holds that state
   * — see `swappingReceipt` — and hands the result here.
   */
  const said = shown ?? message;
  const parts = [];
  if (said.edited) {
    parts.push('Edited');
  }
  if (said.status != null) {
    parts.push(said.status);
  }
  /*
   * EMPTY is one of this element's STATES, not a reason for it to be absent.
   *
   * A receipt that returns nothing while it has nothing to say cannot arrive:
   * the words and the style that shows them land in the same commit as the
   * element itself, and a CSS transition with no previous value cuts. Measured
   * on a real send, the ink was at full strength and full width in the first
   * frame any of it could be seen — reported as `Delivered` revealing from the
   * bottom rather than growing from its centre. What was moving was the box
   * opening over a line that was already finished, which is a wipe.
   *
   * The engine's own trace says the same thing in one line: the space's height
   * transition starts on tag 592 and the ink's opacity never starts at all,
   * turning up 36 tags later as 628 — a node created in a later commit.
   *
   * The row already has a state for this and calls it `waiting`: a message on
   * its way owns the space its receipt will take. Owning the space means being
   * there to hold it. So the element exists whenever its box does, and what
   * changes is what is written in it.
   */
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
      {said.readAt != null ? ` ${timeOf(said.readAt)}` : ''}
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
 * A value built once, on the first render, and kept for the component's life.
 *
 * `useRef(make())` calls `make` on EVERY render and keeps only the first
 * result — an allocation per render for nothing. A lazy `useState` initialiser
 * is called exactly once and says so in a way React can SEE: a ref written and
 * read during render is invisible to it, and is the one shape React Compiler
 * refuses to reason about — which costs the whole component, not just the line.
 *
 * The value never changes, so the setter is dropped rather than named and
 * ignored.
 */
function useLazily(make) {
  const [built] = useState(make);
  return built;
}

/**
 * The balloon a send throws, drawn INSIDE the composer.
 *
 * A copy, and deliberately: the message's own row is in the transcript, and the
 * transcript is a sibling of the bar rather than a child of it — the accessory
 * hosts its content view in the screen's view, beside the React root, so
 * nothing in the list can be ordered above the composer however it is stacked.
 * The balloon a send throws has to come OUT of the field and pass over it, so
 * for the length of the flight it is drawn here, in the bar's own flight layer,
 * while the row that will hold it waits invisible at the destination.
 *
 * What arrives from the row is the destination it measured, in the window; what
 * arrives from the composer is the field's own top edge and width. The flight
 * is between those two, and it ends by handing the message back: `onArrived`
 * clears the row's `entering` in the commit that hides this, so the copy and
 * the real balloon are never both drawn and never both absent.
 *
 * HIDDEN in that commit, and unmounted on the frame after it — two commits
 * where one would do, and the reason is the platform's. An animated view goes
 * back to the props REACT rendered the moment its animation ends, and for a
 * native-driven transform those still say the flight's first frame: measured on
 * a 60 fps capture, the copy jumped to the composer on the frame its spring
 * finished and sat there for the twelve frames the arrival's own commit took to
 * paint, which read as the send happening twice. The arrival is declared before
 * the spring is over for that reason — see the effect below — and hiding this
 * before it is detached is the other half of it: however the animation's end
 * and the removal fall, there is nothing left on screen to be given back.
 */
/*
 * The flying copy's box, snapped to the NEAREST device pixel.
 *
 * An edge that falls between pixels is drawn as a half-lit row on both sides,
 * which is the seam that made a balloon read as slightly wider than the field
 * it came out of. Landing the edge on a pixel boundary is the whole of the fix.
 *
 * NEAREST, not biased. An earlier version rounded origins up and lengths down
 * so the copy could only ever land inside the field's own edge; that was for a
 * balloon drawn BEHIND the field, where a lit pixel outside it was visible
 * against the field's chrome. Drawn inside the field there is nothing to hide
 * behind, and a whole pixel of bias is a bigger error than the seam — half a
 * pixel is the most any of this should move.
 *
 * DRAWN lengths only. A box that lays text out is measured from the text and
 * has nothing to spare, and rounding one of those down takes a word off the end
 * of the line — see the width in `FlyingBalloon`.
 */
const PIXEL = PixelRatio.get();
const toPixel = (value: number): number => Math.round(value * PIXEL) / PIXEL;

function FlyingBalloon({
  message,
  mine,
  tail,
  metrics,
  scheme,
  /** Where the row will hold it, in the window — measured by the row. */
  to,
  /**
   * And where it is going, as a value rather than a number — the flight is a
   * FRACTION of the distance to it, so the two are multiplied natively and the
   * spring never has to be retargeted. Written once, from the end state the
   * composer computes at the tap. See `endOfFlight`.
   */
  trackY,
  /**
   * Where the FIELD is inside the flight layer, measured between the two views
   * themselves. Everything here is placed in the layer's coordinates and the
   * destination arrives in the window's, so this anchor — the one point whose
   * position is known in both — is what relates them.
   *
   * NEGATIVE, because the layer hangs from the bar's bottom edge and the field
   * is above it. See `flightLayer` in `Composer`.
   */
  anchor,
  /** The field's top edge in the window, and the pill's width. */
  fieldTop,
  fieldWidth,
  /** Whether the row has taken the message back — see the note above. */
  landed,
  onTakeoff,
  onArrived,
  onSettled,
  onFlight,
}) {
  /*
   * Born at the FIELD, not moved there.
   *
   * The values are created with the flight's starting numbers, so the first
   * render already carries them and the first painted frame is the composer's
   * own box. Setting them on a mounted view instead takes a render to attach,
   * which is one frame of the balloon at its resting place before it drops to
   * the field.
   */
  const flight = useLazily(() => ({
    progress: new Animated.Value(0),
    width: new Animated.Value(toPixel(fieldWidth)),
    squeeze: new Animated.Value(1),
  }));
  const {progress, width, squeeze} = flight;
  /*
   * The journey, as a FRACTION rather than a distance.
   *
   * `progress` runs 0 → 1 on the platform's spring and multiplies the distance,
   * which is the honest shape for it: a spring on a fraction of a journey
   * rather than on a number of points, so nothing in it has to know how far,
   * and a destination that moved could be followed without the spring being
   * restarted or retargeted.
   */
  const journey = useLazily(() =>
    Animated.multiply(progress, Animated.subtract(trackY, fieldTop)),
  );
  /*
   * Everything the flight below reads from OUTSIDE itself, as it was when this
   * balloon mounted.
   *
   * The effect has to run exactly once — it starts a spring and puts listeners
   * on animated values, and running it again would restart a flight mid-air.
   * An empty dependency array says that by leaving the values out, which is
   * only true because none of them changes, and nothing in the code says so.
   * A snapshot says it: the effect reads constants, so the array can name every
   * one of them and still never fire twice.
   *
   * It is also what the comment there already claimed — the destination is
   * measured before this mounts.
   */
  const from = useLazily(() => ({
    fieldWidth,
    toWidth: to.width,
    id: message.id,
    onArrived,
    onFlight,
    onTakeoff,
  }));

  useEffect(() => {
    /*
     * The instrument, and it lives here because nothing outside the app can see
     * this animation: `XCUIElement.tap()` returns when the app is next idle,
     * which for a send is after the balloon has landed. A listener on the value
     * is the quantity under test rather than a picture of it — see
     * `flightTrace`.
     */
    let low = Infinity;
    let high = 0;
    /*
     * The DRAWN width, which is the box times the squeeze: the morph carries
     * the box from the field's width to the balloon's and the squeeze is what
     * dips below it, so neither value on its own is the number a reader sees.
     */
    let box = toPixel(from.fieldWidth);
    let squeezed = 1;
    /* Which of the two animations carrying this copy has come home — see
       `home` below, which is what they are for. */
    let risePassed = false;
    let riseHome = false;
    let swellPassed = false;
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
      squeezed = value;
      sample();
      /*
       * And the squeeze reports itself home on the same terms as the rise:
       * past its destination, then back within half a point of it.
       */
      if (value >= 1) {
        swellPassed = true;
      }
      if (swellPassed && Math.abs(1 - value) * box <= ARRIVAL_POINTS) {
        swellHome = true;
        home();
      }
    });
    /*
     * ARRIVED, which is not the same moment as the spring being over.
     *
     * A spring ends when its own rest thresholds say so, and on a 0 → 1
     * fraction the default one is six hundredths of a point: measured, this
     * throw was visually at rest at 700 ms and did not report finished until
     * 1330. Handing the message back then is too late for a reason that is the
     * platform's — an animated view goes back to the props REACT rendered the
     * moment its animation ends, and those still say the flight's first frame,
     * so the balloon returns to the composer and waits there for the arrival's
     * own commit. On a fifty-row transcript that commit is twelve frames of
     * work, and twelve frames at the composer reads as the send happening
     * twice.
     *
     * So the arrival is declared from HERE, while the animation still runs and
     * nothing can be given back: when the copy has passed the row and come
     * home to within half a point of it. Passed, not merely reached — the
     * throw overshoots by a couple of points and stopping at the first crossing
     * would cut that off, which is the part of the motion a reader can see.
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
      from.onFlight?.({low, high, resting: from.toWidth});
      from.onArrived?.(from.id);
    };
    /*
     * BOTH of them, because two animations carry this copy and the row can only
     * take it back when neither has anywhere left to go.
     *
     * The rise and the squeeze are separate springs on separate clocks: the
     * rise peaks at 385ms and the squeeze, which starts 177ms in, peaks around
     * 553. Handing over on the rise alone gave the message back while the
     * squeeze was still swelling — measured frame by frame through a send, the
     * copy's last frame is 62.67 x 43.67 where the row's balloon is 66.67 x
     * 46.67, the same shape at 0.94, and the missing 4 points are taken in the
     * single frame the row appears in. That is the jump.
     *
     * Not a longer wait for the same test, which is the fix that suggests
     * itself and does nothing: the rise really was home: it was home alone.
     */
    const home = () => {
      if (riseHome && swellHome) {
        arrive();
      }
    };
    const watchRise = progress.addListener(({value}) => {
      if (value >= 1) {
        risePassed = true;
      }
      if (risePassed && Math.abs(1 - value) <= ARRIVAL_TOLERANCE) {
        riseHome = true;
        home();
      }
    });
    const throwIn = Animated.parallel([
      /*
       * The rise: a beat on the composer, then the platform's own spring.
       *
       * There is NO horizontal axis, and that is the shape of the throw. In the
       * native send the balloon's trailing edge is at 376.7 on the frame it
       * appears and at 376.7 on the frame it settles, and every frame between:
       * the whole horizontal motion is the WIDTH springing while that edge
       * stays put. The native animation is on `position.x`, but a `CALayer`'s
       * position is its CENTRE, and shrinking a view about a fixed right edge
       * moves the centre by half the width change — its x animation IS its
       * width animation, expressed in the only geometry a layer has.
       */
      Animated.sequence([
        Animated.delay(THROW_DELAY),
        Animated.spring(progress, {
          toValue: 1,
          useNativeDriver: true,
          ...THROW_SPRING,
        }),
      ]),
      /*
       * And the width: the field collapsing to the balloon, past it, and back.
       *
       * Two legs rather than one spring because they are two animations
       * natively — a scale-down and a scale-up that cross — and one spring
       * cannot both start at the field's width and undershoot by a fixed
       * FRACTION of the balloon's. That distinction is what made the first
       * attempt at this a deflation: an undershoot proportional to the journey
       * took a two-letter message's balloon through zero.
       *
       * Width is layout, and on the SHARED animated backend layout is exactly
       * what the native driver can do — `width` is in the allowlist beside
       * `height` and the insets when `useSharedAnimatedBackend` is on, which
       * this app turns on. NOT `useNativeDriver: false`: a JavaScript-driven
       * layout property is a `setNativeProps` and a commit PER FRAME, and a
       * commit is the whole surface. Measured during a send on this screen, the
       * JavaScript thread ran 40% busy on a Mac for one balloon changing width.
       */
      Animated.timing(width, {
        toValue: from.toWidth,
        duration: SQUASH_DURATION,
        easing: SQUASH,
        useNativeDriver: true,
      }),
      /*
       * And the SQUEEZE, which is both axes at once.
       *
       * Measured against the native send frame by frame, the balloon at the
       * bottom of its dip is 43.33 wide and 35.67 tall where it rests at 56.67
       * by 47.00 — the same shape, three quarters the size. Ours dipped in
       * WIDTH alone, so at the bottom of the dip it was as tall as the
       * finished balloon and a fifth narrower: reported as our bubbles
       * compressing horizontally more than the platform's, which is exactly
       * what a width-only dip is.
       *
       * So the box MORPHS from the field's width to the balloon's — that is
       * the shape changing, and the text inside it stays the size it was
       * typed — and this scales what has been morphed, uniformly, about the
       * trailing edge the whole flight hangs from.
       */
      Animated.sequence([
        Animated.timing(squeeze, {
          toValue: SQUASH_TROUGH,
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
    ]);
    /*
     * The field lets the text go HERE, once this balloon has painted a frame.
     * Released any earlier the field empties before the balloon appears, which
     * is a frame with the message nowhere; a frame of the two overlapping
     * cannot be seen, because this is drawn over the field.
     */
    from.onTakeoff?.(from.id);
    // The backstop, for a spring tuned never to pass its destination: a flight
    // that ends without having been declared arrived is arrived.
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
    // Once, for this flight: the destination is measured before this mounts.
  }, [from, progress, squeeze, width]);

  /*
   * And once that hidden frame has been PAINTED, the copy asks to be taken
   * away. A frame rather than a commit: the effect runs when React is done, and
   * what has to be true is that the composer has drawn without it.
   */
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
          /*
           * The bar spans the window, so a window x IS a layer x. Vertically the
           * balloon starts exactly where the field is (`anchor`) and travels
           * `progress` of the way to wherever the row is at that moment.
           */
          left: toPixel(to.x),
          top: toPixel(anchor.y),
          /*
           * EXACTLY the row's width, and the one number here that is not
           * snapped, because this box is what lays the TEXT out.
           *
           * A balloon hugs its text, so the row's width is the text's own width
           * and nothing to spare. Take a third of a point off it and the last
           * word no longer fits: "You" flew as "Yo" over "u" for the whole
           * flight and snapped to one line when the row took over. What the
           * reader sees is the surface below, which is where the inward
           * rounding belongs — it is the edge that has to sit inside the
           * field's.
           */
          width: to.width,
          /*
           * The journey and the SQUEEZE, in that order: a transform list
           * applies right to left, so the balloon is scaled about its own
           * corner first and then carried down to the field.
           */
          transform: [{translateY: journey}, {scale: squeeze}],
        },
      ]}>
      {/*
        The balloon's SURFACE is a sibling of its text, not a box around it, and
        that is what makes the throw possible at all.

        Animating the box's own width reflows what is inside it: the spring
        deliberately undershoots the final width, the text rewraps to fit, and a
        four-character message becomes a one-character-per-line vertical sliver
        for a fifth of a second — a layout animation on a box that lays out text.

        The native chat has no such problem because its balloon is a MASK behind
        a label that never moves. This is the same shape: the text sits in a box
        sized by the text, and the surface is an absolutely-positioned sibling
        pinned to the trailing edge whose width is what springs. Nothing
        reflows, because nothing that lays out text changes size.

        The PLAIN component, not the animated wrapper: `createAnimatedComponent`
        around a composite hands the value to that composite's own ref through
        `setNativeProps`, and this one's ref is the box rather than the surface.
        Given the value directly, `NativeChatBubble` puts it in the SURFACE's own
        style, and the surface is an animated host element, so the driver reaches
        the view it is meant to move.
      */}
      <NativeChatBubble
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
            styles.bubbleTextFlying,
            {
              /*
               * TRANSLATED, not scaled. The words stand where they were typed
               * — at the leading edge of the pill drawn over the field — and
               * the box catches up with them as it morphs. Scaling them with
               * the box squeezed the type horizontally while its height stood
               * still, which is the distortion the squeeze below replaced.
               */
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
  /** The line box and the corner at the reader's text size — `balloonMetrics`. */
  metrics,
  composerFrame,
  /**
   * The transcript's content container, which this row measures itself against
   * — an ancestor, so the answer is in content coordinates and nothing about
   * where the reader is or what the keyboard is doing is in it.
   */
  contentBox,
  tail,
  startsRun,
  endsRun,
  separatesRun,
  onCommand,
  onArrived,
  /**
   * Told the moment this balloon becomes VISIBLE, which is the frame the
   * composer may stop showing the text.
   *
   * A send has two halves and the message has to be in exactly one of them at
   * any moment: in the field, or in a balloon. The flight cannot begin until
   * the destination is still ([[STILL_READINGS]]), so the composer holds the
   * text until this says the balloon is on screen. Without it the text leaves
   * the field on the tap and the balloon appears three frames later, which is
   * the "the bubble disappears" the recordings show.
   */
  onTakeoff,
  onOpenReader,
  /**
   * Told where this row will hold the balloon, once the transcript has stopped
   * moving — the destination the composer's `FlyingBalloon` flies to.
   */
  onFlightFrame,
  showsReceipt,
  reveal,
  /** The ink's strength, shared by every row — see the screen. */
  revealInk,
  pan,
  /** The reaction ids stuck to this balloon (array; empty/undefined for none). */
  reactions,
}) {
  const renderedAt = profiling ? performance.now() : 0;
  if (profiling) {
    work.rows++;
    /*
     * The row that renders next after a row was caught blank IS that row:
     * `Visible` is applied synchronously, so nothing can come between them.
     */
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
   * How tall the receipt's line is, so the space it opens can be transitioned to
   * a number. Measured, because it is text at the reader's own size — see the
   * receipt at the end of this row.
   */
  const [receiptHeight, setReceiptHeight] = useState(
    measuredReceiptLine ?? RECEIPT_LINE_SEED,
  );
  /** The receipt's ink, whose line height the space above opens to. */
  const receiptInk = useRef(null);
  /*
   * The words the receipt is SAYING, which lag the ones it is meant to say
   * while they change.
   *
   * A receipt arriving grows; a receipt whose words change does not — measured
   * off the native chat, `Delivered` fades out over 120ms, the line is EMPTY
   * for 165, and `Read 5:29 PM` fades in over 185 at its full width. So the
   * change is three states rather than a new string: fading, the pause, and the
   * new words. This holds the middle one.
   */
  /*
   * Memoised on the three fields it is made of, so the object changes when the
   * WORDS do and not once per render. `wanted` below says the same thing as a
   * string, and the two now agree — which is what lets the effect name this in
   * its dependencies instead of leaving it out and explaining why.
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
   * Whether the words ON SCREEN got there by a SWAP rather than by arriving.
   *
   * It picks the transition they fade in on — 185ms of opacity, with none of the
   * arrival's delay or grow, because a line replacing another already has the
   * reader's attention. It describes the words, so it stops describing them
   * when they go; otherwise the next receipt to arrive on this row would come
   * in on the swap's clock.
   */
  const [swappedReceipt, setSwappedReceipt] = useState(false);
  /*
   * When the words on screen started arriving, so that they cannot be replaced
   * before they have been read — see `RECEIPT_HOLD_MS`.
   */
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
    /*
     * A receipt that has nothing to say yet has nothing to fade: the first
     * words a message wears arrive on the ARRIVAL, which grows them in. Only a
     * line that is already there swaps.
     */
    if (shownReceipt.status == null && shownReceipt.edited !== true) {
      setShownReceipt(said);
      return;
    }
    /*
     * And only the row that is WEARING it swaps its words.
     *
     * A row that is leaving is about to take its line off the screen, and one
     * that is waiting has not put it there yet; the words changing underneath
     * either is a fade nobody asked for. Sent three messages a second apart,
     * each receipt reached its `Delivered` and was blanked by the swap just as
     * the next send handed the receipt on — the line vanishing a beat before
     * its space closed, which reads as flickering rather than as a handover.
     * The platform MOVES one indicator; this app cross-fades two, and the
     * least it can do is not change the words on the one that is leaving.
     */
    if (showsReceipt !== 'shown') {
      return;
    }
    /*
     * And not until the words being replaced have had their moment: the ink
     * takes `RECEIPT_SETTLED_MS` to arrive and this demo's `Read` lands 1.4
     * seconds after a send, so without the wait `Delivered` began leaving
     * before it had finished coming in.
     */
    const wait = Math.max(
      0,
      receiptSaidAt.current + RECEIPT_SETTLED_MS + RECEIPT_HOLD_MS - Date.now(),
    );
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
    // The WORDS are the subject, and `wanted` and `drawn` are the words: two
    // strings that change when the receipt says something new and not when a
    // render happens to rebuild an object. The three that follow them are the
    // same facts by another name, named because the rule asks and free because
    // they move together.
    //
    // `showsReceipt` is here so that a row losing the receipt CANCELS a swap it
    // has not started: the cleanup above is the whole mechanism.
  }, [
    wanted,
    drawn,
    showsReceipt,
    said,
    shownReceipt.edited,
    shownReceipt.status,
  ]);
  /* The words are gone, so what brought them is no longer true. */
  useEffect(() => {
    if (showsReceipt !== 'shown') {
      setSwappedReceipt(false);
    }
  }, [showsReceipt]);
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
   * `RECEIPT_GROW_FROM` while it waits (see `receiptInkWaiting`), and a client rect
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
   * A sent message is invisible from the moment it mounts until its balloon has
   * landed: while it is `entering`, the balloon the reader sees is the copy
   * flying out of the composer (`FlyingBalloon`) and this row is holding its
   * place. The platform's transcript does the same — it scrolls to where the
   * message WILL be while it is still hidden, and only then brings it in.
   */
  const ready = message.entering !== true;

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
      onTakeoff?.(message.id);
      return;
    }

    let cancelled = false;
    let timer = null;
    let tries = 0;

    /*
     * ONCE, in CONTENT coordinates, and that is the whole of this row's part.
     *
     * Three things move a row during a send — the list scrolling to the end,
     * the pill collapsing under it, the receipt handing over — so a position in
     * the window is only ever the one this row has so far. Against the content
     * container, which is an ANCESTOR, the answer is where the row sits in the
     * conversation, and none of those three change it. Where that content will
     * be resting is the composer's to work out; see `endOfFlight`.
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
          /*
           * A row with no width has not been laid out yet — which it has not,
           * on the frame it mounts. One more frame, up to the same budget the
           * flight has always had before it gives up and simply appears.
           */
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
          onFlightFrame?.(message.id, {x, y, width: w, height: h});
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
      ? Animated.multiply(
          reveal,
          -(REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED,
        )
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
            ? -(
                REVEAL_COLUMN_RATE -
                (REVEAL_SETTLED + SENT_REVEAL_GAP) / REVEAL_SETTLED
              )
            : -REVEAL_COLUMN_RATE,
        );
  /*
   * The reveal column is centred on the bubble BODY, so it insets past whatever
   * sits above and below the body in the row: a run-start sender name on top
   * (received balloons have one, sent do not, so the two sides differ in
   * height), and the tail drop plus any open receipt on the bottom. A named
   * variable rather than an inline object so the style stays lint-clean.
   */
  /*
   * Built into a value rather than returned outright, so the body can time
   * itself: everything above this line is the row's own JavaScript, and the
   * JSX below is the last of it. What that separates is a stall React caused
   * from one this app caused — see `detailReport`.
   */
  const tree = (
    <AnimatedDiv
      {...(pan != null ? pan.panHandlers : null)}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        separatesRun ? styles.rowEndsRun : styles.rowEndsRunLeaving,
        // Only the reveal drag moves a row, and only sideways: the send's own
        // motion belongs to the copy flying out of the composer.
        {transform: [{translateX: shift}]},
        // Hidden until its destination is still. A sheet entry rather than an
        // inline object so the two states are named things.
        ready ? styles.rowReady : styles.rowWaiting,
      ]}>
      {/* Received messages sit beside a face; sent ones have no such column. */}
      {named && <Avatar from={message.from} show={endsRun} />}
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
              radius={metrics.radius}
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
              style={[styles.bubble, {maxWidth: metrics.maxWidth}, popIn]}
              surfaceStyle={
                mine
                  ? [
                      styles.mineBalloon,
                      {backgroundImage: balloonGradient(scheme)},
                    ]
                  : styles.theirsBalloon
              }
              >
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
              <p
                style={[
                  styles.bubbleText,
                  mine ? styles.mineText : styles.theirsText,
                  /*
                   * The line box, which follows the reader's text size rather
                   * than sitting at one number — see `MESSAGE_LEADING`; and the
                   * cap, which is where the wrapping happens and follows the
                   * window. Both here rather than in the sheet because the
                   * sheet can see neither, and stating them in both places
                   * would be two answers.
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
                /* Inked by the drag as well as moved by it, off the same
                   native value — one write per frame rather than two. */
                {opacity: revealInk, transform: [{translateX: timeShift}]},
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
        {
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
               * The FIRST words come straight from the message, not from state.
               *
               * The ink's style flips to `shown` in the render where this row
               * starts wearing the receipt, and the state that holds the words
               * is written by an effect — which runs after it. So the arrival's
               * grow began on an empty box and the words appeared afterwards,
               * already at full size: measured, 104 points of width to 148 in a
               * single frame, and anchored at the trailing edge because that is
               * right-aligned text being laid out rather than anything being
               * scaled. Reported from a device as sliding in from the right.
               *
               * Taking the first words from the message puts them in the same
               * commit as the style, so the grow has something to grow. The
               * state takes over once there is a line to swap.
               */
              shown={
                shownReceipt.status == null && shownReceipt.edited !== true
                  ? said
                  : shownReceipt
              }
              /* Measured in a layout effect above, not by `onLayout`. */
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
 * MEMOISED, and it is load-bearing on a long transcript. `Chat` re-renders on
 * every keystroke — the composer's `draft` lives there — and without this every
 * mounted balloon re-renders for one changed character (two hundred of them on
 * a seeded transcript). Every prop the row takes is a primitive, a stable ref,
 * or a `useCallback`, so the default shallow compare skips a row whose message,
 * run position, receipt state and reaction are all unchanged — which, during
 * typing, is all of them. The send flight is unaffected either way: it is drawn
 * by the composer's own `FlyingBalloon`, off its own `Animated` values, and this
 * row does nothing during a send but wait invisible.
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
/*
 * How long after a fling the meter keeps running — see `onMomentumScrollEnd`.
 * Long enough for the rows the fling left blank to have come back, which is
 * the interval the complaint is about.
 */
const SCROLL_SETTLE_MS = 1500;
let settleTimer = null;
const ESTIMATED_ROW_HEIGHT = 60;
const HiddenRow = createHiddenVirtualView({height: ESTIMATED_ROW_HEIGHT});

/*
 * The work one event caused, for the caption: how many times the screen and
 * its rows rendered between the event and its rows reaching the screen, and
 * how long that took. Counted in the render bodies, which is the only place a
 * release build can count a render. One event at a time; the first layout
 * that answers it reports and clears it.
 */
const work = {
  event: null,
  since: 0,
  chat: 0,
  rows: 0,
  mounts: 0,
  longFrames: 0,
  worstFrame: 0,
  /* Where the worst frame fell, and what the renderer did inside it. */
  worstFrameAt: 0,
  worstFrameWas: null,
  frames: 0,
  over34: 0,
  over50: 0,
  over100: 0,
  over200: 0,
  /* Time spent INSIDE the rows' own render bodies, which is the part of a
     stall that is JavaScript's rather than React's or the main thread's. */
  renderMs: 0,
  /* The renderer's own counters as they stood when the event began — see
     `rendererSince`. */
  renderer: null,
};
/*
 * Whether any of this runs at all. The home screen's switch sets it, and it is
 * off unless someone asks: the counting is cheap but it is not free, and a
 * demo of how a chat performs should not be measuring itself by default.
 */
let profiling = false;
/*
 * ...and the renderer's counters with it.
 *
 * They are the app's to switch on: the environment variables `RCTRenderStats.h`
 * reads at launch do not exist for an app started from a home screen, and the
 * phone is where the question gets asked. Their cost is a timestamp around
 * every mutation, so they follow the banner rather than staying on.
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
function endWork(lead) {
  const scrolling = work.event === 'scroll' || work.event === 'reveal';
  const report =
    `${lead} — ${Math.round(performance.now() - work.since)} ms` +
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

/**
 * The same gesture, at length — what a second tap on the caption asks for.
 *
 * The summary says what happened; this says where it went. Every line answers
 * a question the summary raises and cannot settle on its own: whether the late
 * frames were many small ones or one enormous one, how much of a stall was
 * JavaScript's own rendering as against React's commit and the main thread's
 * mounting, and how long a row that the viewport caught blank actually stayed
 * blank.
 */
function detailReport() {
  const lines = [];
  lines.push(
    `frames ×${work.frames}: ×${work.over34} >34ms, ×${work.over50} >50ms, ` +
      `×${work.over100} >100ms, ×${work.over200} >200ms; worst ${Math.round(work.worstFrame)} ms` +
      (work.worstFrame > 0 ? ` at +${Math.round(work.worstFrameAt)} ms` : ''),
  );
  /*
   * What the RENDERER did inside the worst frame, which is a different question
   * from what it did across the gesture and the only one that explains a
   * stopped thread. A frame of 981ms holding 12ms of renderer work is not a
   * slow renderer; it is a thread blocked by something else entirely, and the
   * totals cannot tell those apart.
   */
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
  /*
   * What is NOT JavaScript's. The rows' own render bodies are the only part of
   * a stall this app can time from the inside; the rest of the gap is React's
   * reconciliation and commit, and the main thread's mounting and layout.
   */
  const elapsed = performance.now() - work.since;
  const renderer = rendererSince(work.renderer);
  if (renderer == null) {
    lines.push(
      `of ${Math.round(elapsed)} ms elapsed, ${Math.round(work.renderMs)} ms was ` +
        `rendering rows; the rest is React and the main thread`,
    );
  } else {
    /*
     * `commit` is the shadow tree's and `layout` is INSIDE it rather than
     * beside it — Yoga runs as part of a commit — so they are written nested
     * and not added up. `mount` is the main thread performing the mutations,
     * and `sweep` is the container asking every row where it is.
     */
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
    /*
     * Per TRANSACTION, because the total is the gesture's length and the ratio
     * is the shape of the problem: a row that changes height moves every row
     * below it, and each of those moves is an `Update`. So this is how many
     * rows one change costs.
     */
    const per = n =>
      renderer.transactions === 0 ? 0 : (n / renderer.transactions).toFixed(1);
    lines.push(
      `mounted ×${renderer.transactions} transactions: ×${renderer.creates} create, ` +
        `×${renderer.inserts} insert, ×${renderer.updates} update, ×${renderer.removes} remove, ` +
        `×${renderer.deletes} delete — ×${per(renderer.updates)} updates each`,
    );
    /*
     * The BATCHES, which is a different question from the average and the one
     * a frozen frame is about. `biggestMutations` cannot answer it — it is a
     * high-water mark over the whole run, so it reports the app's open forever
     * after. A count and a total do subtract, so these are about the gesture.
     */
    if (renderer.bigTransactions > 0) {
      lines.push(
        `×${renderer.bigTransactions} transactions over 1000 mutations, ` +
          `${Math.round(renderer.bigMs)} ms in them`,
      );
    } else {
      lines.push('no transaction over 1000 mutations');
    }
    /* Both kinds of sweep over their own count: a SINGLE is one view whose
       frame changed asking where it now is, so the two rise together. */
    const passes = renderer.sweeps + renderer.sweepSingles;
    lines.push(
      `swept ×${renderer.sweeps} times (×${renderer.sweepSingles} single) over ` +
        `×${renderer.sweptRows} rows — ` +
        `${passes === 0 ? 0 : Math.round((renderer.sweepMs * 1000) / passes)} µs ` +
        `each, worst ${Math.round(renderer.worstSweepUs)} µs`,
    );
    /*
     * The ANCHOR, which is the one line here that is about correctness rather
     * than cost. It cancels a movement of the content; a correction it wanted
     * and did not get is content that moved under the reader with nothing
     * holding it, and the points are what they saw jump.
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
    lines.push('caught blank ×0 — every row was prerendered before it was needed');
  }
  lines.push(virtualReport());
  return lines.join('\n');
}
/*
 * A JavaScript frame that arrives late is one the thread was busy through.
 * Two frames at sixty is the line; the loop runs only while a fling does.
 *
 * The WORST one is kept as well as the count, because they say different
 * things: a hundred frames a little late is a thread that is busy, and one
 * frame of four hundred milliseconds is a thread that stopped.
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
   * The renderer's counters at the START of each frame, so a frame that runs
   * long can be asked what was inside it.
   *
   * A frame meter can say the thread stopped for 981ms and nothing about why,
   * and a whole day went into proposing answers to that question from totals
   * measured over five seconds. The difference across ONE frame is the only
   * reading that settles it.
   *
   * A struct copy across the bridge per frame, and only while the banner is
   * on — see `an instrument costs what it measures`. Measured at 30 numbers a
   * frame it is tens of microseconds against a sixteen-millisecond budget.
   */
  let before = RenderStats?.read() ?? null;
  const tick = () => {
    const now = performance.now();
    const frame = now - last;
    const after = RenderStats?.read() ?? null;
    work.frames++;
    /*
     * BUCKETED, not just counted past a line. "Twenty-five frames were late"
     * is the same sentence for twenty-five frames of 40ms and for twenty-four
     * of 40 and one of 400, and those are not the same problem: the first is a
     * thread with too much to do every frame, the second is a thread that
     * stopped once. The buckets say which.
     */
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
        /*
         * WHERE in the gesture, as well as how long. A worst frame at +20ms is
         * the meter's own first tick and means nothing; one in the middle of a
         * fling is the fault being looked for. They read identically without
         * this.
         */
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
 * What the virtualized rows are doing, and how long React makes them wait.
 *
 * A row is told its mode by the container, natively, on the scroll. Becoming
 * VISIBLE is applied at once; becoming PRERENDER or HIDDEN is applied inside a
 * transition, which React runs when it has room — so `told` on the event is
 * when the news arrived and `performance.now()` here is when React got to it.
 * The gap between them is the only direct measure of a list that has gone
 * blank because the thread is busy, as against one that is slow to draw.
 *
 * Module-level and shared by every row: one handler for three thousand rows,
 * with no closure per row and nothing kept per row. The counters are the
 * distribution, which is what a fling produces thousands of.
 */
const virtual = {
  visible: 0,
  /*
   * ...of which the ones that were still BLANK when they were told.
   *
   * A row already prerendered is told it is visible too, and for it the news
   * changes nothing — it is already in the state it is being moved to. The row
   * that matters is the one the viewport reached before the prerender did: it
   * is empty on screen and has to render, commit and mount from there. That is
   * the blank cell, and `renderState` is what tells the two apart.
   */
  caught: 0,
  prerender: 0,
  hidden: 0,
  /* The transition's own wait, over the changes that go through one. */
  waits: 0,
  waitTotal: 0,
  waitWorst: 0,
  /*
   * How long a row caught blank stayed blank.
   *
   * `Visible` is applied synchronously, so the very next row to render is the
   * row that was just told — one slot is enough to pair them, and the pairing
   * is exact rather than a guess. What it measures is the complaint itself: the
   * interval between the container saying "you are on screen" and anything
   * being drawn there.
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
    // Applied synchronously, so there is no wait to measure.
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
/** What the counters say, for the caption. */
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
 * What the RENDERER spent, which is the half of a stall this screen cannot see.
 *
 * `work.renderMs` is the rows' own render bodies and nothing else. Everything
 * after them — React's commit, Yoga's layout, the main thread's mounting, and
 * the virtualized container's own geometry sweep — happens where JavaScript
 * cannot time it, and the caption could only ever say "the rest is React and
 * the main thread". React Native counts all of it already; see
 * `RCTRenderStats.h`, and `NativeRenderStats` for the window onto it.
 *
 * Every counter is a running total, so an interval is two readings subtracted.
 * Two of them are high-water marks and do not subtract; they are passed through
 * as they stand.
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
 * The transcript's rows, behind a memo boundary.
 *
 * `React.memo` on a ROW saves that row's body and not its element: the element
 * is built by whoever renders it, before memo is consulted. So a keystroke,
 * which is state on the screen and nothing to do with any message, re-ran this
 * map over every message in the conversation and built the whole JSX inside
 * each one — the stamp, the balloon, its twenty-odd props, the boxes around
 * them. Measured at three thousand messages: a character cost 26 ms with no row
 * body running at all, and a send 60.
 *
 * A boundary here is what makes that skippable, and the props below are the
 * whole of what a row depends on. Every one of them is a ref, a memoised value,
 * a `useCallback` or a primitive, so a render that changed none of them stops at
 * this line.
 *
 * A `useMemo` around the map would have done the same arithmetic with the
 * dependency list written by hand, which is the version that goes wrong: a
 * missing dependency there is a row showing something that is no longer true,
 * not a slow one.
 */
const Transcript = React.memo(function Transcript({
  applyCommand,
  composerFrame,
  lastSent,
  lastSentReady,
  messages,
  metrics,
  onOpenReader,
  openedWith,
  pan,
  previousSent,
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
      <Row
        key={message.id}
        nativeID={`msg-${message.id}`}
        /*
         * Module-level, so three thousand rows share one function and
         * none of them closes over anything — see `noteMode`. Absent
         * when nobody is watching: a listener makes `VirtualView` bind a
         * callback per mode change, and an instrument should cost
         * nothing when it is off.
         */
        onModeChange={watching}>
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
          revealInk={revealInk}
          pan={pan}
          reactions={reactions[message.id]}
        />
      </Row>
    );
  });
});

function Chat({onExit, seedMessages, onOpenReader, showsPerformance}) {
  // Set before anything counts, including this render's own `work.chat`.
  setProfiling(showsPerformance === true);
  const watching = profiling ? noteMode : undefined;
  /*
   * The balloon's metrics, at the reader's text size and LIVE: `fontScale`
   * changes while the app is running (the platform posts a content-size change
   * and React Native re-measures), and a value read once at module load would
   * leave every balloon laid out for the old setting until a relaunch.
   *
   * Derived once here rather than per balloon — one subscription, one object,
   * and a thousand memoized rows that re-render only when it actually changes.
   */
  const {fontScale, width: windowWidth} = useWindowDimensions();
  const headerEdgeEffects = useHeaderEdgeEffects();
  const metrics = useMemo(
    () => balloonMetrics(fontScale, windowWidth),
    [fontScale, windowWidth],
  );
  /* The balloon a send throws is drawn here rather than in its row, so its
     gradient is resolved here too — see `FlyingBalloon`. */
  const scheme = useColorScheme();
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
  /*
   * A send's two halves, and the rules that keep the message in exactly one of
   * them.
   *
   * `handoff` is the text the FIELD is still showing for a message whose
   * balloon has not appeared yet. The flight cannot begin until the transcript
   * is still, so without this the text leaves on the tap and the balloon
   * arrives a few frames later with nothing in between — which is what the
   * recordings show and what the native app never does.
   *
   * The balloon itself cannot be put OVER the bar — the accessory hosts its
   * content view outside the React tree, so no `zIndex` reaches it (see
   * `transcript` in the sheet). It leaves from the bar's top edge instead.
   */
  const [handoff, setHandoff] = useState(null);
  /* The rows that were there when the chat opened; older ones start hidden. */
  const openedWith = useRef(messages.length);
  /*
   * The load caption: how long the chat took to render and to reach the
   * screen. Laid over the transcript's top edge — the scroll view's top inset
   * is where its content begins under the header — rather than in the
   * transcript, whose resting geometry is the platform's and not to be moved.
   */
  const [report, setReport] = useState(null);
  /* The long form of the same gesture, built only when it is asked for. */
  const [detail, setDetail] = useState(null);
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
  const [reactions, setReactions] = useState(
    () => persistedChat.reactions ?? {},
  );
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
  /*
   * And how strongly the times are inked, which is the same drag on a curve —
   * see `revealInkRamp`.
   *
   * ONE interpolation for the whole transcript, handed to every row: the ink is
   * the same everywhere, so a second row asking for it adds a reader of this
   * node rather than another node.
   *
   * It costs no frame of its own either. Each row's time is already written
   * every frame of the drag because it is being translated, and the opacity
   * rides in that same write as one more number. Nothing walks the rows: the
   * value is native, the readers attach once when a row mounts, and a drag
   * looks the same to JavaScript at ten messages or ten thousand.
   */
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
  const applyCommand = useCallback((messageId, commandId) => {
    if (commandId === 'copy') {
      const message = messagesRef.current.find(m => m.id === messageId);
      if (message != null) {
        Clipboard.setString(message.text);
      }
    }
    // translate / select / more: no backend in a demo — see the `<menu>`.
  }, []);
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
          current.map(m => (m.id === message.id ? {...m, arriving: false} : m)),
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
  /** The balloon is visible: the field may stop drawing the text. */
  const rememberTakeoff = useCallback(id => {
    // The field is the composer's own again from here: the balloon is drawn.
    sending.current = false;
    setHandoff(previous => (previous?.id === id ? null : previous));
  }, []);

  /*
   * The sends in the air, and where each is going.
   *
   * A list rather than one entry: two taps in quick succession are two flights,
   * and a single slot would leave the first balloon's row invisible for ever.
   * An entry is added when the row it belongs to reports a still destination,
   * and removed when that balloon lands — in the same commit that clears the
   * row's `entering`, so the copy leaves as the real balloon appears.
   */
  const [flying, setFlying] = useState([]);
  /*
   * What the FIELD last said it holds, and whether a send is in flight — both
   * refs, because both are read inside an event and state is a render behind.
   *
   * The keyboard applies a pending autocorrection when a touch lands outside
   * the word, which for a send is the send button: by the time the tap reaches
   * this app the field says "Try" where the user typed "Trh", and `draft` still
   * says "Trh" because its event has not been through React yet. A send off
   * state sends the word the reader can no longer see. Read off the ref it
   * sends what the field has.
   *
   * `sending` is the same fix on the other side. The composer already ignores
   * input while it is holding a sent message, and that guard is a prop — so the
   * correction's event, batched with the send, reads it as still unset and puts
   * the corrected word into the draft, where the field draws it the moment the
   * handoff lets go. Traced on a device: `write "Try" -> "Trh"` at the send and
   * `write "Trh" -> "Try"` at the takeoff, with the app's own state supplying
   * both.
   */
  const fieldText = useRef('');
  const sending = useRef(false);
  /*
   * The layer the flight is drawn in, and it is asked where it is at the moment
   * a flight begins rather than when it was laid out: UIKit moves the bar as
   * the keyboard rises, with no layout of its own to hang a measurement on.
   */
  const flightLayer = useRef(null);
  /** The bar itself, the ancestor those two are measured against. */
  const composerBox = useRef(null);
  /** The pill, which is where a send's balloon comes from. */
  const field = useRef(null);
  /*
   * The transcript's content container, which is the only ancestor every row
   * has that scrolling does not move — so a row measured against it answers in
   * CONTENT coordinates. See `endOfFlight`.
   */
  const transcriptContent = useRef(null);
  /** Where the transcript is and what it has reserved — see `onInsetChange`. */
  const geometry = useRef({x: 0, y: 0, containerH: 0, insetTop: 0, insetBottom: 0});

  /*
   * The pill's height with nothing in it, which is what it will shrink BACK to
   * when the draft goes. Remembered rather than derived: the field measures
   * itself and is empty most of the time, so the number is always to hand.
   */
  const restingField = useRef(0);
  /*
   * Whether a finger is on the transcript.
   *
   * A REF, so that a drag beginning costs no commit: state here re-renders the
   * transcript's rows at the start of every drag, and the suite's two
   * interactive keyboard dismissals fail when it does. The cost is that the
   * button still lights up under a finger it will give nothing to — the
   * platform's does not respond at all, which needs the flag in state.
   */
  const dragging = useRef(false);
  /*
   * Which messages have already flown, so none flies twice.
   *
   * The row reports its destination every frame until it settles, and its
   * landing — which clears the flight — can arrive before that loop has stopped:
   * the effect that owns the loop only cancels on the render that follows. One
   * late report with no flight in the map would start a second one, and the
   * balloon that had just landed would drop back to the composer and fly again.
   * Measured on a 60 fps capture before this guard: a second flight at frame
   * 191 of a send that landed at 148.
   */
  const flown = useRef(new Set());
  /*
   * Where the row will BE when everything this send sets in motion has stopped,
   * in the window — computed rather than watched.
   *
   * The row hands over its own box in CONTENT coordinates, which is the one
   * space in a scroll view that means the same thing from frame to frame. What
   * it does not know is where that content will be resting, and every term of
   * that is knowable at the moment of the tap:
   *
   *   - the pill is about to collapse to the height it has when it is empty,
   *     so the bar gives back `collapse` points and the obstruction moves down
   *     by exactly that;
   *   - the content grows to this row's own bottom, plus the container's
   *     padding;
   *   - and a scroll view at its end rests at `content - height + inset`,
   *     clamped at the top by its own top inset, which is what it does.
   *
   * Computed rather than watched, because three separate things move a row
   * during a send — the list scrolling to the end, the pill collapsing under
   * it, and the receipt handing over — so a destination measured while they are
   * still running is whichever of them has happened so far. Aimed at the end
   * state it is aimed once, and the list arrives at the same place from the
   * other direction.
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
    /*
     * The receipt's handover is NOT in this, deliberately.
     *
     * It moves the column too — the space above this row closes and the one
     * beneath it opens, and the reader sees the whole conversation lift by a
     * receipt's height. But it happens in the commit that REVEALS the row, and
     * from then on the row is there to ride it: the platform's own balloon does
     * exactly that, measured off a clip of it moving 18 points up over 16
     * frames while its receipt takes over. So the flight is aimed at where the
     * row will be revealed, which is before that, and the lift is the row's own
     * afterwards.
     */
    const top = frame.y;
    const contentBottom = top + frame.height + TRANSCRIPT_BOTTOM_PAD;
    const offset = Math.max(
      -view.insetTop,
      contentBottom - view.containerH + insetBottom,
    );
    return {x: view.x + frame.x, y: view.y + top - offset};
  }, []);

  const rememberFlightFrame = useCallback((id, frame) => {
    if (flown.current.has(id)) {
      return;
    }
    const end = endOfFlight(frame);
    if (end == null) {
      return;
    }
    const drawnY = end.y;
    /*
     * Where the field is inside the flight layer, both measured against the
     * BAR — an ancestor of each.
     *
     * `measureLayout` rather than `measureInWindow`, and the reason is what a
     * window answer is worth in here: anything inside the accessory reports the
     * position the bar was LAID OUT at rather than where it is drawn —
     * measured, 817 for a bar being drawn at 442. Two such answers subtracted
     * cancel the lie, and did for a long time; a measurement that is
     * tree-relative has no window in it to be wrong about in the first place,
     * and goes on working wherever in the bar the layer is moved to.
     */
    const start = anchor => {
      const trackY = new Animated.Value(drawnY);
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
                trackY,
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
  }, [endOfFlight]);

  const rememberArrival = useCallback(id => {
    /*
     * The receipt hands over HERE, in the commit that reveals the row, because
     * the flight was aimed at the column that handover leaves behind. Done a
     * frame later the row is revealed where it is standing now and lifts
     * afterwards, which is the balloon jumping the moment it lands.
     */
    setLanded(previous => new Set(previous).add(id));
    // The copy is HIDDEN in the commit the row becomes visible, so the balloon
    // is drawn exactly once on every frame of a send; it is unmounted a frame
    // later, when the restore that a detach performs has nothing to show. See
    // `FlyingBalloon`.
    setFlying(previous =>
      previous.map(entry =>
        entry.id === id && !entry.landed ? {...entry, landed: true} : entry,
      ),
    );
    // A landing with no takeoff is not possible, but a stuck handoff would hold
    // the field's text for ever — so the landing clears it too.
    sending.current = false;
    setHandoff(previous => (previous?.id === id ? null : previous));
    setMessages(previous =>
      previous.map(message =>
        message.id === id && message.entering === true
          ? {...message, entering: false}
          : message,
      ),
    );
  }, []);

  /**
   * The frame after the landing: the copy has nothing left to draw.
   *
   * The RECEIPT hands over here rather than on the landing, and the frame
   * between the two is the whole reason. A handover closes the previous
   * message's receipt space, which lifts every row below it by thirteen
   * points — including the one that has just landed. Done in the landing's own
   * commit, the row appears thirteen points above where the copy came to rest
   * and the send ends on a jump; done after it, the row is revealed exactly
   * where the copy was and the column lifts under it afterwards, with the
   * balloon riding it. Which is what the native chat does: measured on a clip
   * of it, the balloon moves 18 points up over 16 frames as its receipt takes
   * over, and it is the column moving rather than the balloon.
   */
  const rememberSettled = useCallback(id => {
    setFlying(previous => previous.filter(entry => entry.id !== id));
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
  /*
   * A newer message takes the receipt only once it HAS one.
   *
   * Landing is not enough: a balloon on screen with nothing to say would take
   * the line away from the message above it and leave it blank until the
   * server answered. Measured on the platform, the older "Read 8:53 PM" stays
   * fully drawn for 1.13s after a send — through the new balloon arriving —
   * and goes when the new message's own "Delivered" is there to replace it.
   */
  const lastSentReady =
    lastSent >= 0 &&
    messages[lastSent].status != null &&
    (messages[lastSent].entering !== true || landed.has(messages[lastSent].id));
  const wearsReceipt = lastSentReady ? lastSent : previousSent;

  /** The send itself, once the list is willing to take it. */
  /** The send itself, once the list is willing to take it. */
  const deliver = useCallback(text => {
    /*
     * SYNCHRONOUSLY, before anything asks React for it: an input event batched
     * with this one is the correction the keyboard applied on the way in, and
     * it has to find the flag already set. See `sending`.
     */
    sending.current = true;
    fieldText.current = '';
    /*
     * And a floor under it. What lifts the flag is the sent row reporting its
     * takeoff or arrival, which needs that row mounted — true on every ordinary
     * send, and not a thing a flag that silently drops keystrokes should rest
     * on. The takeoff clears it long before this fires.
     */
    pendingTimers.current.push(
      setTimeout(() => {
        sending.current = false;
      }, SENDING_FLOOR_MS),
    );
    const sent = makeMessage('me', text, true);
    beginWork('send');
    setMessages(previous => [...previous, sent]);
    setDraft('');
    /*
     * The field keeps drawing the message until the balloon is on screen — see
     * `handoff` — and it draws what was SENT rather than what was typed. The
     * two differ by the trim, and the difference is visible: with leading
     * spaces the typed words sit further in than the balloon's, so the moment
     * the balloon takes over they would jump left. `DraftCheck` pins that the
     * field is empty once the send is over.
     */
    setHandoff({id: sent.id, text});
    /*
     * Delivered, then Read — the two states in sequence rather than one of
     * them, because the interesting part is that the line CHANGES under a
     * message that is already on screen and does not move anything when it
     * does. A receipt that grew the row would push the transcript, which is
     * exactly what the native chat is careful not to do.
     */
    /*
     * `change` is a FUNCTION, called when the timer fires rather than when it
     * is set: `readAt` is the moment the message was read, and evaluating it
     * here would stamp it with the moment it was sent.
     */
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
    mark(DELIVERED_AFTER, () => ({status: 'Delivered'}));
    mark(DELIVERED_AFTER + BALLOON_SETTLE + 900, () => ({
      status: 'Read',
      readAt: Date.now(),
    }));
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
  }, []);

  /*
   * And the ref follows the state as well, for the drafts the FIELD never
   * reported: a conversation reopened with what was left in it, or the clear a
   * send performs. Same value by the time this runs — the field's own events
   * set it first — so it corrects nothing the user typed.
   */
  useEffect(() => {
    fieldText.current = draft;
  }, [draft]);

  const sendNow = useCallback(() => {
    const text = (fieldText.current ?? '').trim();
    if (text === '') {
      return;
    }
    /*
     * NOTHING while the list is being dragged, which is the platform's own
     * answer and not a deferral.
     *
     * ChatKit holds chat-item updates for a drag
     * (`IMChatItemsUpdateHoldReasonScrollViewDragging`): a row inserted under a
     * moving finger moves the content that finger is holding. The native chat
     * enforces it at the TOUCH — with a finger on the transcript its send
     * button does not respond at all — and this is the same answer one step
     * later: the button still lights up, and the tap does nothing. Taking it
     * out of reach properly needs the drag flag in state, and a commit at the
     * start of every drag re-renders the transcript's rows; the suite's two
     * interactive keyboard dismissals went red in the run that had it.
     *
     * NOT held for the finger to leave, which is the other way to obey the same
     * rule and reads as a fault: the draft clears at the tap and nothing is
     * sent, and when the finger lifts the message appears with its words back
     * in the field — the handoff drawing them there. Reported from a device in
     * exactly those terms.
     */
    if (dragging.current) {
      return;
    }
    deliver(text);
    // Everything else this reads is a ref, so this follows `deliver` alone
    // — and `deliver` never changes either.
  }, [deliver]);

  const send = useCallback(() => {
    /*
     * A TURN LATER, because the keyboard is a turn ahead.
     *
     * A pending autocorrection is applied when a touch lands outside the word,
     * and for a send that touch IS the send button: the field says "Teh" where
     * the user typed "Tfh" before this app hears about either. The correction
     * arrives as an ordinary edit, but it crosses to JavaScript on the same
     * queue as the tap and lands AFTER it — traced on a device and here, 16ms
     * apart with the tap first — so a send that reads anything at the moment of
     * the tap reads the word the reader can no longer see, and sends that.
     *
     * Yielding once is what puts them back in order: the edit is already queued,
     * so a task scheduled now runs behind it. The cost is one turn — the flight
     * starts a frame later — and the gain is that what is sent is what the field
     * was showing when the button was pressed, which is the platform's own
     * behaviour.
     */
    setTimeout(sendNow, 0);
  }, [sendNow]);


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
        /*
         * One tap asks for more, the next one takes it away with a copy.
         *
         * A summary is what you want ninety-nine times and the last time you
         * want everything, so the caption has both and the tap walks between
         * them. Copying on the way out because these numbers exist to be sent
         * to somebody, and a phone with no cable has no other way off the
         * screen than transcribing them by hand. Selecting text would be the
         * standard gesture and is the wrong one: the report is several lines
         * and all of them are wanted.
         */
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
        /* The header's fade is the scroll view's top edge effect, and it is not
           the same on a phone lying down — see `useHeaderEdgeEffects`. */
        edgeEffects={headerEdgeEffects}
        /*
         * The sensor housing is reserved ONCE, and in LAYOUT — see
         * `transcriptContent`.
         *
         * This view reserves every edge by default as a content INSET, which is
         * the right mechanism for a page: the content keeps its full width and
         * is held clear of the hardware. A transcript needs the other one — its
         * column has to be narrower, because a balloon's cap and its trailing
         * edge are measured from the column and not from the screen.
         *
         * Reserved both ways they ADD, and the second reservation is not a
         * margin: an inset on an edge the content already clears is scrolling
         * room, and on a phone on its side that is 124 points of it sideways.
         *
         * Top and bottom stay automatic: a header and a keyboard are things to
         * be held clear of, which is what an inset is for.
         */
        automaticInsets={{left: false, right: false}}
        ref={element => {
          transcript.current = element;
          transcriptBox.current = element;
        }}
        contentRef={transcriptContent}
        onInsetChange={event => {
          const {inset, containerSize} = event.nativeEvent;
          /*
           * The geometry a send needs to know where the transcript will REST —
           * see `endOfFlight`. Kept whole and from one message, because the
           * inset and the size move together and a caller that reads them from
           * two places gets a torn pair.
           */
          geometry.current = {
            ...geometry.current,
            containerH: containerSize.height,
            insetTop: inset.top,
            insetBottom: inset.bottom,
          };
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
         * HELD while a balloon is in the air, which is the platform's own rule:
         * ChatKit takes `CKScrollViewHoldingScrollGeometryReasonTypeThrowAnimation`
         * for the length of a send's throw, so the transcript's geometry cannot
         * change under it. Ours has to do the same or the two fight — the
         * balloon flies at a destination the reader is dragging away from, and
         * the landing is a jump.
         *
         * The list's own scroll to the end is unaffected: this stops a FINGER,
         * not `scrollToLatest`, and the flight tracks that scroll frame by
         * frame (`trackY`).
         */
        scrollEnabled={flying.length === 0}
        /*
         * And the other half of the same rule — ChatKit's
         * `IMChatItemsUpdateHoldReasonScrollViewDragging`: while the list is
         * being dragged it takes no new items, and the composer's send button
         * stops taking touches. See `send`.
         */
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
        /*
         * Kept running for a beat AFTER the momentum stops.
         *
         * The rows a fling left blank are filled in once it is over, and a
         * report that ends with the movement measures everything except the
         * part anyone complains about. The settle is in the elapsed time and
         * the label says so.
         */
        onMomentumScrollEnd={() => {
          if (settleTimer != null) {
            clearTimeout(settleTimer);
          }
          settleTimer = setTimeout(() => {
            settleTimer = null;
            meterFrames(false);
            if (work.event === 'scroll') {
              /* The detail belongs to the gesture it was expanded from, and
                 this is a different one. */
              setDetail(null);
              setReport(endWork('scroll'));
            }
          }, SCROLL_SETTLE_MS);
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
        <Transcript
          applyCommand={applyCommand}
          composerFrame={composerFrame}
          lastSent={lastSent}
          lastSentReady={lastSentReady}
          messages={messages}
          metrics={metrics}
          onOpenReader={onOpenReader}
          openedWith={openedWith}
          pan={pan}
          previousSent={previousSent}
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
      <ComposerBar
        flightLayerRef={flightLayer}
        boxRef={composerBox}
        /*
         * What a send throws, drawn between the bar's own chrome and the field:
         * the layering the platform has, and what makes a balloon read as
         * coming out from under the text area. See `FlyingBalloon` and
         * `flightLayer` in `Composer`. The row that will hold each of these is
         * invisible until it lands.
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
              anchor={entry.anchor}
              fieldTop={origin.y}
              /*
               * The COMPOSER's width, which is the whole of the correction: the
               * balloon is born as the field. Its own measurement, not this
               * file's arithmetic — and the balloon's own width if it is
               * missing, which is a send that looks like the old one rather
               * than one that does not happen.
               */
              fieldWidth={origin.width ?? entry.frame.width}
              landed={entry.landed === true}
              onTakeoff={rememberTakeoff}
              onArrived={rememberArrival}
              onSettled={rememberSettled}
              onFlight={rememberFlight}
            />
          );
        })}>
        <Composer
          /* A conversation with a draft opens ready to finish it: the field
             asks for the keyboard as it enters the window, inside the push, and
             the covered screen hands it over rather than dismissing it. An
             empty composer opens with the keyboard down. */
          autoFocus={draft !== ''}
          value={draft}
          /* The text the field keeps drawing until the balloon appears. */
          handoff={handoff?.text}
          onChangeText={text => {
            /*
             * The field's own word, kept where an event can read it — and
             * DROPPED while a send is in flight, because the only thing that
             * arrives in that window is the correction the keyboard applied as
             * the send button was touched. See `sending`.
             */
            if (sending.current) {
              return;
            }
            fieldText.current = text;
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
    /* The report is two lines when it has the virtualized counters in it. */
    whiteSpace: 'pre-line',
    /*
     * This is a panel of NUMBERS, read by comparing one run against the next.
     * Proportional figures change width as the values do, so the columns walk
     * about between readings and the eye has to find them again each time.
     */
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
  /*
   * There is no `zIndex` that puts the transcript over the bar, and this is
   * where that was learned.
   *
   * `<native:keyboardaccessory>` HOSTS ITSELF: its content view is added to the
   * screen's own view, beside the React root rather than inside it — dumped
   * from a device, `RNSScreenView`'s children are
   * `[header | box | scroll | accessory]`. So the bar is not the transcript's
   * sibling in the tree that `zIndex` orders, and raising the transcript moved
   * nothing: measured frame by frame, the balloon stayed behind the bar's
   * material for the whole flight, with only the part above the bar's top edge
   * drawn sharp.
   *
   * Whatever is to fly OVER the bar has to be rendered INSIDE it.
   */
  /*
   * The space above the first message and below the last, both the platform's:
   * 15.667 above and 16 below.
   */
  transcriptContent: {
    /*
     * The sensor housing, on the CONTENT rather than on the scroll view.
     *
     * A row's own sixteen points are its margin from the column's edge, and the
     * column's edge is inside the safe area: on the platform in landscape a
     * sent balloon's trailing edge lands at 795.67 of an 874-point screen,
     * which is the 62-point inset and the margin. They compose on two boxes
     * because that is the only way to add them — `env()` resolves during the
     * layout pass and cannot go inside a `calc()`.
     *
     * LAYOUT rather than a content inset, so the column the balloons are laid
     * out in is the narrower one rather than the same one drawn shifted.
     * Nothing is measured: a rotation re-lays this out without React hearing
     * about it. The scroll view's own reservation is turned off for these two
     * edges to match — see `automaticInsets` in the render.
     */
    paddingLeft: env('safe-area-inset-left'),
    paddingRight: env('safe-area-inset-right'),
    paddingTop: 15.667,
    /* The number a send's end state is computed from — see
       `TRANSCRIPT_BOTTOM_PAD`, which is this. */
    paddingBottom: TRANSCRIPT_BOTTOM_PAD,
  },
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
     * The same number as the composer's trailing margin, and they have to be:
     * its pill ends on that line too, so a balloon born over the field shares
     * its trailing edge and keeps it for the whole flight. See
     * `COMPOSER_MARGIN_TRAILING`.
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
    /* Two curves, matched to the two properties by index. Only the scale's was
       fitted — see `RECEIPT_GROW_CURVE`. */
    transitionTimingFunction: `ease-out, ${RECEIPT_GROW_CURVE}`,
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
    transitionTimingFunction: `ease-out, ${RECEIPT_GROW_CURVE}`,
  },
  /*
   * The words CHANGING, which is not the receipt arriving and is not it
   * leaving: `Delivered` becoming `Read 5:29 PM` under a message that is
   * already wearing one. Out, a pause, in — see `RECEIPT_SWAP_OUT_MS` for the
   * measurement and `swappingReceipt` for the pause.
   *
   * Opacity ALONE. An arrival grows from 0.61 because the reader has not seen
   * it before; these words are the same line saying something else, and the
   * platform does not scale them — measured, the new ones are at their full
   * width on the first frame they can be seen.
   */
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
  /*
   * The flying balloon's box, in the FIELD's own coordinates.
   *
   * Absolute, because it is placed at the destination the ROW measured and then
   * carried down to the field by its transform; the layer it sits in is pinned
   * to the bar's bottom edge (`flightLayer` in `Composer`). Nothing here takes
   * touches — the layer is `pointerEvents: 'none'`.
   */
  /*
   * The corner the send hangs from: the TRAILING edge, which every frame of the
   * native throw keeps still, and the BOTTOM, where the tail is — a balloon
   * grows up out of its own tail. The squeeze scales about this point, so the
   * trailing edge and the tail's tip stay put while the rest of the balloon
   * comes in.
   */
  flier: {position: 'absolute', transformOrigin: '100% 100%'},
  /* Landed: the row is drawing the balloon now — see `FlyingBalloon`. */
  flierLanded: {opacity: 0},
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
     * The CAP is stated by the screen, not here — see `balloonMetrics` and the
     * `maxWidth` each balloon is given.
     *
     * Two ways of expressing it structurally were tried and both lose the HUG.
     * A `flexShrink` on the balloon fills the line: measured, every seeded
     * balloon stood at the limit with its text wrapped narrower inside it. A
     * percentage cap on the wrapper wrapped the text at the limit less the
     * balloon's padding TWICE — the run came back 224.0 where the platform's
     * is 241.26. What makes a balloon hug is a definite cap on the TEXT, which
     * is a number, so a number is what this takes.
     */
    /* The balloon's shape inset from its text box — see `BUBBLE_PADDING`. */
    paddingHorizontal: BUBBLE_PADDING,
    paddingVertical: BUBBLE_PADDING_V,
    /*
     * A FLOOR, because the platform has one and a balloon without it is a
     * sliver.
     *
     * Measured off Messages on the simulator, which sends to itself: a
     * one-character message and a "." both come out at exactly 48.00 x 46.67
     * points — identical, so it is a minimum rather than those glyphs' width.
     * Ours was the text plus its padding and nothing else, which for one
     * character is 32.33: an egg where the platform draws a circle.
     *
     * It also removes a defect in the outline rather than patching it. The
     * tail's span is `min(22, w - r)`, and under about forty points that clamp
     * bites while the control points steering the curve to it do not move —
     * so the curve overshoots its own endpoint and doubles back, a notch in the
     * bottom edge. Reported from a device on a one-character balloon. At 48 the
     * radius is 18 and the span is `min(22, 30)`, never clamped, so the state
     * that produces the notch is unreachable.
     *
     * The window there is 402 points, so a 3x screenshot resolves a third of a
     * point and every figure above is exact rather than rounded.
     */
    minWidth: BUBBLE_MIN_WIDTH,
    /*
     * The words are centred when the floor leaves room, and are not otherwise.
     *
     * A balloon with a minimum width can be wider than its text, and something
     * has to say where the text goes. Aligning the TEXT would need a rule about
     * when — centred at the floor, leading once the balloon has grown — and it
     * would centre a wrapped balloon's shorter lines too, which reads as a poem.
     *
     * This says it without a rule. CSS wraps a flex container's anonymous text
     * in an anonymous flex ITEM, so the run becomes a box; `center` then places
     * that box in whatever room is left over. At the floor there is room and it
     * lands in the middle. Above the floor the balloon hugs its longest line,
     * so the box already is the content width and centring moves nothing — and
     * the lines inside stay leading either way, because nothing here aligns
     * text.
     *
     * `justifyContent` and not `alignItems`: this file follows CSS, where
     * `flex-direction` is ROW, so the horizontal axis is the main one.
     */
    display: 'flex',
    justifyContent: 'center',
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
    fontSize: MESSAGE_FONT_SIZE,
    marginBlock: 0,
  },
  theirsText: {
    color: systemColor('CanvasText'),
    fontSize: MESSAGE_FONT_SIZE,
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
  /*
   * The wrapper the balloon hugs inside, and the OTHER cap on how wide it gets.
   *
   * The platform's rule is a MINIMUM of two branches, probed out of it at widths
   * from 320 to 932:
   *
   *     min(column - BALLOON_PLUS_RESERVE, 0.85 x column)
   *
   * crossing at a 595.56-point column. Below it the reserve binds, which is
   * portrait's 370 and what `balloonMetrics` states; above it the percentage
   * does, which is the 718 a phone on its side leaves — 610.30 where the
   * reserve would have allowed 628.67, against the platform's own balloon at
   * 608.33, one narrow glyph short as a wrapped balloon always is.
   *
   * A percentage, and on this box rather than the balloon, for the same reason
   * the margins above are split: the column is the one the safe area has
   * narrowed, and only the renderer knows how wide that is. Two nested
   * `maxWidth`s compose as the minimum, which is the rule.
   *
   * Portrait is untouched — 85% of 370 is 314.5 against the reserve's 280.667 —
   * which is what `BalloonShapeCheck` and `WrapCheck` hold.
   */
  balloonWrap: {position: 'relative', maxWidth: BALLOON_MAX_WIDTH},
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
   * The words' own corner, which is where their first line starts. Nothing
   * scales them any more — the squeeze is on the balloon and they ride it — and
   * the origin still decides where the translate leaves them if anything else
   * is ever put on this transform.
   */
  bubbleTextFlying: {transformOrigin: 'left bottom'},
  bubbleText: {
    /*
     * A wrapped balloon hugs its longest line.
     *
     * Shrink-to-fit stops at `min(max-content, max-width)`, and max-content is
     * the message on one line — so the moment a message wraps, the balloon is
     * the limit and the space the last line did not use is drawn as balloon.
     * Measured against the platform's own chat with these three messages: its
     * balloons are 269.26, 256.26 and 252.62 wide, and ours were 280.67 — the
     * limit — for all three.
     */
    experimental_hugsWrappedLines: true,
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
