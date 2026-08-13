/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <gtest/gtest.h>

#include <react/renderer/components/view/ListStyle.h>

namespace facebook::react {

namespace {
std::string marker(const char* keyword, int ordinal) {
  return listMarkerText(
      listStyleTypeFromString(keyword, ListStyleType::Decimal), ordinal);
}
} // namespace

/*
 * The counter styles of css-counter-styles-3 §6, asserted as exact strings
 * because the failure mode is a plausible-looking wrong glyph.
 *
 * The symbol tables themselves are not guesses: the digit sets were read out
 * of ICU (`Intl.NumberFormat('en-u-nu-<system>')`) rather than transcribed,
 * and the alphabets are the spec's own `symbols` code points. What these
 * assertions pin is the three algorithms over them.
 */

TEST(ListStyleTest, numeric_counts_in_the_styles_own_digits) {
  EXPECT_EQ(marker("decimal", 1), "1.");
  EXPECT_EQ(marker("decimal", 3999), "3999.");

  // Positional, so the tens place uses the same set as the units place.
  EXPECT_EQ(marker("arabic-indic", 1), "١.");
  EXPECT_EQ(marker("arabic-indic", 10), "١٠.");
  EXPECT_EQ(marker("persian", 5), "۵.");
  EXPECT_EQ(marker("devanagari", 27), "२७.");
  EXPECT_EQ(marker("thai", 100), "๑๐๐.");
  EXPECT_EQ(marker("tibetan", 9), "༩.");

  // `khmer` is the same style under its script's name.
  EXPECT_EQ(marker("khmer", 1), marker("cambodian", 1));
  EXPECT_EQ(marker("khmer", 1), "១.");
}

TEST(ListStyleTest, decimal_leading_zero_pads_only_its_own_range) {
  EXPECT_EQ(marker("decimal-leading-zero", 1), "01.");
  EXPECT_EQ(marker("decimal-leading-zero", 9), "09.");
  EXPECT_EQ(marker("decimal-leading-zero", 10), "10.");
  EXPECT_EQ(marker("decimal-leading-zero", 100), "100.");
}

TEST(ListStyleTest, cjk_decimal_uses_its_own_digits_and_suffix) {
  // The one digit set that is not a contiguous Unicode block, and one of the
  // styles whose separator is an ideographic comma rather than a full stop.
  EXPECT_EQ(marker("cjk-decimal", 1), "一、");
  EXPECT_EQ(marker("cjk-decimal", 10), "一〇、");
  EXPECT_EQ(marker("cjk-decimal", 205), "二〇五、");
}

TEST(ListStyleTest, alphabetic_is_bijective) {
  // The symbol after the last one is the FIRST one doubled — "aa", never "a0".
  EXPECT_EQ(marker("lower-alpha", 1), "a.");
  EXPECT_EQ(marker("lower-alpha", 26), "z.");
  EXPECT_EQ(marker("lower-alpha", 27), "aa.");
  EXPECT_EQ(marker("lower-alpha", 703), "aaa.");
  EXPECT_EQ(marker("upper-latin", 27), "AA.");

  // Greek is 24 letters: final sigma (ς) is not one of them, so 18 is σ.
  EXPECT_EQ(marker("lower-greek", 1), "α.");
  EXPECT_EQ(marker("lower-greek", 18), "σ.");
  EXPECT_EQ(marker("lower-greek", 24), "ω.");
  EXPECT_EQ(marker("lower-greek", 25), "αα.");

  // The kana orderings are different sequences of the same syllabary, so the
  // first symbol is what tells them apart.
  EXPECT_EQ(marker("hiragana", 1), "あ、");
  EXPECT_EQ(marker("hiragana", 48), "ん、");
  EXPECT_EQ(marker("hiragana", 49), "ああ、");
  EXPECT_EQ(marker("hiragana-iroha", 1), "い、");
  EXPECT_EQ(marker("hiragana-iroha", 47), "す、");
  EXPECT_EQ(marker("hiragana-iroha", 48), "いい、");
  EXPECT_EQ(marker("katakana", 1), "ア、");
  EXPECT_EQ(marker("katakana-iroha", 1), "イ、");
}

TEST(ListStyleTest, roman_uses_subtractive_pairs_and_falls_back_out_of_range) {
  EXPECT_EQ(marker("lower-roman", 4), "iv.");
  EXPECT_EQ(marker("upper-roman", 1990), "MCMXC.");
  // Roman's range is 1..3999; outside it a UA falls back to decimal.
  EXPECT_EQ(marker("upper-roman", 4000), "4000.");
}

TEST(ListStyleTest, symbolic_styles_are_a_glyph_with_no_counter) {
  EXPECT_EQ(marker("disc", 7), "•");
  EXPECT_EQ(marker("circle", 7), "◦");
  EXPECT_EQ(marker("square", 7), "▪");
  EXPECT_EQ(marker("disclosure-open", 7), "▾");
  EXPECT_EQ(marker("disclosure-closed", 7), "▸");
  EXPECT_EQ(marker("none", 7), "");
}

TEST(ListStyleTest, an_unimplemented_style_falls_back_rather_than_failing) {
  // The complex predefined styles of §7 are not modelled; a UA renders an
  // unknown `list-style-type` with the fallback style rather than nothing.
  EXPECT_EQ(marker("ethiopic-numeric", 3), "3.");
  EXPECT_EQ(marker("hebrew", 3), "3.");
}

TEST(ListStyleTest, nested_bullets_cycle_with_depth) {
  EXPECT_EQ(nestedBulletForDepth(0), ListStyleType::Disc);
  EXPECT_EQ(nestedBulletForDepth(1), ListStyleType::Circle);
  EXPECT_EQ(nestedBulletForDepth(2), ListStyleType::Square);
  EXPECT_EQ(nestedBulletForDepth(3), ListStyleType::Disc);
}

} // namespace facebook::react
