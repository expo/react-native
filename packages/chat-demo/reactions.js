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
 * Native Messages' six reactions, in its order. `art` is what the reaction
 * badge draws (`ReactionArt` in ChatScreen.js); `glyph` is the nearest emoji,
 * drawn only if `art` is missing; `label` is the accessibility label. Nothing
 * reads `symbol`. Badge glyphs are white except the heart, as on native
 * Messages' badge (its picker uses other colours). See ui-metrics.md,
 * "Reaction badge glyphs".
 *
 * Separate from `ChatScreen.js` so `__tests__/reactions-test.js` can run
 * without a renderer.
 */
export const REACTIONS = [
  {
    id: 'heart',
    glyph: '❤️',
    // An SF Symbol: the `♥` character is narrower and more pointed than
    // Apple's heart. Native Messages' heart has a pink gradient; `color` is its
    // midtone.
    art: {symbol: 'heart.fill', color: '#FF8AB8', size: 19},
    label: 'Loved',
    symbol: 'heart',
  },
  // The thumbs are white SF Symbols: iOS draws 👍 as the colour emoji even
  // with `\uFE0E` (text presentation). `.fill`: the native thumb is solid.
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
    // Two lines, as native Messages draws it. Separate boxes, because a
    // newline in text collapses to a space. `stagger` is the second line's left
    // offset in points.
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
    // `\uFE0E` asks for the monochrome text form of ‼, so it can be white.
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
 * The reaction id after `current`, wrapping at the end. Returns the first id
 * when `current` is undefined or not in `REACTIONS`.
 */
export function cycleReaction(current) {
  const at = REACTIONS.findIndex(entry => entry.id === current);
  return REACTIONS[(at + 1) % REACTIONS.length].id;
}
