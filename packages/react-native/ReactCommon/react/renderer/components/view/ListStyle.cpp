/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ListStyle.h"

#include <array>
#include <cstdint>

namespace facebook::react {

namespace {

/*
 * Provenance of the tables below, because a wrong code point here is a wrong
 * glyph on screen that no test would obviously catch:
 *
 *  - the DIGIT SETS were read out of ICU rather than transcribed, by asking
 *    `Intl.NumberFormat('en-u-nu-<system>')` in Safari to format 1234567890
 *    and taking the code points of the result. Every one is a contiguous
 *    block, which is asserted here rather than assumed;
 *  - the ALPHABETS are the `symbols` descriptors from css-counter-styles-3
 *    §6.2, kept as the spec's own code points rather than pasted characters.
 */

/* Appends `codePoint` to `out` as UTF-8. */
void appendUtf8(std::string& out, char32_t codePoint) {
  if (codePoint < 0x80) {
    out += static_cast<char>(codePoint);
  } else if (codePoint < 0x800) {
    out += static_cast<char>(0xC0 | (codePoint >> 6));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  } else if (codePoint < 0x10000) {
    out += static_cast<char>(0xE0 | (codePoint >> 12));
    out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (codePoint >> 18));
    out += static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  }
}

/*
 * The `numeric` system (css-counter-styles-3 §3.1.4): ordinary positional
 * notation in the style's own digits. `zeroDigit` is the code point of its
 * "0"; every set below is ten consecutive code points from there.
 */
std::string numeric(int ordinal, char32_t zeroDigit) {
  std::string digits;
  const bool negative = ordinal < 0;
  // Taken as an unsigned magnitude so INT_MIN cannot overflow on negation.
  auto magnitude = negative ? static_cast<uint32_t>(-(int64_t)ordinal)
                            : static_cast<uint32_t>(ordinal);
  if (magnitude == 0) {
    appendUtf8(digits, zeroDigit);
  }
  while (magnitude > 0) {
    std::string digit;
    appendUtf8(digit, zeroDigit + (magnitude % 10));
    digits.insert(0, digit);
    magnitude /= 10;
  }
  if (negative) {
    digits.insert(0, "-");
  }
  return digits;
}

/* `cjk-decimal`'s digits are the only set that is not a contiguous block. */
constexpr std::array<char32_t, 10> kCjkDigits = {
    0x3007, // 〇
    0x4E00, // 一
    0x4E8C, // 二
    0x4E09, // 三
    0x56DB, // 四
    0x4E94, // 五
    0x516D, // 六
    0x4E03, // 七
    0x516B, // 八
    0x4E5D, // 九
};

std::string cjkDecimal(int ordinal) {
  if (ordinal < 0) {
    return numeric(ordinal, U'0');
  }
  std::string digits;
  auto magnitude = static_cast<uint32_t>(ordinal);
  if (magnitude == 0) {
    appendUtf8(digits, kCjkDigits[0]);
  }
  while (magnitude > 0) {
    std::string digit;
    appendUtf8(digit, kCjkDigits[magnitude % 10]);
    digits.insert(0, digit);
    magnitude /= 10;
  }
  return digits;
}

/*
 * The `alphabetic` system (§3.1.3): bijective base-N, so with 26 letters 26 is
 * "z" and 27 is "aa" rather than "a0".
 */
std::string alphabetic(int ordinal, const char32_t* symbols, size_t count) {
  if (ordinal <= 0) {
    // Below the system's range; a UA falls back to decimal.
    return std::to_string(ordinal);
  }
  std::string result;
  auto n = static_cast<uint32_t>(ordinal);
  while (n > 0) {
    const auto remainder = (n - 1) % count;
    std::string symbol;
    appendUtf8(symbol, symbols[remainder]);
    result.insert(0, symbol);
    n = (n - 1) / static_cast<uint32_t>(count);
  }
  return result;
}

// css-counter-styles-3 §6.2. Greek skips final sigma (U+03C2).
constexpr std::array<char32_t, 24> kLowerGreek = {
    0x3B1, 0x3B2, 0x3B3, 0x3B4, 0x3B5, 0x3B6, 0x3B7, 0x3B8,
    0x3B9, 0x3BA, 0x3BB, 0x3BC, 0x3BD, 0x3BE, 0x3BF, 0x3C0,
    0x3C1, 0x3C3, 0x3C4, 0x3C5, 0x3C6, 0x3C7, 0x3C8, 0x3C9};

constexpr std::array<char32_t, 48> kHiragana = {
    0x3042, 0x3044, 0x3046, 0x3048, 0x304A, 0x304B, 0x304D, 0x304F,
    0x3051, 0x3053, 0x3055, 0x3057, 0x3059, 0x305B, 0x305D, 0x305F,
    0x3061, 0x3064, 0x3066, 0x3068, 0x306A, 0x306B, 0x306C, 0x306D,
    0x306E, 0x306F, 0x3072, 0x3075, 0x3078, 0x307B, 0x307E, 0x307F,
    0x3080, 0x3081, 0x3082, 0x3084, 0x3086, 0x3088, 0x3089, 0x308A,
    0x308B, 0x308C, 0x308D, 0x308F, 0x3090, 0x3091, 0x3092, 0x3093};

constexpr std::array<char32_t, 47> kHiraganaIroha = {
    0x3044, 0x308D, 0x306F, 0x306B, 0x307B, 0x3078, 0x3068, 0x3061,
    0x308A, 0x306C, 0x308B, 0x3092, 0x308F, 0x304B, 0x3088, 0x305F,
    0x308C, 0x305D, 0x3064, 0x306D, 0x306A, 0x3089, 0x3080, 0x3046,
    0x3090, 0x306E, 0x304A, 0x304F, 0x3084, 0x307E, 0x3051, 0x3075,
    0x3053, 0x3048, 0x3066, 0x3042, 0x3055, 0x304D, 0x3086, 0x3081,
    0x307F, 0x3057, 0x3091, 0x3072, 0x3082, 0x305B, 0x3059};

constexpr std::array<char32_t, 48> kKatakana = {
    0x30A2, 0x30A4, 0x30A6, 0x30A8, 0x30AA, 0x30AB, 0x30AD, 0x30AF,
    0x30B1, 0x30B3, 0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD, 0x30BF,
    0x30C1, 0x30C4, 0x30C6, 0x30C8, 0x30CA, 0x30CB, 0x30CC, 0x30CD,
    0x30CE, 0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB, 0x30DE, 0x30DF,
    0x30E0, 0x30E1, 0x30E2, 0x30E4, 0x30E6, 0x30E8, 0x30E9, 0x30EA,
    0x30EB, 0x30EC, 0x30ED, 0x30EF, 0x30F0, 0x30F1, 0x30F2, 0x30F3};

constexpr std::array<char32_t, 47> kKatakanaIroha = {
    0x30A4, 0x30ED, 0x30CF, 0x30CB, 0x30DB, 0x30D8, 0x30C8, 0x30C1,
    0x30EA, 0x30CC, 0x30EB, 0x30F2, 0x30EF, 0x30AB, 0x30E8, 0x30BF,
    0x30EC, 0x30BD, 0x30C4, 0x30CD, 0x30CA, 0x30E9, 0x30E0, 0x30A6,
    0x30F0, 0x30CE, 0x30AA, 0x30AF, 0x30E4, 0x30DE, 0x30B1, 0x30D5,
    0x30B3, 0x30A8, 0x30C6, 0x30A2, 0x30B5, 0x30AD, 0x30E6, 0x30E1,
    0x30DF, 0x30B7, 0x30F1, 0x30D2, 0x30E2, 0x30BB, 0x30B9};

/* Bijective base-26 over ASCII, the shape `alphabetic` takes for latin. */
std::string latinAlphabetic(int ordinal, char base) {
  std::array<char32_t, 26> symbols{};
  for (size_t i = 0; i < symbols.size(); i++) {
    symbols[i] = static_cast<char32_t>(base) + static_cast<char32_t>(i);
  }
  return alphabetic(ordinal, symbols.data(), symbols.size());
}

/*
 * A weighted symbol of an `additive` counter style (css-counter-styles-3
 * §3.1.6): up to two code points, the second zero when unused.
 */
struct AdditiveSymbol {
  int weight;
  std::array<char32_t, 2> codePoints;
};

// `armenian`, range 1..9999: css-counter-styles-3 §6.4, generated from the
// spec's @counter-style rule
constexpr AdditiveSymbol kArmenian[] = {
    {9000, {0x0554}}, {8000, {0x0553}}, {7000, {0x0552}}, {6000, {0x0551}},
    {5000, {0x0550}}, {4000, {0x054F}}, {3000, {0x054E}}, {2000, {0x054D}},
    {1000, {0x054C}}, {900, {0x054B}},  {800, {0x054A}},  {700, {0x0549}},
    {600, {0x0548}},  {500, {0x0547}},  {400, {0x0546}},  {300, {0x0545}},
    {200, {0x0544}},  {100, {0x0543}},  {90, {0x0542}},   {80, {0x0541}},
    {70, {0x0540}},   {60, {0x053F}},   {50, {0x053E}},   {40, {0x053D}},
    {30, {0x053C}},   {20, {0x053B}},   {10, {0x053A}},   {9, {0x0539}},
    {8, {0x0538}},    {7, {0x0537}},    {6, {0x0536}},    {5, {0x0535}},
    {4, {0x0534}},    {3, {0x0533}},    {2, {0x0532}},    {1, {0x0531}},
};

// `lower-armenian`, range 1..9999: css-counter-styles-3 §6.4, generated from
// the spec's @counter-style rule
constexpr AdditiveSymbol kLowerArmenian[] = {
    {9000, {0x0584}}, {8000, {0x0583}}, {7000, {0x0582}}, {6000, {0x0581}},
    {5000, {0x0580}}, {4000, {0x057F}}, {3000, {0x057E}}, {2000, {0x057D}},
    {1000, {0x057C}}, {900, {0x057B}},  {800, {0x057A}},  {700, {0x0579}},
    {600, {0x0578}},  {500, {0x0577}},  {400, {0x0576}},  {300, {0x0575}},
    {200, {0x0574}},  {100, {0x0573}},  {90, {0x0572}},   {80, {0x0571}},
    {70, {0x0570}},   {60, {0x056F}},   {50, {0x056E}},   {40, {0x056D}},
    {30, {0x056C}},   {20, {0x056B}},   {10, {0x056A}},   {9, {0x0569}},
    {8, {0x0568}},    {7, {0x0567}},    {6, {0x0566}},    {5, {0x0565}},
    {4, {0x0564}},    {3, {0x0563}},    {2, {0x0562}},    {1, {0x0561}},
};

// `georgian`, range 1..19999: css-counter-styles-3 §6.4, generated from the
// spec's @counter-style rule
constexpr AdditiveSymbol kGeorgian[] = {
    {10000, {0x10F5}}, {9000, {0x10F0}}, {8000, {0x10EF}}, {7000, {0x10F4}},
    {6000, {0x10EE}},  {5000, {0x10ED}}, {4000, {0x10EC}}, {3000, {0x10EB}},
    {2000, {0x10EA}},  {1000, {0x10E9}}, {900, {0x10E8}},  {800, {0x10E7}},
    {700, {0x10E6}},   {600, {0x10E5}},  {500, {0x10E4}},  {400, {0x10F3}},
    {300, {0x10E2}},   {200, {0x10E1}},  {100, {0x10E0}},  {90, {0x10DF}},
    {80, {0x10DE}},    {70, {0x10DD}},   {60, {0x10F2}},   {50, {0x10DC}},
    {40, {0x10DB}},    {30, {0x10DA}},   {20, {0x10D9}},   {10, {0x10D8}},
    {9, {0x10D7}},     {8, {0x10F1}},    {7, {0x10D6}},    {6, {0x10D5}},
    {5, {0x10D4}},     {4, {0x10D3}},    {3, {0x10D2}},    {2, {0x10D1}},
    {1, {0x10D0}},
};

// `hebrew`, range 1..10999: css-counter-styles-3 §6.4, generated from the
// spec's @counter-style rule
constexpr AdditiveSymbol kHebrew[] = {
    {10000, {0x05D9, 0x05F3}},
    {9000, {0x05D8, 0x05F3}},
    {8000, {0x05D7, 0x05F3}},
    {7000, {0x05D6, 0x05F3}},
    {6000, {0x05D5, 0x05F3}},
    {5000, {0x05D4, 0x05F3}},
    {4000, {0x05D3, 0x05F3}},
    {3000, {0x05D2, 0x05F3}},
    {2000, {0x05D1, 0x05F3}},
    {1000, {0x05D0, 0x05F3}},
    {400, {0x05EA}},
    {300, {0x05E9}},
    {200, {0x05E8}},
    {100, {0x05E7}},
    {90, {0x05E6}},
    {80, {0x05E4}},
    {70, {0x05E2}},
    {60, {0x05E1}},
    {50, {0x05E0}},
    {40, {0x05DE}},
    {30, {0x05DC}},
    {20, {0x05DB}},
    {19, {0x05D9, 0x05D8}},
    {18, {0x05D9, 0x05D7}},
    {17, {0x05D9, 0x05D6}},
    {16, {0x05D8, 0x05D6}},
    {15, {0x05D8, 0x05D5}},
    {10, {0x05D9}},
    {9, {0x05D8}},
    {8, {0x05D7}},
    {7, {0x05D6}},
    {6, {0x05D5}},
    {5, {0x05D4}},
    {4, {0x05D3}},
    {3, {0x05D2}},
    {2, {0x05D1}},
    {1, {0x05D0}},
};

/*
 * The `additive` algorithm (css-counter-styles-3 §3.1.6): the largest symbols
 * first, each as many times as it fits. Outside the style's range, or when the
 * symbols cannot represent the value exactly, a UA falls back to decimal.
 */
template <size_t N>
std::string
additive(int ordinal, int rangeMax, const AdditiveSymbol (&symbols)[N]) {
  if (ordinal < 1 || ordinal > rangeMax) {
    return std::to_string(ordinal);
  }
  std::string result;
  int remaining = ordinal;
  for (const auto& symbol : symbols) {
    while (remaining >= symbol.weight) {
      for (char32_t codePoint : symbol.codePoints) {
        if (codePoint != 0) {
          appendUtf8(result, codePoint);
        }
      }
      remaining -= symbol.weight;
    }
  }
  return remaining == 0 ? result : std::to_string(ordinal);
}

/*
 * The additive Roman style (§6.4), including the subtractive pairs. Outside
 * 1..3999 a UA falls back to decimal, and so do we.
 */
std::string roman(int ordinal, bool upper) {
  if (ordinal <= 0 || ordinal > 3999) {
    return std::to_string(ordinal);
  }
  static constexpr int values[] = {
      1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1};
  static constexpr const char* upperSymbols[] = {
      "M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"};
  static constexpr const char* lowerSymbols[] = {
      "m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"};

  std::string result;
  for (size_t i = 0; i < sizeof(values) / sizeof(values[0]); i++) {
    while (ordinal >= values[i]) {
      result += upper ? upperSymbols[i] : lowerSymbols[i];
      ordinal -= values[i];
    }
  }
  return result;
}

/*
 * The code point of a numeric style's "0". Ten consecutive code points from
 * here are its digits — read out of ICU, not transcribed.
 */
char32_t zeroDigitFor(ListStyleType type) {
  switch (type) {
    case ListStyleType::ArabicIndic:
      return 0x0660;
    case ListStyleType::Bengali:
      return 0x09E6;
    case ListStyleType::Cambodian:
      return 0x17E0;
    case ListStyleType::Devanagari:
      return 0x0966;
    case ListStyleType::Gujarati:
      return 0x0AE6;
    case ListStyleType::Gurmukhi:
      return 0x0A66;
    case ListStyleType::Kannada:
      return 0x0CE6;
    case ListStyleType::Lao:
      return 0x0ED0;
    case ListStyleType::Malayalam:
      return 0x0D66;
    case ListStyleType::Mongolian:
      return 0x1810;
    case ListStyleType::Myanmar:
      return 0x1040;
    case ListStyleType::Oriya:
      return 0x0B66;
    case ListStyleType::Persian:
      return 0x06F0;
    case ListStyleType::Tamil:
      return 0x0BE6;
    case ListStyleType::Telugu:
      return 0x0C66;
    case ListStyleType::Thai:
      return 0x0E50;
    case ListStyleType::Tibetan:
      return 0x0F20;
    default:
      return U'0';
  }
}

/*
 * The separator a counter style puts after its counter. The CJK and kana
 * styles use an ideographic comma; everything else uses a full stop.
 */
const char* suffixFor(ListStyleType type) {
  switch (type) {
    case ListStyleType::CjkDecimal:
    case ListStyleType::Hiragana:
    case ListStyleType::HiraganaIroha:
    case ListStyleType::Katakana:
    case ListStyleType::KatakanaIroha:
      return reinterpret_cast<const char*>(u8"、"); // IDEOGRAPHIC COMMA
    default:
      return ".";
  }
}

} // namespace

ListStyleType listStyleTypeFromString(
    const std::string& value,
    ListStyleType fallback) {
  // Symbolic (§6.3).
  if (value == "none") {
    return ListStyleType::None;
  }
  if (value == "disc") {
    return ListStyleType::Disc;
  }
  if (value == "circle") {
    return ListStyleType::Circle;
  }
  if (value == "square") {
    return ListStyleType::Square;
  }
  if (value == "disclosure-open") {
    return ListStyleType::DisclosureOpen;
  }
  if (value == "disclosure-closed") {
    return ListStyleType::DisclosureClosed;
  }

  // Numeric (§6.1).
  if (value == "decimal") {
    return ListStyleType::Decimal;
  }
  if (value == "decimal-leading-zero") {
    return ListStyleType::DecimalLeadingZero;
  }
  if (value == "arabic-indic") {
    return ListStyleType::ArabicIndic;
  }
  if (value == "bengali") {
    return ListStyleType::Bengali;
  }
  // `khmer` is the same style under its script's name.
  if (value == "cambodian" || value == "khmer") {
    return ListStyleType::Cambodian;
  }
  if (value == "cjk-decimal") {
    return ListStyleType::CjkDecimal;
  }
  if (value == "devanagari") {
    return ListStyleType::Devanagari;
  }
  if (value == "gujarati") {
    return ListStyleType::Gujarati;
  }
  if (value == "gurmukhi") {
    return ListStyleType::Gurmukhi;
  }
  if (value == "kannada") {
    return ListStyleType::Kannada;
  }
  if (value == "lao") {
    return ListStyleType::Lao;
  }
  if (value == "malayalam") {
    return ListStyleType::Malayalam;
  }
  if (value == "mongolian") {
    return ListStyleType::Mongolian;
  }
  if (value == "myanmar") {
    return ListStyleType::Myanmar;
  }
  if (value == "oriya") {
    return ListStyleType::Oriya;
  }
  if (value == "persian") {
    return ListStyleType::Persian;
  }
  if (value == "tamil") {
    return ListStyleType::Tamil;
  }
  if (value == "telugu") {
    return ListStyleType::Telugu;
  }
  if (value == "thai") {
    return ListStyleType::Thai;
  }
  if (value == "tibetan") {
    return ListStyleType::Tibetan;
  }

  // Alphabetic (§6.2).
  if (value == "lower-alpha" || value == "lower-latin") {
    return ListStyleType::LowerAlpha;
  }
  if (value == "upper-alpha" || value == "upper-latin") {
    return ListStyleType::UpperAlpha;
  }
  if (value == "lower-greek") {
    return ListStyleType::LowerGreek;
  }
  if (value == "hiragana") {
    return ListStyleType::Hiragana;
  }
  if (value == "hiragana-iroha") {
    return ListStyleType::HiraganaIroha;
  }
  if (value == "katakana") {
    return ListStyleType::Katakana;
  }
  if (value == "katakana-iroha") {
    return ListStyleType::KatakanaIroha;
  }

  // Additive (§6.4).
  if (value == "lower-roman") {
    return ListStyleType::LowerRoman;
  }
  if (value == "upper-roman") {
    return ListStyleType::UpperRoman;
  }
  if (value == "armenian" || value == "upper-armenian") {
    return ListStyleType::Armenian;
  }
  if (value == "lower-armenian") {
    return ListStyleType::LowerArmenian;
  }
  if (value == "georgian") {
    return ListStyleType::Georgian;
  }
  if (value == "hebrew") {
    return ListStyleType::Hebrew;
  }
  return fallback;
}

ListStylePosition listStylePositionFromString(
    const std::string& value,
    ListStylePosition fallback) {
  if (value == "inside") {
    return ListStylePosition::Inside;
  }
  if (value == "outside") {
    return ListStylePosition::Outside;
  }
  return fallback;
}

ListStyleType nestedBulletForDepth(int depth) {
  switch (depth % 3) {
    case 0:
      return ListStyleType::Disc;
    case 1:
      return ListStyleType::Circle;
    default:
      return ListStyleType::Square;
  }
}

bool isSymbolicListStyleType(ListStyleType type) {
  switch (type) {
    case ListStyleType::Disc:
    case ListStyleType::Circle:
    case ListStyleType::Square:
    case ListStyleType::DisclosureOpen:
    case ListStyleType::DisclosureClosed:
      return true;
    default:
      return false;
  }
}

std::string listMarkerText(ListStyleType type, int ordinal) {
  switch (type) {
    case ListStyleType::None:
      return {};

    // The glyphs a UA uses for the symbolic styles. No counter, no suffix.
    // Geometric symbols carry VARIATION SELECTOR-15 (U+FE0E, text
    // presentation): several of them — U+25AA in particular — are
    // emoji-capable, and Apple's fallback picks the EMOJI face for a bare
    // code point, which rendered every third-level `square` bullet as a big
    // black rounded emoji square instead of a small text glyph.
    case ListStyleType::Disc:
      return reinterpret_cast<const char*>(u8"●︎"); // BLACK CIRCLE
    case ListStyleType::Circle:
      return reinterpret_cast<const char*>(u8"○︎"); // WHITE CIRCLE
    case ListStyleType::Square:
      return reinterpret_cast<const char*>(u8"■︎"); // BLACK SQUARE
    case ListStyleType::DisclosureOpen:
      // BLACK DOWN-POINTING SMALL TRIANGLE
      return reinterpret_cast<const char*>(u8"▾︎");
    case ListStyleType::DisclosureClosed:
      // BLACK RIGHT-POINTING SMALL TRIANGLE
      return reinterpret_cast<const char*>(u8"▸︎");

    // Counter styles carry the separator their definition specifies.
    case ListStyleType::Decimal:
      return std::to_string(ordinal) + suffixFor(type);
    case ListStyleType::DecimalLeadingZero: {
      // One leading zero, so the style's own range 1..9 is two digits wide;
      // above that it is plain decimal (css-counter-styles-3 §6.1).
      auto digits = std::to_string(ordinal);
      if (ordinal >= 0 && ordinal < 10) {
        digits.insert(0, "0");
      }
      return digits + suffixFor(type);
    }
    case ListStyleType::CjkDecimal:
      return cjkDecimal(ordinal) + suffixFor(type);
    case ListStyleType::ArabicIndic:
    case ListStyleType::Bengali:
    case ListStyleType::Cambodian:
    case ListStyleType::Devanagari:
    case ListStyleType::Gujarati:
    case ListStyleType::Gurmukhi:
    case ListStyleType::Kannada:
    case ListStyleType::Lao:
    case ListStyleType::Malayalam:
    case ListStyleType::Mongolian:
    case ListStyleType::Myanmar:
    case ListStyleType::Oriya:
    case ListStyleType::Persian:
    case ListStyleType::Tamil:
    case ListStyleType::Telugu:
    case ListStyleType::Thai:
    case ListStyleType::Tibetan:
      return numeric(ordinal, zeroDigitFor(type)) + suffixFor(type);

    case ListStyleType::LowerAlpha:
      return latinAlphabetic(ordinal, 'a') + suffixFor(type);
    case ListStyleType::UpperAlpha:
      return latinAlphabetic(ordinal, 'A') + suffixFor(type);
    case ListStyleType::LowerGreek:
      return alphabetic(ordinal, kLowerGreek.data(), kLowerGreek.size()) +
          suffixFor(type);
    case ListStyleType::Hiragana:
      return alphabetic(ordinal, kHiragana.data(), kHiragana.size()) +
          suffixFor(type);
    case ListStyleType::HiraganaIroha:
      return alphabetic(ordinal, kHiraganaIroha.data(), kHiraganaIroha.size()) +
          suffixFor(type);
    case ListStyleType::Katakana:
      return alphabetic(ordinal, kKatakana.data(), kKatakana.size()) +
          suffixFor(type);
    case ListStyleType::KatakanaIroha:
      return alphabetic(ordinal, kKatakanaIroha.data(), kKatakanaIroha.size()) +
          suffixFor(type);

    case ListStyleType::LowerRoman:
      return roman(ordinal, false) + suffixFor(type);
    case ListStyleType::UpperRoman:
      return roman(ordinal, true) + suffixFor(type);
    case ListStyleType::Armenian:
      return additive(ordinal, 9999, kArmenian) + suffixFor(type);
    case ListStyleType::LowerArmenian:
      return additive(ordinal, 9999, kLowerArmenian) + suffixFor(type);
    case ListStyleType::Georgian:
      return additive(ordinal, 19999, kGeorgian) + suffixFor(type);
    case ListStyleType::Hebrew:
      return additive(ordinal, 10999, kHebrew) + suffixFor(type);
  }
  return {};
}

} // namespace facebook::react
