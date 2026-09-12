/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The composer, shared by every screen that has one.
 *
 * A field that grows, a send button that appears with a draft, and a glass
 * background are properties of a composer, not of a chat.
 */

import '@react-native/expo-intrinsics-poc';

import env from '../expo-intrinsics/src/env';
import NativeKeyboardAccessory from '../expo-intrinsics/src/NativeKeyboardAccessory';
import NativeKeyboardPanel from '../expo-intrinsics/src/NativeKeyboardPanel';
import NativeMenuButton from '../expo-intrinsics/src/NativeMenuButton';
import NativeScroll from '../expo-intrinsics/src/NativeScroll';
import {systemColor} from '../expo-intrinsics/src/systemColors';
import {accentColor, uiColor} from './uiColors';
import * as React from 'react';
import {
  Animated,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

/*
 * The native app's composer geometry, measured off the running app.
 *
 * On a 402-point window: the `+` is 40x40 at x=28..68, the field is 40 tall at
 * x=80..374, and both bottom out 28 points above the window's edge. So the row
 * is one 40-point line, the gap between the button and the field is 12, and the
 * outer margin is 28.
 */
/*
 * One line of composer: the pill's height at rest, and the unit most of this
 * bar is measured in.
 *
 * The number is the PLATFORM's rather than one ported from the other. iMessage's
 * pill is 40 points; Material's filled field is 56, and Google Messages' pill
 * measures 55.6 on the emulator beside this. A 40-point pill on Android reads as
 * a cramped copy of an iOS control rather than as an Android one.
 */
const LINE = Platform.OS === 'ios' ? 40 : 56;
/*
 * The `+`, at each platform's own size for it.
 *
 * iOS: 40, the native app's circle, the same height as its field.
 *
 * Android: 48, which is Material's TOUCH TARGET rather than the drawn button —
 * the platform insets its own 40dp pill inside it, and 40 with a 24dp icon is
 * Material's icon button. It is deliberately shorter than the 56dp field: an
 * icon button and a text field are different controls there and are not sized
 * to match. Centred against the field while it is one line, and level with the
 * last line once it grows, which is the same rule the send button follows.
 */
const PLUS = Platform.OS === 'ios' ? 40 : 48;
/* The native app's glyph is nearly as tall as its button. */
const PLUS_GLYPH = 27;
/*
 * The `+` is an ICON, and it is drawn rather than typed.
 *
 * SF's `+` is a MATHEMATICAL OPERATOR, cut to sit in a line of digits, and at
 * any size that makes it as tall as the native app's it is half again as thick.
 * Measured off a recording of the two composers side by side at 3x — the same
 * frame, the same threshold, so the comparison is exact:
 *
 *              ink        stroke   stroke/ink
 *   native     15.33 pt   1.33 pt      0.087
 *   ours       13.67 pt   2.00 pt      0.146
 *
 * Ours carries three-quarters more ink for its size. Rendering SF Pro's `+` at
 * a lighter weight cannot reach 0.087 either — `light` at that size is 0.100
 * and `thin` is 0.070, and there is no weight in between.
 *
 * The native app's number is an SF Symbol, and the search over point size,
 * weight and scale has one solution: `plus` at pointSize 19, weight REGULAR,
 * scale medium. Rendering every candidate: light at 19 is ink 15.00 and stroke
 * 1.17; regular draws 15.3333 and 1.5833.
 *
 * Measured against the native app on the same simulator, one frame, one
 * threshold, both strokes sampled clear of the rounded caps:
 *
 *              extent     stroke     ink
 *   native     15.33 pt   2.00 pt    494 px
 *   ours       15.33 pt   1.33 pt    348 px
 *
 * The SIZE is exact and the WEIGHT must be too, but a stated value is not a
 * drawn one: given 1.5833 the renderer draws 1.33. So the stroke is fitted to
 * the pixels instead. Ink is very nearly linear in the stroke for a bar this
 * thin, and 1.5833 x 494/348 is 2.25 — which agrees with the other route to it,
 * the dark core measuring 0.25pt narrower than the width it is given, and the
 * native app's 2.00 core therefore being drawn at 2.25.
 *
 * At 2.25 ours draws extent 15.33, stroke 2.00, ink 508, against the native
 * app's 15.33 / 2.00 / 494. Three per cent of ink apart, and the same on both
 * axes.
 *
 * The platform's own symbol configuration for a button like this — pointSize
 * 16, weight medium, scale medium — gives ink 13.00 and stroke 1.67, which is
 * not what the screen draws; the drawn button builds its own glyph. The stroke
 * agrees with the pixels and the size does not, so the pixels settle it.
 *
 * Two bars is what the symbol IS: a horizontal and a vertical capsule of that
 * length and thickness, which is why the ends are round. Drawing it rather than
 * setting it also takes it off the text-size axis, where a glyph in a fixed box
 * is clipped at the accessibility sizes — see `__docs__/SymbolSource.md`, which
 * is the standing argument for teaching `<img>` a symbol source instead.
 */
/*
 * Android's is Material's icon size instead: 24dp, at the 2dp stroke its icon
 * set is drawn with. The measurement above is of an SF symbol on an iOS button
 * 40 tall; on a 56 one, beside 24dp keyboard glyphs, the same 15.33 reads as a
 * small mark in a large circle. Google Messages' composer icons are 24.
 */
const PLUS_ICON = Platform.OS === 'ios' ? 15.3333 : 24;
const PLUS_ICON_STROKE = Platform.OS === 'ios' ? 2.25 : 2;
/* The send button, which sits inside the pill. */
/*
 * The send button is a CAPSULE, not a disc — measured off the native app at
 * 37.96 by 27.31, with a corner that fits a circle of half the height to a
 * fifth of a point. The button sits against a field whose end is the same
 * capsule, so a disc reads wrong at a glance.
 *
 * The glyph is a plain up arrow, and it is NOT an SF Symbol: the native button
 * draws vector artwork of its own, a filled 26 x 26 shape with the arrow cut
 * out of it (ink 11.33 x 14.00, shaft 2.50). Scaled to the arrow's measured
 * height that cut-out's shaft would be 2.80 against the 2.00 measured, so the
 * artwork is not what the button on screen draws either.
 *
 * Ours is the character U+2191 at 22 points semibold, and measured against the
 * native app on the same simulator it is within a pixel at 3x on every
 * dimension:
 *
 *              ink            shaft   head at 2pt down
 *   native     13.00 x 15.67   2.00   5.67
 *   ours       13.00 x 16.00   2.33   5.67
 *
 * A third of a point is the finest that comparison resolves, so the remaining
 * difference is at the noise floor and closing it would be fitting to noise.
 * `arrow.up` at 17 points does not close it either: regular draws 12.67 x 15.67
 * with a 1.42 shaft, medium 12.83 x 15.67 / 1.75, semibold 13.00 x 15.75 / 2.25,
 * and none of the three matches all of ink, shaft and head at once.
 */
/*
 * The sent balloon's blue — the balloon gradient's bottom stop.
 *
 * Resolved by the PLATFORM on both platforms: a `DynamicColorIOS` pair on iOS,
 * where the two values are the platform's own and worth stating exactly, and
 * Android's Material primary on Android, where the theme already answers "the
 * colour this app sends in". Not a JavaScript table read through
 * `useColorScheme` — that makes this file responsible for knowing which
 * appearance is on, and it will be wrong about a high-contrast setting and
 * about any theme it has not heard of.
 *
 * The exception is a `linear-gradient()`, which takes colours and cannot hold an
 * instruction to resolve one later; the balloon's own pair is a table for that
 * reason and says so where it is written.
 */
const SEND_FILL = Platform.select({
  ios: DynamicColorIOS({light: '#0088FF', dark: '#0091FF'}),
  android: PlatformColor('?attr/colorPrimary'),
  default: '#0088FF',
});
/*
 * The dictation glyph's colour, tint and box — see the `<img>` in the field.
 *
 * The native button tint exactly, BOTH ways: it is a dynamic colour, and asking
 * for it with the simulator in dark mode gives `rgba(74, 75, 77, 1)` against
 * light's `rgba(180, 184, 191, 1)`. One value is a light-mode-only answer.
 *
 * The box is the symbol's
 * own image size at body/Regular/Medium (17.3333 x 20.0000, measured with
 * `tools/symbol-ink.m`), so `object-fit: contain` scales it by one and the ink
 * lands at the size the framework draws rather than at a resampled version of
 * it.
 */
const MIC_TINT = Platform.select({
  ios: DynamicColorIOS({light: 'rgb(180, 184, 191)', dark: 'rgb(74, 75, 77)'}),
  default: 'rgb(180, 184, 191)',
});
const MIC_W = 17.34;
const MIC_H = 20;
/*
 * And where it sits. Measured on the native app's empty composer at 402x874:
 * the ink runs x 347.00-358.67 against a pill whose right edge is 374.00, and
 * the image carries 2.6667 of padding to the right of its own ink — so the
 * image's right edge is 12.67 from the pill's, of which the pill's own
 * `SEND_INSET_TRAILING` pays ten.
 *
 * Vertically it is centred: ink centre 826.17 against the pill's 825.83. Stated
 * as a bottom margin off `flex-end` rather than as `align-self: center` so that
 * it behaves like the send button when the field grows — both stay against the
 * bottom line rather than drifting to the middle of a three-line pill.
 */
const MIC_INSET_TRAILING = 2.67;
const SEND_W = 38;
/*
 * The send button's clearance from the pill: SIX above and below, TEN at the
 * trailing edge.
 *
 * Measured against the native app on the same simulator with a draft typed into
 * both: its button is 38.00 x 28.00 centred at y 502.83 with its right edge at
 * 379.33, and its pill's right edge is at 389.33 — so ten, not the six that
 * holds vertically.
 *
 * The vertical six is what makes the height: a forty-point pill less twice six
 * is twenty-eight, which is the height measured.
 */
const SEND_INSET = 6;
const SEND_INSET_TRAILING = 10;
/*
 * 28, and the number that says so is the inset.
 *
 * Measured off the two composers in one frame at 3x, thresholding each blue at
 * half the distance between its own fill and its own background so both
 * readings are taken the same way:
 *
 *              width      height     right edge
 *   native     38.00 pt   28.00 pt   370.67 pt
 *
 * It falls out of ONE rule: the button is inset six points from the pill on
 * every side. A 40-point pill less twice six is 28, which is the height; the
 * same six on the right puts its end at 371.33 against the 370.67 measured. So
 * this is a derived number rather than a fitted one, and `SEND_INSET` above is
 * the thing actually being stated.
 *
 * The height carries the corner with it: the radius is half the height, so a
 * capsule a point short sits against the pill's end with a tighter corner than
 * the pill's own.
 */
const SEND_H = LINE - 2 * SEND_INSET;
/*
 * The card's height, measured off the native app: 452 points, from 375 to 827.
 *
 * Taller than a keyboard — 336 on this device — which is why it STANDS IN for
 * the keyboard rather than covering it. Covering it is not something an app can
 * do: `windowLevel` is clamped to 10000000 and the keyboard's window is at
 * 10000001, so a card asked for 10000002 comes back at 10000000 and draws
 * underneath the keys. Measured with `~/Developer/probes/windowprobe`, which
 * puts a band in a window at each level and photographs the result.
 *
 * An input view has no such limit: it IS the keyboard's space, and it can be
 * any height it asks for.
 */
const PANEL_HEIGHT = 452;
const AnimatedButton = Animated.createAnimatedComponent('button');
/* The panel's list, whose opacity arrives after the card — see
   `PANEL_CONTENT_DELAY`. */
const AnimatedScroll = Animated.createAnimatedComponent(NativeScroll);
const AnimatedDiv = Animated.createAnimatedComponent('div');
/*
 * The `+` card, measured off the native app on a 402-point window.
 *
 * Card 319 wide, 11 points in from the screen's left edge, corner radius 30.
 * Rows on a 66-point pitch, each a 38-point circular tile 34 points in from the
 * card's edge, with the label at 99 — so the gap from tile to text is 26.
 *
 * The radius is CIRCULAR, which is worth saying because almost nothing else on
 * this screen is: fitting the measured corner profile against a superellipse
 * gives n = 2.0 at r = 29.8 with a residual of 1.1 points, and the continuous
 * n = 5 the balloons use fits five times worse. Two different shapes, on
 * purpose.
 */
const PANEL_CARD_INSET = 11;
const PANEL_CARD_RADIUS = 30;
/*
 * The `+` grows until its own circle is the card's CORNER, which is what makes
 * the card read as having come out of the button rather than appearing beside
 * it: at the moment of the swap the two shapes are the same shape.
 *
 * The native card animates the same thing — the button's portal view is scaled
 * while the popover's width and height grow — but the target it scales TO is
 * not a published metric, so this is the one number here derived from our own
 * geometry instead of measured.
 */
const PLUS_OPEN_SCALE = PANEL_CARD_RADIUS / (PLUS / 2);
/*
 * The native card's springs, as measured — the numbers are what
 * `UISpringTimingParameters(mass:stiffness:damping:initialVelocity:)` is given,
 * and `Animated.spring` takes the same three, so they transfer unchanged.
 *
 *   present  width   mass 2  k 300  c 36   zeta 0.735   <- the card overshoots
 *   present  height  mass 2  k 320  c 35   zeta 0.692
 *   dismiss  width   mass 2  k 300  c 50   zeta 1.021   <- and settles flat
 *   dismiss  height  mass 2  k 300  c 47   zeta 0.959
 *   plus     appear  mass 2  k 300  c 50   zeta 1.021
 *   plus     dismiss mass 1  k 130.507  c 17.936  zeta 0.785
 *
 * The asymmetry is the design: opening bounces and closing does not, EXCEPT the
 * `+` itself, which is the bounciest thing in the set on the way back. That is
 * exactly what a reader notices — the button springing back to size after the
 * card has gone.
 */
const PLUS_OPEN_SPRING = {mass: 2, stiffness: 300, damping: 50};
const PLUS_CLOSE_SPRING = {mass: 1, stiffness: 130.507, damping: 17.936};
/*
 * The SYMBOL is not switched off, and the native app's is.
 *
 * The native app fades its `+` out as the send menu opens — a spring of mass 1
 * / k 2706 / c 104, critically damped and gone in about 80 milliseconds, with
 * one of mass 1 / k 203.35 / c 28.5202 bringing it back over about 280 — and it
 * shrinks to a third of its size (0.333333) on the popover's own width and
 * height springs while it goes.
 *
 * That is right for a POPOVER, which is what the native app is animating: the
 * card grows over the button and takes its place, so a symbol left behind would
 * be a label on something that is no longer there.
 *
 * Ours is not a popover. `<native:keyboardpanel>` replaces the KEYS, the button
 * stays where it is, and tapping it again is how the panel closes — which is the
 * reason `styles.plus` gives for not fading the button. A symbol that fades
 * while its button stays is the same fault one level in: the control is
 * reachable and no longer says what it does.
 *
 * The small `+` grows directly into the large one, by doing nothing: the glyph is a plain child
 * of the button, so the one transform that IS animated — the button growing to
 * `PLUS_OPEN_SCALE` — carries the symbol with it, 15.33 points to 23. One
 * animation, one shape, and no state that can be left behind.
 *
 * DOM-CSS-DEVIATION(plus-symbol-rides-the-button): the native app hides its
 * symbol and this keeps it. The animators above are what it does; the paragraph
 * above is why a panel that keeps its button wants the other answer.
 */
/*
 * The card's CONTENT arrives separately from the card, and that is what makes
 * the growth read as growth.
 *
 * The morph is a window growing over a full-size card, so
 * with the content visible throughout you watch the rows get wiped in, and a
 * list being wiped in from the bottom is indistinguishable from a list being
 * scrolled.
 *
 * The native app never shows that. Its content DE-BLURS in behind its own
 * animators — text and icon blur springs, both mass 2 / k 300 / c 50, from an
 * initial text blur radius of 17 and an icon radius of 3.33 — after a delay of
 * 0.025 before the text's opacity begins.
 *
 * The blur half is not reachable: `filter` is not one of the five properties
 * the transition engine animates, and animating it per frame would cost a
 * commit a frame for a decoration. The OPACITY half is, and it is the half that
 * hides the wipe — the content is not there to be wiped while the card is
 * small. The native content's opacity spring is the one for it: mass 1 / k
 * 203.35 / c 28.5202, critically damped, settling in 0.648.
 *
 * DOM-CSS-DEVIATION(panel-content-fades-without-the-blur): a fade where the
 * native app fades AND de-blurs. Recorded rather than approximated with a
 * scale, which is the thing that would look like a blur and behave like
 * nothing.
 */
const PANEL_CONTENT_DELAY = 25;
const PANEL_CONTENT_SPRING = {mass: 1, stiffness: 203.35, damping: 28.5202};
/*
 * The list's own geometry, checked against the native app's send menu open on
 * the same simulator rather than against a description of it:
 *
 *                       native     ours
 *   row pitch            66.0       66.0
 *   tile disc           38.33      38.00
 *   tile's left edge    45.00      45.00
 *   label ink at        110.00     110.33
 *
 * The tile was read off `Apple Cash`, whose disc is solid black and therefore
 * the one row in the list a threshold can find whole; the others are artwork
 * that does not fill its own circle.
 */
const PANEL_ROW = 66;
const PANEL_TILE = 38;
/** The glyph inside a tile, which scales with it rather than on its own. */
const PANEL_TILE_GLYPH = 18;
const PANEL_TILE_INSET = 34;
const PANEL_LABEL_X = 99;
/*
 * 24 points, which is not one of the platform's text styles.
 *
 * Measured twice from the same screenshot and agreeing: a cap height of 17.7
 * over SF's 0.7046 gives 25.1, an x-height of 12.7 over 0.5186 gives 24.4. The
 * simulator was at the default content size (`UICTContentSizeCategoryL`), so
 * this is not Dynamic Type — the native app really does set this list much
 * larger than a menu, which is most of why the card reads as its own surface
 * rather than as a menu that happens to be big.
 */
const PANEL_LABEL_SIZE = 24;
const GAP = 12;

/*
 * Which `+` is on screen. Four settings, so they can be compared on a running
 * screen rather than described:
 *
 *   'both'   — all three at once, side by side, for comparing them by hand.
 *   'html'   — `<button>` with a `<menu>` child. What to copy.
 *   'native' — `<native:menubutton>`, a `UIButton` with a `UIMenu`, built as the
 *              control group: everything the platform's, nothing of ours.
 *   'panel'  — the custom `<native:keyboardpanel>` card, for what a menu is too
 *              small to hold.
 *
 * Measured, not assumed: the menu is drawn in a `UITextEffectsWindow` at window
 * level 1, and the keyboard's `UIRemoteKeyboardWindow` is at level 10000001. So
 * a menu does not cover the keys — it is placed in the space ABOVE them, and it
 * is UIKit that does the placing.
 */
/*
 * `'panel'` on iOS: the CARD is the style the native app actually opens — a
 * rounded card of circular coloured tiles, not a menu list. The platform
 * `UIMenu` (`showsMenuAsPrimaryAction`) gives the morph-out-of-the-button and
 * free interruption, but it draws a context-menu LIST, which is the wrong
 * presentation. So the card stands, and the morph has to be built as a frame
 * animation of the card itself (see `morph-the-frame-not-the-transform` in the
 * notes), not bought from `UIMenu`.
 *
 * `'html'` on Android: `<native:keyboardpanel>` is iOS-only, and the same
 * `<menu>` presents the way Android presents lists.
 */
const PLUS_KIND = Platform.OS === 'ios' ? 'panel' : 'html';

/*
 * The field's glass: REGULAR, no tint, no shadow.
 *
 * Clear reads too bright and a tint at any alpha reads frosty. A shadow on a
 * translucent view has no opaque shape to cast from, so iOS synthesises one at
 * the resting footprint and it reads as a bright core inside the pill (see
 * `styles.field`). The `+` wears the SAME material so the container merges the
 * two under a press — UIKit buckets a glass group by material identity, read
 * out of `-[UIGlassEffect glass]`.
 */
const FIELD_GLASS_KEYWORD = '-apple-system-glass-material';
const showsHTMLPlus = PLUS_KIND === 'html' || PLUS_KIND === 'both';
const showsNativePlus = PLUS_KIND === 'native' || PLUS_KIND === 'both';
const showsPanelPlus = PLUS_KIND === 'panel' || PLUS_KIND === 'both';
/*
 * How far the composer grows when nobody has said how much room there is.
 *
 * The native composer has no fixed limit at all: typing ninety words into it on
 * the simulator grows it until its top edge is under the navigation bar and the
 * transcript is gone. What bounds it is the SPACE, which is why the real bound
 * here is the `room` prop below and this is only what a host that does not pass
 * one gets.
 */
const FALLBACK_LINES = 5;
/*
 * The control's own line, which is SEVENTEEN point text.
 *
 * The native composer is set in the same face and size as a balloon.
 * `<textarea>` is already seventeen — `EXPElementTextAreaComponentView` sets it
 * in `init` — so this matches.
 *
 * DOM-CSS-LIMITATION(no-font-on-a-control): `font-size` and the rest of the
 * font shorthand do not reach `<textarea>` or `<input>`. `ElementTextAreaProps`
 * extends `ViewProps`, which has no text attributes, so the control's font is
 * the platform's and an author cannot change it. Recorded rather than worked
 * around, because the demo wants the platform's anyway.
 *
 * The line box that font lays out in is 20.2871, which is exactly `[UIFont
 * systemFontOfSize:17].lineHeight` and what the native composer's own one-line
 * height measures. Not rounded: `FIELD_INSET` is derived from this, so a line box
 * a third of a point too tall is a text inset a sixth of a point too small at
 * each end, and the growth limit multiplies it eleven times.
 */
const LINE_HEIGHT = 20.2871;

/*
 * The text's inset inside the pill, which is also what centres it.
 *
 * `LINE` minus a line box, halved. Stated as an expression because the two have
 * to agree: a padding chosen by eye sits the glyphs against the bottom of the
 * box at one size and against the top at another.
 */
/*
 * The text's inset inside the pill, top and bottom.
 *
 * What brings a 20.29-point line box up to `LINE`, so the pill's height is
 * stated once and the padding follows it on either platform.
 */
const FIELD_INSET = (LINE - LINE_HEIGHT) / 2;
/*
 * The bar's outer margins, and they are NOT the same on both sides.
 *
 * Measured off a screenshot of the native app on a 393-point window:
 *
 *                  + disc        pill left     pill right    right margin
 *     native       16.0..55.7    68.0          381.0         12.0
 *
 * Sixteen on the leading side and TWELVE on the trailing.
 */
/*
 * How far the bar's material fades in from its top edge, in points.
 *
 * THIRTY, measured off the native app running on the same simulator at the same
 * window size, sampling a column outside its composer's pill over a white page:
 * the page is 255, the darkening begins at 471 — four points above the bar's
 * own top edge — and reaches its full 251 at 505, thirty points in. It eases
 * off again by the bar's bottom.
 *
 * The fade lives INSIDE the bar: above it, it would wash transcript the bar
 * does not occupy. Without it the bar over a white page reads 255 flat, where
 * the native app reads a soft four-level valley seventy points wide.
 */
const FADE = 30;
/*
 * The bar's surface on the platforms that have no material to wear.
 *
 * iOS takes `-apple-system-blur-material-chrome` instead; see the keyword on
 * the element and the `ios` entry below. What is left here is Android's, and
 * the alpha is fitted against the native app: 0.873 reads too solid on a device
 * and 0.50 too see-through, leaving 0.70.
 *
 * Fit it by sampling the thing itself, against the thing it is copying, in the
 * same pixels — and over CONTENT, not over a flat page, or a fill and a blur
 * measure the same and the wrong one passes.
 */
/*
 * How strongly the bar wears its material, 0 to 1.
 *
 * SEVEN TENTHS, chosen on the device in DARK mode, which is the appearance that
 * can tell these surfaces apart at all. Over a black page, measured on the same
 * simulator with the same seeded transcript:
 *
 *     native            ( 0,  0,  0)     invisible over black
 *     strength 1.00     (19, 19, 19)     the platform's own chrome material
 *     strength 0.80     (15, 15, 15)
 *     strength 0.70                      <- here, chosen on the device
 *     strength 0.65     (13, 12, 12)
 *     strength 0.50     (10, 10, 10)
 *
 * No KEYWORD closes this gap: chrome is the darkest of the five, and thin,
 * thick and ultra-thin all measure (31,31,31). The native app is doing
 * something the public blur styles do not reach — it is pure black over black
 * while passing a green balloon through at (32,121,54) -> (67,124,81),
 * essentially unchanged.
 *
 * Not lower, because the value buys its darkness from the blur: opacity blends
 * the material toward the UNBLURRED page. At 0.65 the smear is still plainly
 * there — a balloon edge under the bar spreads 159-172pt against 1pt above it —
 * and that is the whole reason the material was added.
 *
 * The simulator is not the oracle for this surface — it does not composite blur
 * the way a device does — so the table above is the SHAPE of the curve and the
 * device is the judge. This is a prop so it can be moved.
 */
const BAR_MATERIAL_STRENGTH = 0.7;

const BAR_FILL = Platform.select({
  /*
   * NOTHING on iOS: the bar wears `-apple-system-blur-material-chrome`, and a
   * fill is drawn ABOVE the effect — `EXPMaterialSurface` adds the fill view to
   * the host after the effect view — so any alpha here is white paint over the
   * blur it is meant to sit in.
   *
   * A fill fitted over a FLAT WHITE PAGE is indistinguishable from a blur, so
   * it can pass its own fit and still read as flat the moment content moves
   * under it. A system material answers dark mode itself, so there is no
   * appearance pair to keep either.
   */
  ios: undefined,
  default: 'rgba(250, 255, 255, 0.70)',
});

/*
 * The bar's own top padding, in points, and on iOS the native app's is ZERO.
 *
 * The native bar has no vertical cover insets and no extension above its
 * background: its top edge IS the pill's top edge, and everything above it is
 * transcript. Measured on the same simulator with both apps docked and a full
 * transcript, from the bottom of the receipt's ink to the top of the field, the
 * native app leaves 20.3 points.
 *
 * Android's own chat does not sit its field on the bar's edge like that: with
 * Google Messages open beside this on the emulator, its field is a pill floating
 * with 24.3 points between it and the last ink above and 28.3 below it. Eight
 * points here is that rhythm at this bar's scale — enough air over the field to
 * read as a bar rather than as a strip the transcript is resting on.
 *
 * Named because TWO things need it and must agree: the bar's style, and the
 * origin the send flight starts from. `FADE` is not a substitute — the fade
 * sits outside the bar, so a flight measured from it starts twenty points below
 * the field.
 */
export const BAR_TOP_PADDING: number = Platform.OS === 'ios' ? 0 : 8;

export const COMPOSER_MARGIN = 16;
/**
 * And the trailing one, which is four points less on iOS. See above.
 *
 * Even on Android, where the trailing edge holds nothing the leading edge does
 * not: the four points are the native app's answer to a send button INSIDE its
 * pill, and Material's grid asks for one margin.
 */
export const COMPOSER_MARGIN_TRAILING: number = Platform.OS === 'ios' ? 12 : 16;

/**
 * The margin DOCKED, on every side that meets the screen's corner.
 *
 * Twenty-eight, the native composer's own docked margin. Concentric with the
 * display's own rounded corner, which is why it is one number for the leading
 * edge, the trailing edge and the bottom rather than the asymmetric pair above:
 * a curve has no sides. See `ComposerBar`, which interpolates between the two
 * states.
 */
export const COMPOSER_CONCENTRIC = 28;

/**
 * And what DOCKING is worth on each platform.
 *
 * On iOS it is the concentric number above, on every side that meets the corner.
 * Android has no corner to be concentric with — the bar docks against the
 * gesture strip the element already reserves — so docking changes nothing there
 * and the margins stay the raised ones. Measured on Google Messages: docked, its
 * composer row ends 8dp above that strip, the same gap it keeps from the keys.
 */
export const COMPOSER_DOCKED_SIDE: number =
  Platform.OS === 'ios' ? COMPOSER_CONCENTRIC : COMPOSER_MARGIN;

/**
 * And the room below the pill while the bar is RAISED, in points.
 *
 * SIXTEEN below the pill and nothing above it — the bar is not symmetric.
 *
 * Measured against the native app on the same simulator with the same keyboard
 * up, on iOS 26.5: both keyboards begin at 539.67 and the native app's `+` is
 * centred at 502.83, so a forty-point row centred there leaves 16.84 points
 * between its bottom and the keys. iOS 27 moves both together — the platform's
 * `+` to 509.5 and ours with it — so the sixteen still lands on its centre.
 *
 * Sixteen rather than the 16.84 measured: sixteen puts our `+` on the native
 * app's own centre, where seventeen puts it a point above at 501.83. The
 * fractional part is the reading, not the layout.
 *
 * DOCKED this is zero, because the strip the element reserves for the home
 * indicator is the padding and adding both counts it twice.
 *
 * EIGHT on Android, which centres the row rather than hanging it. Measured off
 * Google Messages with the same keyboard up on the emulator: its composer row
 * ends at 569.9dp and the keys begin at 577.9. With the eight above that the bar
 * already has, the controls sit in the middle of the strip instead of 8 from the
 * top and 16 from the bottom — which is what the sixteen above buys on iOS,
 * where there is nothing above the row at all.
 */
export const COMPOSER_BOTTOM_RAISED: number = Platform.OS === 'ios' ? 16 : 8;

/** The docked bottom — see `COMPOSER_DOCKED_SIDE`; Android keeps the raised gap. */
export const COMPOSER_DOCKED_BOTTOM: number =
  Platform.OS === 'ios' ? COMPOSER_CONCENTRIC : COMPOSER_BOTTOM_RAISED;
/*
 * `Keyboard`'s own events cannot tell this bar whether it is docked:
 * `keyboardWillShow` fires with the keyboard down, because installing an
 * `inputAccessoryView` posts the keyboard notifications with the ACCESSORY's
 * frame as the end frame, so a bar that asks them is permanently un-docked. The
 * accessory's own `onDockChange` is the signal — it knows because it computes
 * the strip of the home indicator the keys have not covered; see
 * `EXPKeyboardAccessoryComponentView`.
 */
/**
 * @param onSend called with the trimmed text; the draft is cleared after.
 */
/**
 * @param actions optional `{id, label, symbol, tint, destructive, onPress}` list.
 *   `tint` is an accent name for the row's tile — see `accentColor`. The native
 *   app gives every row its own colour and it is what makes the list readable
 *   at a glance rather than a column of identical circles.
 *   Non-empty puts the native app's `+` button to the left of the field,
 *   opening the list as a card in the keyboard's place. `symbol` is an SF
 *   Symbol NAME, drawn in the row's circular tile where the native app puts an
 *   app icon — see `EXPSymbolImageLoader` for why the tiles hold artwork rather
 *   than text.
 */
export default function Composer({
  value,
  onChangeText,
  onSend,
  onFocus,
  inputRef,
  /**
   * Ask for the keyboard as this composer enters the window.
   *
   * A screen that opens with its keyboard up says so here rather than calling
   * `focus()` after the fact: the field claims first responder from
   * `didMoveToWindow`, which is inside the push, so the keyboard passes from
   * the outgoing screen to this one instead of being dismissed and presented.
   */
  autoFocus,
  /**
   * Called with the field's own `{width, height}` whenever it changes.
   *
   * The send flight begins as the field — see `THROW_SPRING` in `ChatScreen`
   * for the frames — so it needs the pill's size, and this file is the only
   * place that knows it. Derived from the transcript's constants it would be
   * right only while there is one `+`; a measurement cannot drift that way.
   *
   * SIZE and not frame. A position would have to be `measureInWindow`, and this
   * bar lives in the keyboard's window rather than the app's, so the number
   * would be in the wrong coordinate space — see `Keyboard.js`. A layout size
   * is the same in any window. The flight takes its origin from the
   * transcript's inset, which is measured on the app's side.
   */
  onFieldSize,
  actions = [],
  /**
   * Asked, at the moment the draft rewraps, how many points of the host's
   * content are still visible — the room the composer may grow into.
   *
   * A FUNCTION rather than a number because the answer changes on every frame
   * of a keyboard drag, and a number would re-render this whole screen on each
   * of them for a value nothing is reading. Called only where it is needed. A
   * host that leaves it out gets a fixed limit instead.
   */
  getRoom,
}) {
  const hasDraft = value.trim() !== '';
  /*
   * The panel's row and tile, sized with the reader's text.
   *
   * From the hook rather than `PixelRatio.getFontScale()` so it re-renders when
   * the setting changes; read at module scope it would be whatever it was when
   * the file was first evaluated.
   */
  const {fontScale} = useWindowDimensions();
  const tile = PANEL_TILE * fontScale;
  const tileMetrics = {
    width: tile,
    height: tile,
    borderRadius: tile / 2,
    lineHeight: tile,
    fontSize: PANEL_TILE_GLYPH * fontScale,
  };
  /*
   * The symbol's own box, which scales with the reader's text like the tile
   * around it. A point size rather than a font size: the loader draws the
   * symbol AT this size rather than scaling a bitmap to it.
   */
  const glyphMetrics = {
    width: PANEL_TILE_GLYPH * fontScale,
    height: PANEL_TILE_GLYPH * fontScale,
    /*
     * CONTAIN, because a symbol's aspect is its own.
     *
     * `<img>`'s initial `object-fit` is `fill`, which is right — HTML stretches
     * an image to the box it is given. A square box therefore squashed every
     * symbol that is not square, and most are not: `envelope` is wider than it
     * is tall and `arrow.up` is taller than wide, and both were drawn to 18x18
     * regardless. `contain` fits the longer axis and centres the rest, which is
     * what a tile wants and what the glyphs this replaces did for free.
     */
    objectFit: 'contain',
  };
  const rowMetrics = {minHeight: PANEL_ROW * fontScale};
  /*
   * The panel is as tall as its CONTENT, up to a limit.
   *
   * The native app's card is the height of its list, and `PANEL_HEIGHT` is what
   * that list comes to — so it is the cap here rather than the height. A flat
   * height gives a screen with four commands a card half full of nothing.
   *
   * A `maxHeight` rather than a computed height, because a computed one has to
   * assume a row height and rows are not all one row tall: "Stop reserving the
   * safe area" wraps to two lines, and a height counted in whole rows cuts the
   * last command in half.
   */
  const panelMetrics = {height: undefined, maxHeight: PANEL_HEIGHT};
  /*
   * Whether the `+` panel is standing in for the keyboard.
   *
   * The native app's `+` does not open a menu over the composer; it replaces
   * the keys. `<native:keyboardpanel>` is that — the responder's `inputView` —
   * so the system runs the transition and the composer simply stays where it
   * is.
   */
  const [panelOpen, setPanelOpen] = React.useState(false);
  /*
   * The `+`'s frame, so the card can grow out of it.
   *
   * Measured rather than computed from the constants above, even though they
   * would give the same answer: the button's position depends on the accessory,
   * which is in the keyboard's window and moves with it, and a number worked out
   * from this file's own layout would be right only while the keyboard is down.
   *
   * Taken when the button is TAPPED, which is the last moment it can be taken
   * and the only one at which it is certainly current.
   */
  const plusRef = React.useRef(null);
  /* The `+`'s own size, which grows into the card and springs back out of it. */
  const plusScale = React.useRef(new Animated.Value(1)).current;
  /* The card's contents, which arrive after the card — see
     `PANEL_CONTENT_DELAY`. */
  const panelContentOpacity = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const spring = Animated.spring(plusScale, {
      toValue: panelOpen ? PLUS_OPEN_SCALE : 1,
      useNativeDriver: true,
      ...(panelOpen ? PLUS_OPEN_SPRING : PLUS_CLOSE_SPRING),
    });
    const contents = Animated.spring(panelContentOpacity, {
      toValue: panelOpen ? 1 : 0,
      useNativeDriver: true,
      delay: panelOpen ? PANEL_CONTENT_DELAY : 0,
      ...PANEL_CONTENT_SPRING,
    });
    spring.start();
    contents.start();
    return () => {
      spring.stop();
      contents.stop();
    };
  }, [panelOpen, plusScale, panelContentOpacity]);
  const [anchor, setAnchor] = React.useState(null);
  const openPanel = React.useCallback(() => {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }
    plusRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0) {
        setAnchor({x, y, width, height});
      }
      setPanelOpen(true);
    });
  }, [panelOpen]);
  /*
   * `field-sizing: content`, done by hand.
   *
   * A `<textarea>` is a fixed-height box in HTML — `rows` says how tall — and a
   * composer is the case CSS added `field-sizing: content` for. We do not
   * implement that property, so the control reports its wrapped height and this
   * sets the box from it. It cannot be computed here: the height depends on the
   * font, the available width and the platform's line breaking, all of which
   * live where the text is laid out.
   *
   * Clamped to the space, after which the field scrolls. The native app clamps
   * to the space too — see `FALLBACK_LINES` — so the number below is a
   * measurement of this screen rather than a taste about composers.
   */
  const [contentHeight, setContentHeight] = React.useState(0);
  /*
   * How tall the field may grow, worked out from how much of the conversation
   * is still showing.
   *
   * `getRoom()` is what the host has left: the visible part of its transcript,
   * which is the only thing the composer is allowed to eat. It is not the
   * answer on its own, because it SHRINKS as the composer grows — the
   * composer's height is the transcript's bottom inset, so every point taken is
   * a point of room lost. What is constant is the SUM, `grown + room`: the
   * space between the header and the keyboard, which neither the draft nor the
   * composer changes. So the ceiling is that sum, recomputed where the draft
   * rewraps, and the loop that would otherwise oscillate settles at once.
   *
   * A host that passes nothing gets `FALLBACK_LINES`.
   */
  const grownRef = React.useRef(LINE);
  const [ceiling, setCeiling] = React.useState(null);
  /*
   * The reported height is the TEXT's, not the box's — the control is laid out
   * inside this element's padding, so the padding has to be added back to get
   * a box tall enough to hold the text it just measured.
   */
  const grown = Math.min(
    Math.max(contentHeight + 2 * FIELD_INSET, LINE),
    ceiling ?? LINE + (FALLBACK_LINES - 1) * LINE_HEIGHT,
  );
  grownRef.current = grown;
  /*
   * The field snaps to one line after a send, and that is MEASURED rather than
   * conceded.
   *
   * The native app does not animate this field in either direction. On the
   * simulator, frame by frame at 5-20ms per captured frame: growing, one line
   * of ink at 1895ms and two at 1911ms — a single frame. Collapsing after a
   * send, two lines of text in one frame and one line of placeholder in the
   * next. The native composer's resize duration of 0.1 is not spent here, and
   * reading a constant is not measuring the app.
   *
   * What the native app has instead is COVER. At the frame it collapses, the
   * balloon is a two-line box sitting exactly over the two lines of text, and
   * it then leaves — so the snap happens underneath something and is never
   * seen. Ours cannot hide there: our flight starts as a ONE-line box ABOVE the
   * field, so the second line goes in the open.
   *
   * An eased collapse does not close it. It can be made to run — declared on
   * the field well before the send it eases 60 -> 51 -> 47 -> 42 -> 40 — but
   * only by leaving the declaration on all the time, which eases the GROWTH
   * too, and a field that eases while it grows reads as jitter. Declaring it at
   * the send instead never starts:
   * the engine's own trace (`globalThis.__cssTransitionsTrace`, rendered into the
   * transcript to read it on a device) shows no height transition beginning at
   * all, only the receipt's fade. The engine is not at fault —
   * `ViewCSSHeightTransition-itest` covers a transition declared by the same
   * change and it passes — so something about this screen's commit order is, and
   * it is not understood yet.
   *
   * The honest fix is the FLIGHT, not a longer animation: a balloon that starts
   * at the field's own box would cover the snap exactly as the native app's
   * does, and the field would not need to move at all.
   */
  return (
    /*
     * `box-none`: the row is a layout box, not a target.
     *
     * A finger on the bar between the controls is a finger on the keyboard —
     * which is what makes dragging down from the composer dismiss it. The
     * accessory already passes its own surface through; this row sits on top of
     * that surface and would otherwise catch everything the accessory let by.
     */
    <div style={styles.row} pointerEvents="box-none">
      {/*
        The native app's `+`, and it is a MENU BUTTON rather than a button
        beside a menu.

        `<menu>` is HTML's list of commands and a button containing one opens
        it; the children are read out of the tree and handed to the platform,
        which draws the menu itself. Nothing of the `<menu>` is rendered — left
        in place it would lay out as a list of labels inside the button, which
        is what the element means on the web and is not what a platform menu
        looks like.

        Under `PLUS_KIND = 'both'` all three are on screen at once, in the order
        they are written about: the HTML one, the native control group, and the
        panel. Each says which it is, so a report about "the + button" is about
        a particular one.
      */}
      {actions.length > 0 && showsHTMLPlus && (
        /*
         * The native `+`: a GLASS BUTTON, which iOS 26 has as a configuration —
         * the native composer uses that very configuration, so this is the same
         * control and not an imitation of one.
         *
         * `-apple-visual-effect` on a button selects it. That matters beyond
         * tidiness: a material installed *behind* a button cannot sit behind
         * its label, because an inline `<span>` is painted as a text run in the
         * view's own layer and a view's drawing is always below its subviews.
         * A glass button draws its surface as chrome, under the label, by
         * construction.
         *
         * `<menu>` is HTML's list of commands, and a button containing one
         * opens it. The children are read out of the tree and handed to the
         * platform; nothing of the `<menu>` renders, because a platform menu is
         * drawn by the platform.
         */
        <button
          type="button"
          // The field's material — merging requires identical materials; see
          // the panel-kind `+` below for the UIKitCore read.
          style={styles.plus}
          appleVisualEffect={FIELD_GLASS_KEYWORD}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, HTML' : 'More'}>
          {/* Two bars, which is what the SF Symbol `plus` is — see
              `PLUS_ICON` for the measurement that says so. */}
          <div style={styles.plusIcon}>
            <div style={styles.plusBarH} />
            <div style={styles.plusBarV} />
          </div>
          {/*
            Each command carries its own handler, which is what `<menu>` means:
            a list of commands, not a list of labels the button switches on.

            `icon` is an image SOURCE, the same `system:<symbol>` scheme `<img>`
            takes — so a menu and a picture say where a symbol comes from the
            same way, and a menu row is not a place where a new spelling gets
            invented. The panel's tiles draw the same symbols from the same
            strings.
          */}
          <menu>
            {actions.map(action => (
              <li
                key={action.id}
                id={action.id}
                icon={`system:${action.symbol}`}
                destructive={action.destructive === true}
                onClick={action.onPress}>
                {action.label}
              </li>
            ))}
          </menu>
        </button>
      )}
      {actions.length > 0 && showsNativePlus && (
        /*
         * The CONTROL GROUP for the `+`.
         *
         * Everything here is the platform's: the glass is a
         * `UIButtonConfiguration`, the press is the button's own tracking, and
         * the menu is a `UIMenu` UIKit presents, positions and composites. It
         * exists so that anything the HTML route gets wrong shows up as a
         * difference against it rather than having to be noticed.
         */
        <NativeMenuButton
          title="+"
          titleSize={PLUS_GLYPH}
          style={styles.plus}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, native' : 'More'}
          commands={actions.map(action => ({
            id: action.id,
            label: action.label,
            destructive: action.destructive === true,
          }))}
          onCommand={id => {
            const chosen = actions.find(action => action.id === id);
            chosen?.onPress();
          }}
        />
      )}
      {actions.length > 0 && showsPanelPlus && (
        /*
         * The same glass button, opening the custom card instead of a menu —
         * which is the comparison worth having: a menu is the platform's list
         * and the card is a surface of our own, with room for tiles and larger
         * type than a menu row allows.
         */
        <AnimatedButton
          ref={plusRef}
          type="button"
          /*
           * The SAME material as the field. UIKit's container merging buckets
           * glass by material identity — variant AND tint — so a `+` whose
           * material differs from the field's never merges, however close the
           * press brings them. Read out of UIKitCore: `-[UIGlassEffect glass]`
           * builds a `_UIViewGlass` from the style's variant and tint, and the
           * group only unions equal materials.
           */
          style={[styles.plus, {transform: [{scale: plusScale}]}]}
          appleVisualEffect={FIELD_GLASS_KEYWORD}
          accessibilityLabel={PLUS_KIND === 'both' ? 'More, panel' : 'More'}
          onClick={openPanel}>
          {/*
            A plain box, so the button's own scale is the only thing moving it —
            see "The SYMBOL is not switched off" above for why that is the whole
            animation.
          */}
          <div style={styles.plusIcon}>
            <div style={styles.plusBarH} />
            <div style={styles.plusBarV} />
          </div>
        </AnimatedButton>
      )}
      {/*
        Liquid Glass behind the field.

        `-apple-visual-effect` is WebKit's own private property for putting a
        system material behind content, spelled as CSSOM spells a `-apple-`
        property. The keyword comes from `CSSValueKeywords.in` rather than being
        invented: the property is gated to privileged embedders, so it cannot be
        queried from a browser and the source is the only place the names exist.
        iOS 26 draws it with `UIGlassEffect`; older systems fall back to the thin
        blur material, which is what the system used for the same job.
      */}
      {/*
        `collapsable={false}` is what makes the glass REACT to a finger.

        Without it Fabric flattens this box: it keeps a view for the painting —
        the fill, the shadow and the material are all there — and hoists its
        CHILDREN to the accessory. The pill is then a SIBLING of the field
        rather than its parent, and the press is unreachable twice over.
        `UIGlassEffect.interactive` needs the touch to land inside the effect
        view, and the reproduction watches touches on the box's own subtree; a
        hoisted field is in neither. At `didMoveToWindow`:

          flattened  EXPElementTextAreaComponentView < UIView < EXPKeyboardAccessoryContentView
          kept       EXPElementTextAreaComponentView < EXPElementBoxComponentView < UIView < …

        Nothing on screen says which of those you have: the bar draws correctly
        either way and simply does not respond, which reads as a control that is
        not listening rather than as a bug.
      */}
      <div
        collapsable={false}
        style={styles.glass}
        onLayout={event => {
          const {width, height} = event.nativeEvent.layout;
          onFieldSize?.({width, height});
        }}
        appleVisualEffect={FIELD_GLASS_KEYWORD}>
        {/* Multi-line, so `<textarea>`; `<input>` is the single-line one.

            No height, only `minHeight` and `maxHeight`, so it grows with what is
            typed and then stops and scrolls. A fixed height is what stops that. */}
        <textarea
          ref={inputRef}
          autoFocus={autoFocus}
          /*
           * ONE row, which is HTML's way of saying one line.
           *
           * `<textarea>`'s default is `rows="2"` — the spec's default, honoured
           * faithfully by the shadow node — so without this the field opens
           * two lines high and the pill comes out 72 points against the native
           * app's 40. That is the element doing exactly what it is supposed to
           * do, so there is no padding to hunt down.
           */
          rows={1}
          /*
           * `caret-color`, and it is the native app's own blue rather than the
           * window's tint.
           *
           * Measured on the same simulator: its caret is (0,136,255) — the same
           * #0088FF the send button and the balloon's lower stop are. UIKit
           * draws the insertion point in the control's `tintColor`, which is
           * inherited unless something says otherwise, so an unset composer
           * takes the app's accent — (66,107,242), a colour nobody chose for
           * it.
           */
          caretColor={SEND_FILL}
          /*
           * The height changes in ONE FRAME, deliberately.
           *
           * The native composer eases it — its resize duration is 0.1, about
           * six frames — and a `transition: height 0.1s` on this style is all
           * it takes, because the field's height is a number this file computes
           * and the bar is sized by it. Eased, it reads as glitching and
           * jitter in both the field and the transcript.
           *
           * The jitter is not the transition's arithmetic. A growing field
           * changes the ACCESSORY's height, which UIKit animates on its own
           * inside the keyboard's transition, so an eased height is two
           * animations of different lengths driving the same edge. Growing in
           * one frame leaves one of them. Put the transition back only with
           * that second animation accounted for.
           */
          onContentSizeChange={event => {
            setContentHeight(event.nativeEvent.contentSize.height);
            // And the ceiling, here rather than on a prop — see `getRoom`. Both
            // land in one render.
            const room = getRoom?.();
            if (room != null) {
              setCeiling(Math.max(LINE, grownRef.current + room));
            }
          }}
          style={[styles.field, {height: grown}]}
          placeholder="Message"
          value={value}
          // `onInput`, not `onChange`: HTML's `input` event is the per-keystroke
          // one and `change` is the commit, and the text arrives as `value`.
          onInput={event => onChangeText(event.nativeEvent.value)}
          onFocus={onFocus}
        />
        {/*
          The MICROPHONE, which is what the native app puts here when the field
          is empty — and the field is empty most of the time.

          Everything about it is the framework's rather than a fit to a
          screenshot. The native dictation button's symbol is `microphone` at
          the body text style, Regular weight, Medium scale, and its tint is
          `rgba(180, 184, 191, 1)`, which is the exact colour the pixel under
          the native mic reads. Rendered at that configuration the symbol's ink
          is 12.00 x 17.67 against the 11.67 x 17.67 measured off the native app
          — the width is a third of a point, which is one pixel at 3x and all
          the comparison resolves.

          DECORATION, said out loud. The native app's is a dictation button and
          there is no API to start dictation, so a `<button>` here would be a
          control that looks live and does nothing — worse than not having one.
          The keyboard's own mic key is the real affordance and it still works.
          `aria-hidden` keeps it out of the accessibility tree for the same
          reason.
        */}
        {!hasDraft && (
          <img
            aria-hidden={true}
            src="system:microphone"
            tintColor={MIC_TINT}
            style={styles.mic}
          />
        )}
        {/* Only when there is something to send — which is what lets the field
            run the full width the rest of the time. */}
        {hasDraft && (
          <button
            type="button"
            style={styles.send}
            accessibilityLabel="Send"
            onClick={() => onSend(value.trim())}>
            {/*
              An arrow GLYPH rather than `system:arrow.up`, for a reason about
              the shape rather than about the loader.

              The loader exists — `EXPSystemImageLoader` serves `system:` URLs
              and the dictation glyph above is one. But the native send button
              draws a vector ASSET rather than a symbol, so there is no symbol
              to name that is the thing it draws: `arrow.up` at 17 points
              matches on the ink or on the shaft and never on both. U+2191 is
              the same shape at this size, and the remaining third of a point is
              recorded in the README as accepted.
            */}
            <span style={styles.glyph}>↑</span>
          </button>
        )}
      </div>
      {/*
        The panel, which takes the keyboard's place while it is open.

        Its options are a list, not a menu — a menu is the right BEHAVIOUR and
        the wrong presentation: the native app replaces the keys rather than
        covering them, and the difference is that the composer does not move and
        the transition is the system's.
      */}
      <NativeKeyboardPanel
        visible={panelOpen}
        presentation="overlay"
        anchor={anchor}
        onClose={() => setPanelOpen(false)}
        style={[styles.panelBox, panelMetrics]}>
        <div
          style={styles.panelCard}
          /*
           * GLASS, which is what the native app's card is on iOS 26 and what
           * was asked for. The card floats over the keys rather than over the
           * transcript, so there is something behind it for the effect to work
           * on.
           */
          appleVisualEffect="-apple-system-glass-material">
          {/*
            On the LIST rather than on the card, and that is the whole point: the
            card's surface has to be visible while it grows, or there is no morph
            to see — only the contents wait. See `PANEL_CONTENT_DELAY`.
          */}
          <AnimatedScroll
            style={[styles.panelList, {opacity: panelContentOpacity}]}>
            {actions.map(action => (
              <button
                key={action.id}
                type="button"
                style={[styles.panelItem, rowMetrics]}
                /*
                 * The label, stated — in ARIA, because these are HTML elements.
                 *
                 * A row's accessible name is built from its CONTENTS, and its
                 * contents begin with a decorative glyph, so VoiceOver reads
                 * "≡, Add fifty messages". `aria-hidden` on the glyph does not
                 * help: the name walk reads the text tree, not the
                 * accessibility tree. Whenever the visible content is not the
                 * name, the name has to be said.
                 *
                 * The spelling is deliberate: the UI tests look these rows up
                 * by name.
                 */
                aria-label={action.label}
                onClick={() => {
                  setPanelOpen(false);
                  action.onPress();
                }}>
                <div
                  aria-hidden={true}
                  style={[
                    styles.panelTile,
                    /*
                     * Sized with the reader's text, because everything beside
                     * it is.
                     *
                     * The label is Dynamic Type and grows; a tile stated in
                     * fixed points does not, so at an accessibility size the
                     * glyph inside it is drawn several times the tile's own
                     * width and only a corner of it lands on the circle, which
                     * reads as a bite taken out of the edge. A native list
                     * grows the whole row together, which is what this does.
                     *
                     * Not `em`: that unit is implemented for font-size, and
                     * these are widths.
                     */
                    tileMetrics,
                    /*
                     * The row's own colour, over the shared default.
                     *
                     * Destructive still wins, because red on a destructive row
                     * is not decoration — it is the same thing the label's
                     * colour says, and an author who tinted it something else
                     * would be overriding a warning with a preference.
                     */
                    action.tint != null && {
                      backgroundColor: accentColor(action.tint),
                    },
                    action.destructive === true && styles.panelTileDestructive,
                  ]}>
                  {/*
                    An IMAGE, not a glyph.

                    A `system:` source is the platform's own icon — see
                    `EXPSymbolImageLoader`. Drawn as a template so `tintColor`
                    colours it, and centred by the tile's own flexbox, which
                    works because an `<img>` is a real box: a bare glyph is an
                    anonymous run elided off the layout tree, so `align-items`
                    never reaches it and the centring comes from a line box's
                    metrics instead — which sits `≡` high, an arrow low, and has
                    iOS draw the pencil as a colour emoji at its own size.
                  */}
                  <img
                    src={`system:${action.symbol ?? 'circle'}`}
                    tintColor="#ffffff"
                    style={glyphMetrics}
                  />
                </div>
                <span style={styles.panelLabel}>{action.label}</span>
              </button>
            ))}
          </AnimatedScroll>
        </div>
      </NativeKeyboardPanel>
    </div>
  );
}

/**
 * THE bar, so that both screens have the same one.
 *
 * What is shared is the BAR — its surface, its fade and its paddings. What each
 * screen passes in is its own composer and its own actions, which is the part
 * that legitimately differs.
 */
export function ComposerBar({children}: {children: React.Node}): React.Node {
  /*
   * How much of the home indicator's strip the bar is still standing on.
   *
   * 1 while it rests on the screen, 0 while the keys are under it, and every
   * value between during the transition — see `onDockChange` on the element,
   * and `ExpoKeyboardAccessoryEventEmitter.h` for why no other signal answers
   * this. An `Animated.Value` rather than state: the event fires on every frame
   * of the keyboard's rise and re-rendering both screens thirty times for a
   * padding is not what the number is worth.
   */
  const docked = React.useRef(new Animated.Value(1)).current;
  /*
   * The bar is CONCENTRIC with the screen's corner when it is resting on it.
   *
   * The native concentric padding is 28, and it applies in one state and not
   * the other: the native composer uses it docked and the ordinary margins
   * raised. The reason is the display's own rounded corner — a bar sitting on
   * the bottom of the screen has that curve beside it, and a pill concentric
   * with it has to stand further in. Raised, the bar is on the keyboard, the
   * corner is nowhere near it, and 16/12 apply.
   *
   * Measured on the same simulator, both apps docked with the keyboard down:
   * the native app's `+` glyph starts at x 40.33, against 28.33 for a bar that
   * keeps its raised margin — twelve points, exactly the difference between 28
   * and 16.
   *
   * The BOTTOM is the same rule and the same measurement. The sixteen points
   * below the pill are measured against the KEYS; docked there are no keys, and
   * the strip the element reserves for the indicator is the padding, so adding
   * both counts it twice and stands the `+` twenty-two points high.
   *
   * The last six are why this bar sets `automaticInsets={false}`. The native
   * app's 28 is LESS than the 34-point bottom safe area, so its pill
   * deliberately overlaps the top of the strip the system reserves, and while
   * the element is also reserving there is no padding that expresses that,
   * because the two add: measured with both apps docked, the native app's pill
   * ends 28 points above the screen's bottom edge and a reserving bar's ends
   * 34. Owning the strip and paying 28 of it is the only way to land on the
   * native app's number, and it is what the element's opt-out is for.
   *
   * So the bottom padding is the WHOLE distance to the screen's edge rather
   * than a top-up: 16 above the keys, 28 against the corner, and the element
   * adds nothing to either.
   */
  const padding = {
    paddingLeft: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_MARGIN, COMPOSER_DOCKED_SIDE],
    }),
    paddingRight: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_MARGIN_TRAILING, COMPOSER_DOCKED_SIDE],
    }),
    paddingBottom: docked.interpolate({
      inputRange: [0, 1],
      outputRange: [COMPOSER_BOTTOM_RAISED, COMPOSER_DOCKED_BOTTOM],
    }),
  };
  return (
    <NativeKeyboardAccessory
      /*
       * The platform's own bar material.
       *
       * A fill can only interpolate toward one colour, so content passing under
       * a fill is lightened rather than blurred, which is the hard edge a
       * balloon shows against it.
       *
       * The native app does blur what passes beneath: measured on the same
       * simulator with a balloon scrolled under its composer, the
       * high-frequency detail of the text drops from 15.99 above the bar to
       * 8.21 under it.
       *
       * The bar is a subview of the screen, in the app's own window, so a
       * material on it has the transcript behind it to sample.
       */
      /*
       * Fitted against the native app in DARK mode, which is the appearance
       * that can tell these apart: over a black page its composer renders
       * (0,0,0) and the platform's darkest bar material renders (19,19,19).
       * Every other stock style is lighter still — thin, thick and ultra-thin
       * all measure (31,31,31) — so the keyword alone cannot close it.
       *
       * Opacity attenuates the blur and the tint TOGETHER, because what it
       * blends toward is the unblurred page. So this is bought, not free: see
       * the sweep beside `appleVisualEffectOpacity` in the shadow node.
       */
      appleVisualEffectOpacity={BAR_MATERIAL_STRENGTH}
      appleVisualEffect="-apple-system-blur-material-chrome"
      appleVisualEffectFade={FADE}
      /*
       * This bar pays for the home indicator's strip itself — see `padding`
       * above. Off is unusual and deliberate: the default is on because a bar
       * that ends under the indicator is a bug, and an author should not have to
       * know that to avoid it.
       */
      automaticInsets={false}
      style={styles.bar}
      onDockChange={event => docked.setValue(event.nativeEvent.docked)}>
      {/*
        The paddings are on an inner box rather than on the bar itself, and the
        box is also what GROUPS the glass inside it.

        `-apple-system-glass-container` is a `UIGlassContainerEffect`: the `+`
        and the field are rendered as one shape, so they merge as they come
        within twelve points of each other — which the `+`'s own press does,
        since a glass surface grows 1.05 under a finger. That is the blob the
        composer has in the native app.

        On THIS box rather than on the bar, and that is not a detail: a
        container's effect view draws the merged glass and this surface's own
        fill is drawn ABOVE it, so putting the container on the bar — which
        carries `BAR_FILL` — would paint 87% white over the very thing it
        groups. This box has no background, so there is nothing over the glass.

        `createAnimatedComponent` around a COMPOSITE hands the animated value to
        that composite's own ref through `setNativeProps`, and this element's ref
        is not the view the style lands on — the same trap the balloon's surface
        hit. A plain host `<div>` inside it has no such ambiguity, and the bar
        keeps its surface, which is the part that must not move.
      */}
      <AnimatedDiv
        collapsable={false}
        appleVisualEffect="-apple-system-glass-container"
        style={[styles.barBox, padding]}>
        {children}
      </AnimatedDiv>
    </NativeKeyboardAccessory>
  );
}

const styles = StyleSheet.create({
  /* The bar's SURFACE, which is all this carries: `BAR_FILL` and the soft top
     edge `FADE`, both measured off the native app. The paddings move with the
     dock and live on `barBox`. */
  bar: {
    backgroundColor: BAR_FILL,
    display: 'flex',
    flexDirection: 'column',
  },
  /* And its box, whose side and bottom paddings depend on whether the bar is
     resting on the screen's corner — see `ComposerBar`. */
  barBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingTop: BAR_TOP_PADDING,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: GAP,
  },
  /*
   * The glass carries the field's shape, so the field itself draws nothing.
   *
   * `display: 'flex'` because this is a `<div>`, which is display:block — the
   * `flex: 1` on the textarea does nothing without it, and the send button then
   * lays out beside the field instead of within it.
   */
  glass: {
    /*
     * The pill's SURFACE where there is no glass to be one.
     *
     * On iOS this box wears `-apple-system-glass-material` and needs no fill.
     * Android has no such material, so without one the composer is a bare strip
     * of bar with a field on it. Filled, it is the rounded input Material uses —
     * Google Messages' pill reads (241,240,247) on a (248,249,255) page, which
     * is `colorSurfaceContainerHighest`, the tone `systemGray5` maps to here.
     */
    ...Platform.select({
      ios: null,
      default: {backgroundColor: uiColor('systemGray5')},
    }),
    display: 'flex',
    flexDirection: 'row',
    /*
     * The pill is exactly as tall as the field, and the field is one line.
     *
     * The native text view has its own container inset, so a box shorter than
     * the control wants pushes the glyphs against the bottom. Letting the field
     * BE the pill puts the caret where UIKit puts it, and the pill then grows
     * with the field for free.
     */
    /*
     * NO fill — the SYSTEM DEFAULT glass, which is the surface the platform
     * ships for a search bar.
     *
     * A tint at any alpha reads as frost, and tint-free glass is the closest
     * match of the honest options anyway: 252.7 light / 19 dark against the
     * native app's 254.34 / 25, versus a fitted tint's 254.88 / 4. The tint
     * buys 1.6 levels of light-mode agreement at the cost of the glass's whole
     * character.
     *
     * A fill would also hide the press. The colour a box paints goes to its
     * material and is drawn ABOVE the effect — see
     * `-[EXPElementBoxComponentView exp_backgroundColorForLayer:]` — while the
     * glass answers a finger by scaling its host 1.05 underneath it.
     *
     * The blur RADIUS is not reachable either: the native field sits over a
     * single blur of radius 24, `effectWithBlurRadius:` is not public, and our
     * keyword set maps to `UIBlurEffectStyle`.
     */
    /*
     * NO shadow, and that is the "bright core" fix.
     *
     * A translucent view has no opaque shape to cast a shadow from, so iOS
     * synthesises one: an opaque backing at the view's RESTING footprint, which
     * renders as a bright rectangle inside the pill and does NOT grow when the
     * interactive glass press expands the surface. The glass's own
     * `cornerConfiguration` rim (see `EXPMaterialSurface`) is the edge instead,
     * so a shadow is both redundant and the fault.
     */
    alignItems: 'stretch',
    flex: 1,
    /* The send button's trailing clearance — see `SEND_INSET_TRAILING`. */
    paddingRight: SEND_INSET_TRAILING,
    // Fully rounded at the one-line height, which is what makes it a pill
    // rather than a rounded box — and stays right as it grows, because a
    // radius of half the minimum height cannot exceed half the actual one.
    borderRadius: LINE / 2,
    /*
     * NOT `overflow: hidden`, because a `box-shadow` would not survive it.
     *
     * DOM-CSS-LIMITATION(clipping-eats-the-shadow): CSS paints a `box-shadow`
     * outside the border box, where the element's own `overflow` has no say over
     * it. iOS draws it on the view's own layer, and `overflow: hidden` sets
     * `masksToBounds`, which clips the shadow away with everything else —
     * measured, a field's shadow goes from four levels at its edge to a third
     * of one.
     *
     * Nothing here needs the clip: `EXPMaterialSurface` rounds and masks the
     * material itself, and the field and the send button are inside the pill by
     * their own layout. A box that did need both would need a wrapper.
     */
  },
  field: {
    flex: 1,
    /*
     * `auto`, to get out from under the user-agent's fixed height.
     *
     * A `<textarea>`'s UA style is `chrome + rows * lineHeight` — 30 + 21 on
     * iOS — and an explicit height beats a `minHeight`, so the pill comes out
     * 51 however the padding is written. That default is right for a bare
     * textarea, which HTML says is a fixed-size box; it is wrong for a composer,
     * which is the CSS `field-sizing: content` case. Saying `auto` is how an
     * author opts out, and `minHeight`/`maxHeight` then govern the growth.
     */
    height: 'auto',
    /*
     * ONE LINE to start, and the line is what makes the pill 40.
     *
     * Stated as the line rather than as a stack of paddings: the text's own
     * line box is 22 and the padding is what brings the pill to `LINE`, so
     * changing `LINE` moves one number and the pill follows. Written the other
     * way round — `minHeight: 36` with 8 points above and below — the field
     * opens 52 tall against the native app's 40.
     */
    minHeight: LINE,
    /*
     * And a MAXIMUM, which is what makes it stop and scroll.
     *
     * Without one the field is `height: auto` with only a floor, so the bar is
     * exactly as tall as the text however tall that gets: sixteen wrapping
     * lines grow it up THROUGH the navigation header, with line one behind the
     * title.
     *
     * It has to be a YOGA bound rather than a native one. A native ceiling caps
     * the bar correctly but the text CLIPS — Yoga lays the inner text view out
     * at its full content height, so an Auto Layout limit on the bar only crops
     * it, and everything past line sixteen is invisible while still being
     * typed. Bounding the box in layout is what makes `RCTUITextView` turn its
     * own scrolling on.
     *
     * TWELVE lines is FITTED, not derived, and worth saying so: the native app
     * caps at "as much as the space allows" — measured with sixteen identical
     * lines, its composer stops just under the header and scrolls, its capture
     * starting mid-sentence at "line 4". Expressing that honestly needs the
     * keyboard's height on the JS side, which this element does not publish
     * yet; twelve lines is close to it on a phone in portrait and always inside
     * the space. There is NO native backstop: a top limit against the safe area
     * changes the bar's resting geometry, which the UI suite catches —
     * `MaterialCheck` reads the surface as covered 13.0 points above the bar's
     * top edge. If landscape or large Dynamic Type needs a bound, it belongs
     * here in layout too, not in Auto Layout.
     */
    maxHeight: LINE + LINE_HEIGHT * 11,
    /*
     * Per EDGE, not the shorthand.
     *
     * The user-agent sheet states a textarea's sides individually, and Yoga
     * resolves a tie between two style layers by EDGE SPECIFICITY rather than by
     * which layer wrote them — so four named edges beat one `borderWidth: 0`,
     * whoever wrote it.
     */
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    /*
     * MEASURED off the native app, from the CARET rather than from the ink — a
     * caret has no side bearing to allow for.
     *
     * Its pill's left edge is at x=68 — the 16-point margin, the 40-point `+`
     * and the 12-point gap — and its caret sits at 83.00, so the text starts
     * fifteen points inside the pill. Its placeholder's ink starts at 86.00,
     * which is the same reading plus the two points of left side bearing `H`
     * carries at this size; read off the ink alone this comes out eighteen.
     *
     * `lineFragmentPadding` is zeroed natively, so this is the whole inset
     * rather than one of two.
     */
    /* iMessage's caret sits 15 points inside its pill; Material's field insets
       its text by 16. Each platform's own. */
    paddingLeft: Platform.OS === 'ios' ? 15 : 16,
    paddingRight: 6,
    /*
     * Vertical padding is the text container's inset, and it is what centres
     * the text — one line in a one-line pill, and every line in a grown one.
     *
     * Per EDGE, like the borders above: the user-agent sheet states a
     * textarea's padding one side at a time, and Yoga breaks a tie between two
     * style layers by EDGE SPECIFICITY rather than by which layer wrote them,
     * so a `paddingVertical` shorthand loses to the UA's named top and bottom.
     */
    paddingTop: FIELD_INSET,
    paddingBottom: FIELD_INSET,
    backgroundColor: 'transparent',
    color: systemColor('FieldText'),
  },
  /*
   * The `+`, at the native app's own size, in Liquid Glass.
   *
   * The native button is a circle of MATERIAL with a plain `plus` glyph on it,
   * not a filled-circle symbol — so the surface is `-apple-visual-effect`
   * rather than a colour.
   *
   * MEASURED off the native app running on this simulator, in a 402-point
   * window: the button is 40x40 at x=28..68 and the field is 40 tall at
   * x=80..374, so the two are the same height, the outer margin is 28 and the
   * gap is 12. Read from the running app rather than from its constants because
   * geometry is the one thing a screenshot states better than a symbol table
   * does.
   */
  plus: {
    width: PLUS,
    height: PLUS,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    /*
     * The SHAPE is stated on iOS and left to the platform on Android.
     *
     * A radius counts as claiming the surface — `authorStatesSurface` — which
     * on iOS is what shapes the glass the button asks for. On Android claiming
     * it would stand Material's own chrome down, and that chrome is exactly
     * what should draw here: the tonal pill, inset in the touch target, with
     * the platform's ripple in it.
     */
    ...Platform.select({
      ios: {borderRadius: PLUS / 2},
      default: {marginBottom: (LINE - PLUS) / 2},
    }),
    /*
     * Not faded out while the panel is open.
     *
     * The card grows out of this button's own rectangle, so for the length of
     * the animation there are two things on screen claiming to be the same
     * object. Fading this one out fixes that and takes the way OUT with it:
     * tapping the `+` again is how the panel closes, and a button at zero
     * opacity is not a target — caught by `TeardownCheck`, which taps it twice.
     * A control you can see the effect of but cannot reach is worse than two
     * overlapping shapes for a fifth of a second.
     */
  },
  /* The symbol's own square, which the two bars cross in. */
  plusIcon: {
    width: PLUS_ICON,
    height: PLUS_ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBarH: {
    position: 'absolute',
    width: PLUS_ICON,
    height: PLUS_ICON_STROKE,
    // Round ends, because the symbol's are: rendered at 12x, `plus` closes each
    // of its four arms with a semicircle rather than a flat cut.
    borderRadius: PLUS_ICON_STROKE / 2,
    /*
     * FULL contrast, not `secondaryLabel`.
     *
     * The native button's glyph colour is `#858E99`, and that is right against
     * its opaque light-grey circle. Ours is glass — nearly the page's own
     * colour — so the same grey on it reads as a ghost. The icon carries the
     * contrast the surface does not.
     */
    backgroundColor: uiColor('label'),
  },
  plusBarV: {
    position: 'absolute',
    width: PLUS_ICON_STROKE,
    height: PLUS_ICON,
    borderRadius: PLUS_ICON_STROKE / 2,
    backgroundColor: uiColor('label'),
  },
  /*
   * Bottom right, and it stays there.
   *
   * The row stretches its children to the pill's height, and a child with a
   * height of its own is aligned to the START of that, which puts the send
   * button at the TOP of a grown composer. `flex-end` puts it against the
   * bottom, and
   * the margin is its clearance from that bottom — the same `SEND_INSET` the
   * pill's padding holds it off the end by, which is also what centres it while
   * the pill is still one line.
   */
  mic: {
    width: MIC_W,
    height: MIC_H,
    /* The symbol at its own size, not stretched to the box — `<img>`'s initial
       `object-fit` is `fill`, which squashed the panel's glyphs the same way. */
    objectFit: 'contain',
    alignSelf: 'flex-end',
    marginRight: MIC_INSET_TRAILING,
    marginBottom: (LINE - MIC_H) / 2,
  },
  send: {
    width: SEND_W,
    height: SEND_H,
    borderRadius: SEND_H / 2,
    alignSelf: 'flex-end',
    marginBottom: SEND_INSET,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    /*
     * The BALLOON's blue, not the link colour.
     *
     * The native theme keeps a send button colour per balloon theme beside the
     * balloon colours themselves, and the button a message leaves from is the
     * colour the message arrives in. The bottom stop, because a flat fill takes
     * the end the gradient meets it at, which is the same rule the reaction
     * badge follows.
     */
    backgroundColor: SEND_FILL,
  },
  /*
   * The panel's height is stated, because a keyboard's is: UIKit reads the
   * input view's size and gives it exactly that much of the screen.
   */
  /*
   * A column, so the card can fill it.
   *
   * The panel's box reaches the bottom of the screen, so the card has to be held
   * off it — the home indicator's strip, which a keyboard reserves for itself.
   * `env()` rather than a measured 34: it resolves during the layout pass, so
   * there is no first frame laid out against the wrong number.
   *
   * Not double-counted with `-_positionContent`'s clamp to `maxY -
   * safeAreaInsets.bottom - EXPKeyboardPanelAnchorGap`: the clamp places the
   * BOX, and this holds the card off the bottom of it. Without it the card runs
   * 11 points UNDER the composer and its last row is cut in half by the bar.
   */
  panelBox: {
    // The height is computed per panel — see `panelMetrics`. This is the cap and
    // the fallback.
    height: PANEL_HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: PANEL_CARD_INSET,
    paddingBottom: env('safe-area-inset-bottom', 0),
  },
  /*
   * A CARD inside the panel, not the panel itself.
   *
   * The native app's list is a floating surface anchored at the composer's left
   * edge, and the space around it is not part of it — so the panel stays clear
   * and only the card is drawn. The material is what makes it read as a surface
   * above the app rather than a region of it, and it is the reason nothing here
   * states a colour: the card is near-white over the transcript in light mode
   * and near-black in dark, and both are the material resolving itself.
   */
  panelCard: {
    display: 'flex',
    // Sized by its list, so a short list gets a short card. Bounded by the
    // box's `maxHeight` above, which is where a long one starts scrolling.
    flexShrink: 1,
    /*
     * SIZED BY ITS LIST, with the same inset on both sides.
     *
     * Measured with the native app's own send menu open on this simulator, its
     * card spans x 10 to 332 — 322 wide on a 402-point window, which is the 319
     * measured on a 393-point one. Ours comes out at 352, measured the same
     * way, and the whole difference is the labels: "Dismiss the keyboard" is
     * longer than anything in the native app's list, and pinning the card to
     * the native app's width wraps it onto two lines.
     *
     * So the number stated is the INSET, not the width. The card is as wide as
     * what is in it and no wider than the screen less two of these, which is
     * the rule the native app is following too.
     */
    marginLeft: PANEL_CARD_INSET,
    marginRight: PANEL_CARD_INSET,
    marginBottom: PANEL_CARD_INSET,
    borderRadius: PANEL_CARD_RADIUS,
    /*
     * A MATERIAL, because there is something behind it: a `UIVisualEffectView`
     * samples what is behind it WITHIN ITS OWN WINDOW, and the card is hosted
     * over the keys.
     *
     * The overlay is hosted in `UIRemoteKeyboardWindow` — over the KEYS — so
     * what it samples is the keyboard, which is what the native app's card sits
     * over too. Measured over a white transcript it reads (252, 252, 252),
     * which is what a thick material produces over white.
     */
    /*
     * The stated colour is the ANDROID answer, and on iOS it has to be absent
     * rather than merely secondary.
     *
     * A view's `background-color` is drawn by its layer, which is above the
     * material host and therefore ON TOP of the effect — so an opaque colour
     * here does not lose to the material, it hides it: the card then reads a
     * flat `secondarySystemGroupedBackground` with no blur in it at all.
     */
    backgroundColor: Platform.select({
      ios: 'transparent',
      default: uiColor('secondarySystemGroupedBackground'),
    }),
    /*
     * The native app's card floats, and a card with no shadow reads as a
     * region.
     *
     * It is also the ONLY thing that darkens the page: measured with the native
     * app's own send menu open, the page beside the card is (255, 255, 255) and
     * its shadow takes it to 245 at the card's foot.
     */
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
    overflow: 'hidden',
  },
  /*
   * The same inset above and below the rows as the card has at its sides.
   *
   * Without it the first and last rows sit flush against the card's edges while
   * everything horizontal is inset by eleven points, which reads as a card
   * padded on two sides and not the other two.
   */
  panelList: {flex: 1, paddingVertical: PANEL_CARD_INSET},
  /*
   * `alignItems: 'center'` rather than a stated height on the tile and the
   * label both: the row's height is the pitch, and the two things in it are
   * centred on it, so a longer label that wraps grows the row instead of
   * pushing its own tile off-centre.
   */
  panelItem: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: PANEL_ROW,
    paddingLeft: PANEL_TILE_INSET,
    paddingRight: 16,
    gap: PANEL_LABEL_X - PANEL_TILE_INSET - PANEL_TILE,
    /*
     * `appearance: 'none'` — CSS's own switch for taking over a control's
     * rendering. A `<button>` otherwise gets the platform's chrome, so every
     * row draws its own rounded grey capsule and the card becomes a stack of
     * buttons with white gutters between them rather than a list on a surface.
     *
     * A row in a menu is not a button-shaped thing. The native app's rows have
     * no surface of their own at all.
     */
    appearance: 'none',
  },
  /*
   * The tile is a circle, so its radius is half its side — written as the
   * expression rather than 19, because the two have to move together.
   */
  panelTile: {
    display: 'flex',
    width: PANEL_TILE,
    height: PANEL_TILE,
    /*
     * It is a CIRCLE, so it may not be squeezed.
     *
     * `flex-shrink` is 1 by default, and a row is free to take width from any
     * child that allows it. At the default text size the label fits and nothing
     * is taken; raise the text size and the label needs the room, so the tile
     * is squashed into an oval — and then a teardrop, and then narrow enough to
     * clip the glyph out of existence. A stated width is only a width while
     * something says it cannot be traded away.
     */
    flexShrink: 0,
    borderRadius: PANEL_TILE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColor('systemBlue'),
    color: '#ffffff',
    fontSize: 18,
    lineHeight: PANEL_TILE,
    textAlign: 'center',
    /*
     * A GLYPH is not an icon, which is why the tile holds an `<img>`.
     *
     * A tile centres a line box, and a line box is centred on the font's
     * metrics rather than on the ink inside it: `\u2261` sits high in its em
     * box, an arrow sits low, and an emoji is drawn at its own size entirely.
     * One correction cannot centre them all. Artwork has no baseline and no em
     * box, so there is nothing left to centre — see
     * `expo-intrinsics/__docs__/SymbolSource.md`.
     */
  },
  panelTileDestructive: {backgroundColor: uiColor('systemRed')},
  panelLabel: {
    flex: 1,
    fontSize: PANEL_LABEL_SIZE,
    color: uiColor('label'),
    // A button centres its label; a menu row does not.
    textAlign: 'left',
  },
  /*
   * Sized so the arrow's ink is about sixteen points tall in a twenty-seven
   * point button, which is what the native app's is — measured off the rendered
   * button as 0.59 of its height. `lineHeight` is the button's own height so
   * the glyph centres on it rather than on the font's line box.
   */
  glyph: {
    fontSize: 22,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: SEND_H,
  },
});
