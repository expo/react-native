/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <functional>
#include <string>
#include <string_view>
#include <vector>

#include <folly/dynamic.h>
#include <react/renderer/cssengine/StyleValues.h>

namespace facebook::react::cssengine {

/*
 * One property after the cascade, as the props are written from: a longhand,
 * its value already through `var()`, `light-dark()` and the colour functions.
 *
 * Box edges are named the way React Native's props rank highest: the inline
 * sides `Start` and `End`, the block sides `Top` and `Bottom`. A logical and
 * a physical declaration of one edge are then one property, and the later
 * wins (css-logical-1 §4); and an edge the engine writes beats the user
 * agent's value however that is spelled, since Yoga takes `Start` over `Left`
 * and over `Horizontal`, `Top` over `Vertical`, and either over the whole.
 */
struct Longhand {
  std::string property;
  std::string value;
  // Substituted from a `var()`, so a value the property does not take makes
  // it unset rather than dropping it (css-variables-1 §3.1)
  bool fromVariable{false};
};

/*
 * Appends the longhands `property: value` sets, in order: itself when it is
 * one, its longhands when it is a shorthand.
 */
void expandDeclaration(std::string_view property, std::string_view value, bool rtl, std::vector<Longhand> &out);

/*
 * The keyframes an `animation-name` names, as the stops the renderer's
 * animation engine reads, or null.
 */
using KeyframesResolver = std::function<folly::dynamic(std::string_view)>;

struct ConversionContext {
  // `fontSize` is the element's computed font size, which its `em` lengths
  // resolve against
  LengthBasis basis;
  // The parent's computed font size, which a font size in `em` multiplies
  double parentFontSize{16};
  // The element's computed colour, which `currentColor` means
  std::string currentColor{"black"};
  bool rtl{false};
  KeyframesResolver keyframes;
};

/*
 * Writes the React Native props for the cascaded longhands into `props`.
 * A longhand whose value cannot be converted is dropped, as an invalid
 * declaration is.
 */
void convertLonghands(const std::vector<Longhand> &cascaded, const ConversionContext &context, folly::dynamic &props);

/*
 * The properties `inherit` has a value for: the ones the renderer's text
 * cascade inherits.
 */
bool isInheritedProperty(std::string_view property);

/*
 * The properties the renderer has no analog for, which are dropped.
 */
bool isDroppedProperty(std::string_view property);

} // namespace facebook::react::cssengine
