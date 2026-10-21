/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "BackgroundImage.h"

namespace facebook::react {

#ifdef RN_SERIALIZABLE_STATE
folly::dynamic UrlImage::toDynamic() const {
  folly::dynamic result = folly::dynamic::object();
  result["type"] = "url";
  result["uri"] = uri;
  return result;
}

folly::dynamic toDynamic(const BackgroundImage& backgroundImage) {
  if (std::holds_alternative<LinearGradient>(backgroundImage)) {
    return std::get<LinearGradient>(backgroundImage).toDynamic();
  } else if (std::holds_alternative<RadialGradient>(backgroundImage)) {
    return std::get<RadialGradient>(backgroundImage).toDynamic();
  } else if (std::holds_alternative<UrlImage>(backgroundImage)) {
    return std::get<UrlImage>(backgroundImage).toDynamic();
  }
  return folly::dynamic(nullptr);
}
#endif

#if RN_DEBUG_STRING_CONVERTIBLE
void UrlImage::toString(std::stringstream& ss) const {
  ss << "url(\"" << uri << "\")";
}
#endif

} // namespace facebook::react
