/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/style/GridAutoRepeat.h>
#include <yoga/style/GridLine.h>
#include <yoga/style/GridTrack.h>
#include <yoga/style/StyleSizeLength.h>

#include <cctype>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

namespace facebook::react {

/*
 * Parses the CSS `<track-list>` grammar for `grid-template-columns` and
 * `grid-template-rows`, and `<grid-line>` for the placement properties.
 *
 *   <track-list>    = <track-item>+
 *   <track-item>    = <track-size> | repeat( <count> , <track-size>+ )
 *   <count>         = <integer> | auto-fill | auto-fit
 *   <track-size>    = <breadth> | minmax( <breadth> , <breadth> )
 *                   | fit-content( <length-percentage> )
 *   <breadth>       = <length> | <percentage> | <flex> | auto
 *                   | min-content | max-content
 *
 * A focused recursive-descent parser rather than the generic css-syntax-3
 * parser in react/renderer/css: that one has no `fr` unit, and the grammar
 * here is small enough that a direct parser is easier to read and to test
 * than the template machinery would be.
 *
 * Values that do not parse are skipped rather than aborting the whole list,
 * matching how the rest of RN's style parsing degrades.
 */

struct ParsedGridTrackList {
  yoga::GridTrackList tracks{};
  yoga::GridAutoRepeat autoRepeat{};
};

namespace detail {

struct GridTrackScanner {
  std::string_view input;
  size_t pos{0};

  void skipWhitespace() {
    while (pos < input.size() &&
           (std::isspace(static_cast<unsigned char>(input[pos])) != 0 ||
            input[pos] == ',')) {
      pos++;
    }
  }

  bool done() {
    skipWhitespace();
    return pos >= input.size();
  }

  // The next bare token: an identifier, a number with an optional unit, or a
  // single punctuation character.
  std::string_view peekToken() {
    skipWhitespace();
    if (pos >= input.size()) {
      return {};
    }
    const size_t start = pos;
    size_t end = pos;
    if (input[end] == '(' || input[end] == ')') {
      return input.substr(start, 1);
    }
    while (end < input.size() && input[end] != '(' && input[end] != ')' &&
           input[end] != ',' &&
           std::isspace(static_cast<unsigned char>(input[end])) == 0) {
      end++;
    }
    return input.substr(start, end - start);
  }

  std::string_view nextToken() {
    const auto token = peekToken();
    pos += token.size();
    return token;
  }

  // Consumes a balanced parenthesised block, returning its contents.
  std::string_view consumeBlock() {
    skipWhitespace();
    if (pos >= input.size() || input[pos] != '(') {
      return {};
    }
    const size_t start = ++pos;
    int depth = 1;
    while (pos < input.size() && depth > 0) {
      if (input[pos] == '(') {
        depth++;
      } else if (input[pos] == ')') {
        depth--;
        if (depth == 0) {
          break;
        }
      }
      pos++;
    }
    const auto contents = input.substr(start, pos - start);
    if (pos < input.size()) {
      pos++; // the closing paren
    }
    return contents;
  }
};

inline bool equalsIgnoreCase(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (size_t i = 0; i < a.size(); i++) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

// A single <track-breadth>: a length, percentage, flex factor, or keyword.
inline bool parseBreadth(std::string_view token, yoga::StyleSizeLength& out) {
  if (token.empty()) {
    return false;
  }
  if (equalsIgnoreCase(token, "auto")) {
    out = yoga::StyleSizeLength::ofAuto();
    return true;
  }
  if (equalsIgnoreCase(token, "max-content")) {
    out = yoga::StyleSizeLength::ofMaxContent();
    return true;
  }
  if (equalsIgnoreCase(token, "min-content")) {
    // Yoga has no distinct min-content sizing function. Its `auto` minimum is
    // the automatic minimum size, which is min-content for a non-scrollable
    // box — the closest available and correct for the common case.
    // DOM-CSS-LIMITATION(grid-min-content): a min-content MAXIMUM is not
    // distinguishable from auto.
    out = yoga::StyleSizeLength::ofAuto();
    return true;
  }

  const std::string text{token};
  char* unitStart = nullptr;
  const float value = std::strtof(text.c_str(), &unitStart);
  if (unitStart == text.c_str()) {
    return false; // no number at all
  }
  const std::string_view unit{unitStart};
  if (unit.empty() || equalsIgnoreCase(unit, "px")) {
    out = yoga::StyleSizeLength::points(value);
    return true;
  }
  if (unit == "%") {
    out = yoga::StyleSizeLength::percent(value);
    return true;
  }
  if (equalsIgnoreCase(unit, "fr")) {
    // A flex factor is a MAXIMUM sizing function; the caller pairs it with an
    // auto minimum (css-grid-2 §7.2.3).
    out = yoga::StyleSizeLength::stretch(value);
    return true;
  }
  return false;
}

// One <track-size>, which may be a function.
inline bool parseTrackSize(GridTrackScanner& scanner, yoga::GridTrackSize& out) {
  const auto token = scanner.peekToken();
  if (token.empty()) {
    return false;
  }

  if (equalsIgnoreCase(token, "minmax")) {
    scanner.nextToken();
    const auto contents = scanner.consumeBlock();
    GridTrackScanner inner{contents, 0};
    yoga::StyleSizeLength min{};
    yoga::StyleSizeLength max{};
    if (!parseBreadth(inner.nextToken(), min) ||
        !parseBreadth(inner.nextToken(), max)) {
      return false;
    }
    // An `fr` minimum is invalid CSS; treat it as auto rather than dropping
    // the whole declaration.
    if (min.isStretch()) {
      min = yoga::StyleSizeLength::ofAuto();
    }
    out = yoga::GridTrackSize::minmax(min, max);
    return true;
  }

  if (equalsIgnoreCase(token, "fit-content")) {
    scanner.nextToken();
    const auto contents = scanner.consumeBlock();
    GridTrackScanner inner{contents, 0};
    yoga::StyleSizeLength limit{};
    if (!parseBreadth(inner.nextToken(), limit)) {
      return false;
    }
    (void)limit;
    // DOM-CSS-LIMITATION(grid-fit-content-limit): `fit-content(x)` is
    // `max(min-content, min(max-content, x))`. Yoga's FitContent sizing
    // function has no argument, so the max-content clamp is honoured and the
    // `x` ceiling is dropped.
    //
    // Mapping to `minmax(auto, x)` instead would keep the ceiling but lose the
    // max-content clamp, which is worse: the track would then grow to `x`
    // whenever there is free space, even for content far narrower than that,
    // which is the visible half of the behaviour.
    //
    // The ceiling only ever binds when min-content < x < max-content, i.e. for
    // content that can reflow. It is not reachable for a fixed-size box, which
    // is why the conformance corpus cannot catch this one.
    out = yoga::GridTrackSize{
        .minSizingFunction = yoga::StyleSizeLength::ofAuto(),
        .maxSizingFunction = yoga::StyleSizeLength::ofFitContent()};
    return true;
  }

  scanner.nextToken();
  yoga::StyleSizeLength breadth{};
  if (!parseBreadth(token, breadth)) {
    return false;
  }
  if (breadth.isStretch() || breadth.isMaxContent() || breadth.isFitContent()) {
    // <flex> is a maximum with an auto minimum by definition. `max-content`
    // and `fit-content` are written here the same way: CSS says a lone
    // <track-breadth> becomes both the minimum and the maximum, but Yoga has
    // no max-content MINIMUM — a track given one sizes to zero. Its `auto`
    // minimum is the automatic minimum size, which is what the intrinsic
    // minimum means for a non-scrollable box, so this is the same track with a
    // representable floor.
    out = yoga::GridTrackSize::minmax(yoga::StyleSizeLength::ofAuto(), breadth);
  } else {
    out = yoga::GridTrackSize{
        .minSizingFunction = breadth, .maxSizingFunction = breadth};
  }
  return true;
}

} // namespace detail

inline ParsedGridTrackList parseGridTrackList(std::string_view source) {
  ParsedGridTrackList result;
  detail::GridTrackScanner scanner{source, 0};

  if (detail::equalsIgnoreCase(source, "none")) {
    return result;
  }

  while (!scanner.done()) {
    const auto token = scanner.peekToken();
    if (token.empty()) {
      break;
    }

    if (detail::equalsIgnoreCase(token, "repeat")) {
      scanner.nextToken();
      const auto contents = scanner.consumeBlock();
      detail::GridTrackScanner inner{contents, 0};
      const auto countToken = inner.nextToken();

      // The pattern being repeated, parsed once.
      std::vector<yoga::GridTrackSize> pattern;
      while (!inner.done()) {
        yoga::GridTrackSize track{};
        if (!detail::parseTrackSize(inner, track)) {
          break;
        }
        pattern.push_back(track);
      }
      if (pattern.empty()) {
        continue;
      }

      const bool isAutoFill = detail::equalsIgnoreCase(countToken, "auto-fill");
      const bool isAutoFit = detail::equalsIgnoreCase(countToken, "auto-fit");
      if (isAutoFill || isAutoFit) {
        // At most one auto-repeat per track list; a second is ignored.
        if (result.autoRepeat.isAuto()) {
          continue;
        }
        result.autoRepeat = yoga::GridAutoRepeat{
            isAutoFit ? yoga::GridAutoRepeatType::AutoFit
                      : yoga::GridAutoRepeatType::AutoFill,
            static_cast<uint16_t>(result.tracks.size()),
            static_cast<uint16_t>(pattern.size())};
        for (const auto& track : pattern) {
          result.tracks.push_back(track);
        }
      } else {
        // An integer repeat expands right here — nothing about it depends on
        // the container size.
        const std::string countText{countToken};
        const long count = std::strtol(countText.c_str(), nullptr, 10);
        for (long i = 0; i < count && i < 10000; i++) {
          for (const auto& track : pattern) {
            result.tracks.push_back(track);
          }
        }
      }
      continue;
    }

    yoga::GridTrackSize track{};
    if (!detail::parseTrackSize(scanner, track)) {
      // Unparseable component: skip it rather than dropping the whole list.
      scanner.nextToken();
      continue;
    }
    result.tracks.push_back(track);
  }

  return result;
}

/*
 * `<grid-line>`: `auto`, an integer line (which may be negative), or
 * `span <integer>`.
 */
inline yoga::GridLine parseGridLine(std::string_view source) {
  detail::GridTrackScanner scanner{source, 0};
  auto token = scanner.nextToken();
  if (token.empty() || detail::equalsIgnoreCase(token, "auto")) {
    return yoga::GridLine::auto_();
  }
  if (detail::equalsIgnoreCase(token, "span")) {
    const auto spanToken = scanner.nextToken();
    const std::string spanText{spanToken};
    const long span = std::strtol(spanText.c_str(), nullptr, 10);
    // css-grid-1 §8.3: a span of zero or less is invalid and clamps to 1.
    return yoga::GridLine::span(
        static_cast<int32_t>(span < 1 ? 1 : span));
  }
  const std::string lineText{token};
  char* end = nullptr;
  const long line = std::strtol(lineText.c_str(), &end, 10);
  if (end == lineText.c_str()) {
    return yoga::GridLine::auto_();
  }
  // Line 0 is invalid and is treated as auto.
  if (line == 0) {
    return yoga::GridLine::auto_();
  }
  return yoga::GridLine::fromInteger(static_cast<int32_t>(line));
}

} // namespace facebook::react
