/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string_view>
#include <vector>

namespace facebook::react::cssengine {

/*
 * What a media or container query is asked about: the box it is about (the
 * viewport, or the container), the viewport its viewport units read, and the
 * device. The same grammar as `Libraries/Utilities/MediaQueries.js`, which
 * answers `matchMedia`, so a hook and a rule agree.
 */
struct MediaEnvironment {
  double width{0};
  double height{0};
  double viewportWidth{0};
  double viewportHeight{0};
  // Device pixels per CSS pixel
  double resolution{1};
  bool dark{false};
  bool reducedMotion{false};
  enum class Pointer : uint8_t { None, Coarse, Fine };
  Pointer pointer{Pointer::Coarse};
  bool hover{false};
  enum class Gamut : uint8_t { Srgb, P3, Rec2020 };
  Gamut gamut{Gamut::Srgb};
  bool highDynamicRange{false};
};

/*
 * A media query list (Media Queries 4 §2): true when any query in it is, and
 * true when empty. A query that cannot be parsed matches nothing (§3.2), and
 * a condition can be unknown, which stays unknown under `not` (§3).
 */
class MediaQueryList {
 public:
  static std::shared_ptr<const MediaQueryList> parse(std::string_view text);

  bool matches(const MediaEnvironment &environment) const;

  // The parsed form, opaque outside the implementation
  struct Condition;
  struct Query {
    // `not` before a media type negates the whole query
    bool negated{false};
    // `all` and `screen` describe this renderer; any other type is false
    bool typeMatches{true};
    std::shared_ptr<const Condition> condition;
  };

  /*
   * A condition alone, as `@container` writes its size query.
   */
  static std::shared_ptr<const MediaQueryList> parseCondition(std::string_view text);

 private:
  // nullopt for a query that could not be parsed
  std::vector<std::optional<Query>> queries_;
};

} // namespace facebook::react::cssengine
