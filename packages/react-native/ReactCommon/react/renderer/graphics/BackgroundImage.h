/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

#include <react/renderer/graphics/LinearGradient.h>
#include <react/renderer/graphics/RadialGradient.h>

#include <string>

namespace facebook::react {

/*
 * An image named by its URL, `url(photo.png)`, which the platform loads as it
 * loads an image's source. Its natural size, once loaded, is what
 * `background-size: auto` and the cover and contain keywords measure. With no
 * URL it is a `none` layer, which draws nothing and keeps the layers after it
 * at their places in the size, position and repeat lists.
 */
struct UrlImage {
  std::string uri;

  bool operator==(const UrlImage &other) const = default;

#ifdef RN_SERIALIZABLE_STATE
  folly::dynamic toDynamic() const;
#endif

#if RN_DEBUG_STRING_CONVERTIBLE
  void toString(std::stringstream &ss) const;
#endif
};

using BackgroundImage = std::variant<LinearGradient, RadialGradient, UrlImage>;

#ifdef RN_SERIALIZABLE_STATE
folly::dynamic toDynamic(const BackgroundImage &backgroundImage);
#endif

#if RN_DEBUG_STRING_CONVERTIBLE
inline std::string toString(std::vector<BackgroundImage> &value)
{
  std::stringstream ss;

  ss << "[";
  for (size_t i = 0; i < value.size(); i++) {
    if (i > 0) {
      ss << ", ";
    }

    const auto &backgroundImage = value[i];
    if (std::holds_alternative<LinearGradient>(backgroundImage)) {
      std::get<LinearGradient>(backgroundImage).toString(ss);
    } else if (std::holds_alternative<RadialGradient>(backgroundImage)) {
      std::get<RadialGradient>(backgroundImage).toString(ss);
    } else if (std::holds_alternative<UrlImage>(backgroundImage)) {
      std::get<UrlImage>(backgroundImage).toString(ss);
    }
  }
  ss << "]";

  return ss.str();
}
#endif

}; // namespace facebook::react
