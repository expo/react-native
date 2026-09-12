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

/*
 * The platform's six reactions, in its own order — Heart, ThumbsUp, ThumbsDown, Ha,
 * Exclamation, Question. The glyphs are Apple's own artwork rather than Unicode
 * (the fourth is a drawn "HA HA"), so these are the nearest characters — the
 * badge draws the glyph, and the `symbol` is the SF Symbol name for VoiceOver.
 *
 * Kept in its own module, apart from `ChatScreen`, so the cycling below can be
 * exercised by a fast unit test without loading the whole element catalog and a
 * renderer — the same reason `resistedReveal` and the receipt timing live on
 * their own. See `__tests__/reactions-test.js`.
 */
/*
 * `art` is what the BADGE draws, when a captured one showed the emoji was wrong.
 *
 * Captured from the platform's own chat on the simulator (iOS 26), badge by
 * badge:
 *
 *   heart    a PINK gradient heart, not the red `❤️` emoji
 *   ha       the WORDS "HA HA", white, stacked on two staggered lines — not a
 *            face at all. The native artwork is the words, which is why `😂`
 *            never looked right.
 *
 *   bang     WHITE "!!", not the red `‼️` emoji
 *   question WHITE "?", not the red `❓` emoji
 *   up/down  a WHITE 3D thumb, not the gold `👍`
 *
 * The rule, once every badge had been captured rather than inferred: on the
 * BADGE every glyph is white except the heart, which is pink. The PICKER shows
 * the same glyphs in colour — gold thumbs, blue "HA HA", red "!!", purple "?" —
 * so reading a badge off the picker gets all but one of them wrong. That is
 * exactly the mistake that put `😂` here, so each of these was applied in
 * the native chat and photographed on its own.
 *
 * `\uFE0E` is the text-presentation selector: it asks for the monochrome glyph
 * rather than the colour emoji, which is what makes a white one possible at all
 * without shipping artwork. Where the font has no monochrome form the emoji
 * comes back, which is why the result is checked in a capture and not assumed.
 */
export const REACTIONS = [
  {
    id: 'heart',
    glyph: '❤️',
    /*
     * A SYMBOL, for the shape. The `♥` text glyph is narrower and more pointed
     * than Apple's heart, which reads as a different mark at 20 points beside
     * the real one. `heart.fill` is Apple's own outline.
     *
     * Still FLAT pink where the native badge is shaded light-to-deep: that
     * gradient is in its artwork and neither a font nor a tinted symbol can
     * carry it. The colour is sampled from the capture's midtone.
     */
    art: {symbol: 'heart.fill', color: '#FF8AB8', size: 19},
    label: 'Loved',
    symbol: 'heart',
  },
  /*
   * The thumbs are a SYMBOL, not text.
   *
   * The native badge draws a white thumb; a font cannot give one. `\uFE0E` — the
   * text-presentation selector, which is supposed to ask for the monochrome
   * glyph — was tried and iOS returns the colour emoji anyway, so the badge
   * stayed gold. `<img src="system:…">` draws an SF Symbol and takes a
   * `tintColor`, which is what the composer's microphone already does, and it is
   * what the `symbol` field beside every reaction was always for.
   *
   * `.fill` because the badge's thumb is solid, not outlined.
   */
  {
    id: 'up',
    glyph: '👍',
    art: {symbol: 'hand.thumbsup.fill', color: '#FFFFFF', size: 18},
    label: 'Liked',
    symbol: 'hand.thumbsup',
  },
  {
    id: 'down',
    glyph: '👎',
    art: {symbol: 'hand.thumbsdown.fill', color: '#FFFFFF', size: 18},
    label: 'Disliked',
    symbol: 'hand.thumbsdown',
  },
  {
    id: 'ha',
    glyph: '😂',
    /*
     * TWO LINES, staggered, as the native badge draws it — and a newline in
     * the text will not do it: this renderer follows HTML, where a newline in
     * content is whitespace and collapses to a space. It came out as "HA HA" on
     * one line. Lines are therefore separate boxes, and the second is nudged
     * right the way the artwork's is.
     */
    art: {
      lines: ['HA', 'HA'],
      stagger: 3,
      color: '#FFFFFF',
      size: 9,
      lineHeight: 10,
      weight: '800',
    },
    label: 'Laughed at',
    symbol: 'face.smiling',
  },
  {
    id: 'bang',
    glyph: '‼️',
    art: {text: '\u203C\uFE0E', color: '#FFFFFF', size: 19, weight: '800'},
    label: 'Emphasised',
    symbol: 'exclamationmark.2',
  },
  {
    id: 'question',
    glyph: '❓',
    art: {text: '?', color: '#FFFFFF', size: 20, weight: '800'},
    label: 'Questioned',
    symbol: 'questionmark',
  },
];

/**
 * The next reaction id after `current`, cycling through the six.
 *
 * The demo's "React to the last message" command has no picker — the native
 * floating pill needs a private accessory view a `<menu>` cannot make — so it
 * steps through the six on repeated taps instead. From no reaction (`current`
 * undefined, or an id no longer in the set) it lands on the first, Heart: a
 * `findIndex` miss is `-1`, and `-1 + 1` is `0`. From the last it wraps back to
 * the first. This is the whole state machine, kept pure so the wrap and the
 * cold-start are testable without the component.
 */
export function cycleReaction(current) {
  const at = REACTIONS.findIndex(entry => entry.id === current);
  return REACTIONS[(at + 1) % REACTIONS.length].id;
}
