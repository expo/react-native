/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

namespace facebook::react {

/*
 * `list-style-type` (css-lists-3 §3.1): the counter style a list item's marker
 * is rendered with.
 *
 * The predefined styles of css-counter-styles-3 §6 that are expressible with
 * that spec's three systems — `numeric` over a ten-digit set, `alphabetic`
 * over an alphabet, and `additive` over weighted symbols — which covers all of
 * §6.1 and §6.2, the symbolic bullets of §6.3, and the Roman styles of §6.4.
 *
 * DOM-CSS-LIMITATION(list-style-type-additive-scripts): the additive SCRIPTS of
 * §6.4 — `armenian` / `lower-armenian` / `upper-armenian`, `georgian`,
 * `hebrew` — are absent, as are the complex predefined styles of §7 (the CJK,
 * Japanese, Korean and Ethiopic numbering systems), whose algorithms are more
 * than an additive table. Unknown keywords fall back, so they render as
 * `decimal` rather than failing. `@counter-style` is not modelled either: an
 * author-defined counter style is stylesheet machinery and belongs with the UA
 * stylesheet, not in the renderer.
 */
enum class ListStyleType {
  None,

  // §6.3 symbolic: a fixed glyph, no counter.
  Disc,
  Circle,
  Square,
  DisclosureOpen,
  DisclosureClosed,

  // §6.1 numeric: positional, over a ten-digit set.
  Decimal,
  DecimalLeadingZero,
  ArabicIndic,
  Bengali,
  Cambodian,
  CjkDecimal,
  Devanagari,
  Gujarati,
  Gurmukhi,
  Kannada,
  Lao,
  Malayalam,
  Mongolian,
  Myanmar,
  Oriya,
  Persian,
  Tamil,
  Telugu,
  Thai,
  Tibetan,

  // §6.2 alphabetic: bijective, so the symbol after the last is the first one
  // doubled — "z" then "aa", never "a0".
  LowerAlpha,
  UpperAlpha,
  LowerGreek,
  Hiragana,
  HiraganaIroha,
  Katakana,
  KatakanaIroha,

  // §6.4 additive.
  LowerRoman,
  UpperRoman,
};

/*
 * Parses a CSS `list-style-type` keyword. Unknown keywords fall back to the
 * given default, as a UA does with a value it does not implement.
 */
ListStyleType listStyleTypeFromString(const std::string &value, ListStyleType fallback);

/*
 * `list-style-position` (css-lists-3 §3.2). `Outside` is the initial value:
 * the marker hangs in the gutter and does not displace the content.
 */
enum class ListStylePosition {
  Outside,
  Inside,
};

ListStylePosition listStylePositionFromString(const std::string &value, ListStylePosition fallback);

/*
 * The bullet an unordered list uses at a given nesting depth: disc, then
 * circle, then square, repeating — the UA stylesheet's
 * `ul ul { list-style-type: circle }` chain, expressed as a function of depth
 * because a shadow node cannot walk its ancestors.
 */
ListStyleType nestedBulletForDepth(int depth);

/*
 * A generated list marker, and the seam the list container hands it through.
 *
 * The struct and the interface live here, in the view layer, because the
 * container generating markers is a `YogaLayoutableShadowNode` while the box
 * receiving them is a text-layer node: the view layer cannot include the text
 * layer, so they meet at an abstract interface, exactly as
 * `InlineTextContentAccessor` does for inline content.
 */
struct ListMarker {
  std::string text;

  /*
   * `outside` decides the mechanism, not merely an offset:
   *  - inside: the marker is part of what the box MEASURES, so the first line
   *    starts after it and wrapped lines align under it.
   *  - outside (the CSS initial value): the marker is NOT measured — it is
   *    painted in the gutter that the list's `padding-inline-start` reserves,
   *    leaving the content box where it is so the text hangs past it.
   */
  bool outside{true};

  /*
   * A symbolic marker (disc/circle/square, the disclosure triangles) is a
   * GEOMETRIC glyph the UA sizes at its own discretion (css-counter-styles-3
   * §6.2). Browsers paint theirs at roughly a third of an em; the text
   * faces' full-size geometric characters are far larger, so a symbolic
   * marker fragment renders at a reduced font size — the flag is what tells
   * the marker builders to apply it. Counter markers ("1.", "iv.") are TEXT
   * and keep the item's size.
   */
  bool symbolic{false};

  bool operator==(const ListMarker &other) const
  {
    return text == other.text && outside == other.outside &&
        symbolic == other.symbolic;
  }
};

/*
 * The scale a symbolic marker's glyph renders at, per platform font.
 *
 * Browsers PAINT their markers: ~0.33em of the item's font (real Safari: a
 * 16px item paints a 5.3px disc). We render the geometric glyphs (●/○/■)
 * instead, and their ink is a property of the platform font, not of Unicode:
 * measured on-screen, SF draws ● at ~0.77em of its point size, Roboto at
 * ~0.48em — a single scale cannot land both. Each platform's scale is
 * derived from the same target: scale = 0.33 / (that font's ink ratio).
 *
 * DOM-CSS-DEVIATION(glyph-markers-not-painted): a font glyph will track the
 * browsers' painted size within ~15% across the trio (the three forms' ink
 * ratios differ slightly within a font), not exactly.
 */
#if defined(__APPLE__)
constexpr float kSymbolicMarkerFontScale = 0.43f;
#else
constexpr float kSymbolicMarkerFontScale = 0.69f;
#endif

class ListMarkerSink {
 public:
  virtual ~ListMarkerSink() = default;
  virtual void setListMarker(ListMarker marker) = 0;
  virtual const ListMarker &getListMarker() const = 0;
};

/*
 * The marker string for `ordinal` (1-based) in `type`, INCLUDING the trailing
 * separator a counter style carries — "1." rather than "1" — but not the gap
 * that follows it, which is spacing rather than content.
 *
 * Returns an empty string for `None`.
 */
std::string listMarkerText(ListStyleType type, int ordinal);

/* Whether `type` is a symbolic (geometric-glyph) style — see ListMarker::symbolic. */
bool isSymbolicListStyleType(ListStyleType type);

} // namespace facebook::react
