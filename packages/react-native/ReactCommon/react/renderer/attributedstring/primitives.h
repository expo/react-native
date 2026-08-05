/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <functional>
#include <limits>

namespace facebook::react {

enum class FontStyle { Normal, Italic, Oblique };

enum class FontWeight : int {
  Weight100 = 100,
  UltraLight = 100,
  Weight200 = 200,
  Thin = 200,
  Weight300 = 300,
  Light = 300,
  Weight400 = 400,
  Regular = 400,
  Weight500 = 500,
  Medium = 500,
  Weight600 = 600,
  Semibold = 600,
  Demibold = 600,
  Weight700 = 700,
  Bold = 700,
  Weight800 = 800,
  Heavy = 800,
  Weight900 = 900,
  Black = 900
};

enum class FontVariant : int {
  Default = 0,
  SmallCaps = 1 << 1,
  OldstyleNums = 1 << 2,
  LiningNums = 1 << 3,
  TabularNums = 1 << 4,
  ProportionalNums = 1 << 5,
  StylisticOne = 1 << 6,
  StylisticTwo = 1 << 7,
  StylisticThree = 1 << 8,
  StylisticFour = 1 << 9,
  StylisticFive = 1 << 10,
  StylisticSix = 1 << 11,
  StylisticSeven = 1 << 12,
  StylisticEight = 1 << 13,
  StylisticNine = 1 << 14,
  StylisticTen = 1 << 15,
  StylisticEleven = 1 << 16,
  StylisticTwelve = 1 << 17,
  StylisticThirteen = 1 << 18,
  StylisticFourteen = 1 << 19,
  StylisticFifteen = 1 << 20,
  StylisticSixteen = 1 << 21,
  StylisticSeventeen = 1 << 22,
  StylisticEighteen = 1 << 23,
  StylisticNineteen = 1 << 24,
  StylisticTwenty = 1 << 25
};

enum class DynamicTypeRamp {
  Caption2,
  Caption1,
  Footnote,
  Subheadline,
  Callout,
  Body,
  Headline,
  Title3,
  Title2,
  Title1,
  LargeTitle
};

enum class EllipsizeMode {
  Clip, // Do not add ellipsize, simply clip.
  Head, // Truncate at head of line: "...wxyz".
  Tail, // Truncate at tail of line: "abcd...".
  Middle // Truncate middle of line: "ab...yz".
};

enum class TextBreakStrategy {
  Simple, // Simple strategy.
  HighQuality, // High-quality strategy, including hyphenation.
  Balanced // Balances line lengths.
};

enum class TextAlignment {
  Natural, // Indicates the default alignment for script.
  Left, // Visually left aligned.
  Center, // Visually centered.
  Right, // Visually right aligned.
  Justified, // Fully-justified. The last line in a paragraph is natural-aligned.
  Start, // Aligned to the start side of the paragraph direction.
  End // Aligned to the end side of the paragraph direction.
};

enum class TextAlignmentVertical {
  Auto,
  Top,
  Bottom,
  Center,
};

enum class WritingDirection {
  Natural, // Determines direction using the Unicode Bidi Algorithm rules P2 and
           // P3.
  LeftToRight, // Left to right writing direction.
  RightToLeft // Right to left writing direction.
};

enum class LineBreakStrategy {
  None, // Don't use any line break strategies
  PushOut, // Use the push out line break strategy.
  HangulWordPriority, // When specified, it prohibits breaking between Hangul
                      // characters.
  Standard // Use the same configuration of line break strategies that the
           // system uses for standard UI labels.
};

enum class LineBreakMode {
  Word, // Wrap at word boundaries, default
  Char, // Wrap at character boundaries
  Clip, // Simply clip
  Head, // Truncate at head of line: "...wxyz"
  Middle, // Truncate middle of line:  "ab...yz"
  Tail // Truncate at tail of line: "abcd..."
};

enum class TextDecorationLineType { None, Underline, Strikethrough, UnderlineStrikethrough };

enum class TextDecorationStyle { Solid, Double, Dotted, Dashed, Wavy };

enum class TextTransform {
  None,
  Uppercase,
  Lowercase,
  Capitalize,
  Unset,
};

/*
 * `white-space` (css-text-3 §3). A shorthand over three independent behaviours,
 * which is why the values are read through the predicates below rather than
 * compared directly: no single value is "more preserving" than another along
 * every axis at once — `pre-line` preserves newlines while collapsing spaces,
 * and `nowrap` collapses everything yet does not wrap.
 *
 *   value          newlines    spaces/tabs   wraps
 *   normal         collapse    collapse      yes
 *   pre            preserve    preserve      no
 *   nowrap         collapse    collapse      no
 *   pre-wrap       preserve    preserve      yes
 *   pre-line       preserve    collapse      yes
 *   break-spaces   preserve    preserve      yes
 */
enum class WhiteSpace {
  Normal,
  Pre,
  NoWrap,
  PreWrap,
  PreLine,
  BreakSpaces,
};

/*
 * Whether a segment break in the source is content that ends a line, rather
 * than collapsible whitespace that becomes a single space.
 */
inline bool preservesNewlines(WhiteSpace whiteSpace) {
  return whiteSpace == WhiteSpace::Pre || whiteSpace == WhiteSpace::PreWrap ||
      whiteSpace == WhiteSpace::PreLine ||
      whiteSpace == WhiteSpace::BreakSpaces;
}

/*
 * Whether runs of spaces and tabs survive as authored. Note `pre-line` does
 * NOT: it is the one value that preserves newlines but still collapses spaces.
 */
inline bool preservesSpaces(WhiteSpace whiteSpace) {
  return whiteSpace == WhiteSpace::Pre || whiteSpace == WhiteSpace::PreWrap ||
      whiteSpace == WhiteSpace::BreakSpaces;
}

/*
 * Whether a line that does not fit is broken to the next one. When false the
 * text overflows its container instead, and only a segment break ends a line.
 */
inline bool wrapsText(WhiteSpace whiteSpace) {
  return whiteSpace != WhiteSpace::Pre && whiteSpace != WhiteSpace::NoWrap;
}

enum class HyphenationFrequency {
  None, // No hyphenation.
  Normal, // Less frequent hyphenation.
  Full // Standard amount of hyphenation.
};

} // namespace facebook::react
