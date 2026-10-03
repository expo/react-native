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
  // Each glyph carries U+FE0E, which asks for its text presentation rather
  // than an emoji one
  EXPECT_EQ(marker("disc", 7), "\u25CF\uFE0E");
  EXPECT_EQ(marker("circle", 7), "\u25CB\uFE0E");
  EXPECT_EQ(marker("square", 7), "\u25A0\uFE0E");
  EXPECT_EQ(marker("disclosure-open", 7), "\u25BE\uFE0E");
  EXPECT_EQ(marker("disclosure-closed", 7), "\u25B8\uFE0E");
  EXPECT_EQ(marker("none", 7), "");
}

TEST(ListStyleTest, an_unimplemented_style_falls_back_rather_than_failing) {
  // The complex predefined styles of §7 are not modelled; a UA renders an
  // unknown `list-style-type` with the fallback style rather than nothing.
  EXPECT_EQ(marker("ethiopic-numeric", 3), "3.");
}

// Every ordinal in the Web Platform Tests' `css/css-counter-styles/armenian`,
// `georgian` and `hebrew` cases, with the text those tests expect, which is a
// second source for the tables generated from the spec
TEST(ListStyleTest, additive_scripts_match_the_web_platform_tests) {
  EXPECT_EQ(marker("armenian", 10), "Ժ.");
  EXPECT_EQ(marker("armenian", 11), "ԺԱ.");
  EXPECT_EQ(marker("armenian", 12), "ԺԲ.");
  EXPECT_EQ(marker("armenian", 43), "ԽԳ.");
  EXPECT_EQ(marker("armenian", 77), "ՀԷ.");
  EXPECT_EQ(marker("armenian", 80), "Ձ.");
  EXPECT_EQ(marker("armenian", 99), "ՂԹ.");
  EXPECT_EQ(marker("armenian", 100), "Ճ.");
  EXPECT_EQ(marker("armenian", 101), "ՃԱ.");
  EXPECT_EQ(marker("armenian", 222), "ՄԻԲ.");
  EXPECT_EQ(marker("armenian", 540), "ՇԽ.");
  EXPECT_EQ(marker("armenian", 999), "ՋՂԹ.");
  EXPECT_EQ(marker("armenian", 1000), "Ռ.");
  EXPECT_EQ(marker("armenian", 1005), "ՌԵ.");
  EXPECT_EQ(marker("armenian", 1060), "ՌԿ.");
  EXPECT_EQ(marker("armenian", 1065), "ՌԿԵ.");
  EXPECT_EQ(marker("armenian", 1800), "ՌՊ.");
  EXPECT_EQ(marker("armenian", 1860), "ՌՊԿ.");
  EXPECT_EQ(marker("armenian", 1865), "ՌՊԿԵ.");
  EXPECT_EQ(marker("armenian", 5865), "ՐՊԿԵ.");
  EXPECT_EQ(marker("armenian", 7005), "ՒԵ.");
  EXPECT_EQ(marker("armenian", 7800), "ՒՊ.");
  EXPECT_EQ(marker("armenian", 7865), "ՒՊԿԵ.");
  EXPECT_EQ(marker("armenian", 9999), "ՔՋՂԹ.");
  EXPECT_EQ(marker("armenian", 9999), "ՔՋՂԹ.");
  EXPECT_EQ(marker("armenian", 10000), "10000.");
  EXPECT_EQ(marker("armenian", 10001), "10001.");
  EXPECT_EQ(marker("georgian", 10), "ი.");
  EXPECT_EQ(marker("georgian", 11), "ია.");
  EXPECT_EQ(marker("georgian", 12), "იბ.");
  EXPECT_EQ(marker("georgian", 43), "მგ.");
  EXPECT_EQ(marker("georgian", 77), "ოზ.");
  EXPECT_EQ(marker("georgian", 80), "პ.");
  EXPECT_EQ(marker("georgian", 99), "ჟთ.");
  EXPECT_EQ(marker("georgian", 100), "რ.");
  EXPECT_EQ(marker("georgian", 101), "რა.");
  EXPECT_EQ(marker("georgian", 222), "სკბ.");
  EXPECT_EQ(marker("georgian", 540), "ფმ.");
  EXPECT_EQ(marker("georgian", 999), "შჟთ.");
  EXPECT_EQ(marker("georgian", 1000), "ჩ.");
  EXPECT_EQ(marker("georgian", 1005), "ჩე.");
  EXPECT_EQ(marker("georgian", 1060), "ჩჲ.");
  EXPECT_EQ(marker("georgian", 1065), "ჩჲე.");
  EXPECT_EQ(marker("georgian", 1800), "ჩყ.");
  EXPECT_EQ(marker("georgian", 1860), "ჩყჲ.");
  EXPECT_EQ(marker("georgian", 1865), "ჩყჲე.");
  EXPECT_EQ(marker("georgian", 5865), "ჭყჲე.");
  EXPECT_EQ(marker("georgian", 7005), "ჴე.");
  EXPECT_EQ(marker("georgian", 7800), "ჴყ.");
  EXPECT_EQ(marker("georgian", 7865), "ჴყჲე.");
  EXPECT_EQ(marker("georgian", 9999), "ჰშჟთ.");
  EXPECT_EQ(marker("georgian", 10000), "ჵ.");
  EXPECT_EQ(marker("georgian", 10001), "ჵა.");
  EXPECT_EQ(marker("georgian", 19999), "ჵჰშჟთ.");
  EXPECT_EQ(marker("georgian", 1), "ა.");
  EXPECT_EQ(marker("georgian", 2), "ბ.");
  EXPECT_EQ(marker("hebrew", 10), "י.");
  EXPECT_EQ(marker("hebrew", 11), "יא.");
  EXPECT_EQ(marker("hebrew", 12), "יב.");
  EXPECT_EQ(marker("hebrew", 13), "יג.");
  EXPECT_EQ(marker("hebrew", 14), "יד.");
  EXPECT_EQ(marker("hebrew", 15), "טו.");
  EXPECT_EQ(marker("hebrew", 16), "טז.");
  EXPECT_EQ(marker("hebrew", 17), "יז.");
  EXPECT_EQ(marker("hebrew", 18), "יח.");
  EXPECT_EQ(marker("hebrew", 43), "מג.");
  EXPECT_EQ(marker("hebrew", 77), "עז.");
  EXPECT_EQ(marker("hebrew", 80), "פ.");
  EXPECT_EQ(marker("hebrew", 99), "צט.");
  EXPECT_EQ(marker("hebrew", 100), "ק.");
  EXPECT_EQ(marker("hebrew", 101), "קא.");
  EXPECT_EQ(marker("hebrew", 222), "רכב.");
  EXPECT_EQ(marker("hebrew", 400), "ת.");
  EXPECT_EQ(marker("hebrew", 401), "תא.");
  EXPECT_EQ(marker("hebrew", 499), "תצט.");
  EXPECT_EQ(marker("hebrew", 500), "תק.");
  EXPECT_EQ(marker("hebrew", 555), "תקנה.");
  EXPECT_EQ(marker("hebrew", 997), "תתקצז.");
  EXPECT_EQ(marker("hebrew", 1000), "א׳.");
  EXPECT_EQ(marker("hebrew", 1001), "א׳א.");
  EXPECT_EQ(marker("hebrew", 3256), "ג׳רנו.");
  EXPECT_EQ(marker("hebrew", 7998), "ז׳תתקצח.");
  EXPECT_EQ(marker("hebrew", 9999), "ט׳תתקצט.");
  EXPECT_EQ(marker("hebrew", 10000), "י׳.");
  EXPECT_EQ(marker("hebrew", 10997), "י׳תתקצז.");
  EXPECT_EQ(marker("hebrew", 10999), "י׳תתקצט.");
  EXPECT_EQ(marker("upper-armenian", 1865), marker("armenian", 1865));
  EXPECT_EQ(marker("lower-armenian", 1), "ա.");
}

TEST(ListStyleTest, nested_bullets_cycle_with_depth) {
  EXPECT_EQ(nestedBulletForDepth(0), ListStyleType::Disc);
  EXPECT_EQ(nestedBulletForDepth(1), ListStyleType::Circle);
  EXPECT_EQ(nestedBulletForDepth(2), ListStyleType::Square);
  EXPECT_EQ(nestedBulletForDepth(3), ListStyleType::Disc);
}

} // namespace facebook::react
