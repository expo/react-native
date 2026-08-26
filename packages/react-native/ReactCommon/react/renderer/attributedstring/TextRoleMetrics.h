/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/graphics/Float.h>

#include <array>
#include <atomic>
#include <optional>
#include <string>

namespace facebook::react {

/*
 * How big the platform says a text role is, readable from the layout thread.
 *
 * A heading names a role and states no size, so `[UIFont
 * preferredFontForTextStyle:]` and Material's theme decide how big it is. The
 * text is measured on a thread that can ask them; the heading's margins are
 * not, and `h1 { margin-block: 0.67em }` resolves `em` against the element's
 * own font-size. So the text layer publishes the size it resolved and layout
 * reads it here.
 *
 * A published cache rather than a lookup, because both platforms resolve a
 * role through an API layout cannot reach: iOS needs UIKit and the layout
 * thread is not a UI thread; Android needs a `Context` and the text pipeline
 * carries none (see `MaterialTypeScale`).
 *
 * Sizes are in the units Yoga lays out in and include the platform's
 * accessibility text scaling, so a margin computed from one grows with the
 * text it sits beside (at the largest accessibility size iOS takes Title 1
 * from 28pt to 44).
 *
 * Empty is a legitimate state: a host with no platform type scale (Fantom, or
 * any consumer before the first publish) reads `std::nullopt` and the caller
 * falls back to the font-size the cascade carried, which is the web's own
 * answer.
 */
class TextRoleMetrics {
 public:
  /*
   * Records the platform's size, in points, for `ramp`.
   *
   * Idempotent and safe to call repeatedly — the platform re-publishes when the
   * user changes their text size, and the values simply overwrite.
   */
  static void publish(DynamicTypeRamp ramp, Float pointSize);

  /*
   * Records a size for the role NAMED `roleName`, returning false where no ramp
   * goes by that name.
   *
   * For callers on the other side of a language boundary. Android resolves its
   * type scale in Kotlin and has to send the result across JNI, and sending the
   * enum's ORDINAL would put a copy of this enum's order in a second language,
   * silently wrong the first time a ramp is inserted anywhere but the end. The
   * name is matched against `toString(DynamicTypeRamp)` — the vocabulary the
   * style property already uses — so there is one spelling of it, not two.
   */
  static bool publishByName(const std::string &roleName, Float pointSize);

  /*
   * The platform's size for `ramp`, or `std::nullopt` where none has been
   * published.
   */
  static std::optional<Float> sizeOf(DynamicTypeRamp ramp);

  /*
   * Forgets every published size.
   *
   * For tests, which need a host that has answered and a host that has not, and
   * would otherwise be order-dependent on each other.
   */
  static void reset();

 private:
  /*
   * One slot per ramp, `NaN` where unpublished.
   *
   * Lock-free deliberately: `sizeOf` is called during layout, once per heading
   * per commit, and layout is not a place to take a lock that a UI thread also
   * wants. A relaxed load can return a size from just before a text-size change
   * while the tree is mid-commit; the next commit — which a text-size change
   * triggers anyway — corrects it. Nothing here is ordered against other state,
   * so there is nothing for a stronger ordering to protect.
   */
  static std::array<std::atomic<Float>, kDynamicTypeRampCount> &storage();
};

} // namespace facebook::react
