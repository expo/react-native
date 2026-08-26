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
#include <string>
#include <atomic>
#include <optional>

namespace facebook::react {

/*
 * How big the platform says a text ROLE is, readable from the layout thread.
 *
 * ## What this exists for
 *
 * A heading names a role and states no size, so that `[UIFont
 * preferredFontForTextStyle:]` and Material's theme decide how big it is. That
 * works for the TEXT, which is measured on a thread that can ask. It does not
 * work for the heading's MARGINS, and margins are the reason this file exists.
 *
 * `h1 { margin-block: 0.67em }` resolves `em` against the element's own
 * font-size. Once the size comes from the platform, nothing in the layout layer
 * knows what that font-size is, and the margin was left resolving against the
 * size the WEB would have used — so an `<h1>` rendered at Title 1's 28pt
 * carried the 22.8pt margin computed for the web's 34pt. Every heading on iOS
 * sat in a rhythm belonging to a size it was not being drawn at.
 *
 * The gap is one value wide: layout needs the number the text layer already
 * has. So the text layer publishes it here and layout reads it.
 *
 * ## Why a published cache and not a lookup
 *
 * Both platforms resolve a role through an API that layout cannot reach. iOS
 * needs UIKit and the layout thread is not a UI thread; Android needs a
 * `Context` and the text pipeline deliberately carries none (see
 * `MaterialTypeScale`). Resolution happens where those are available, and its
 * result — a number of points — travels here.
 *
 * ## Points, already scaled
 *
 * Sizes are in the same units Yoga lays out in, and include whatever the
 * platform's accessibility text scaling has done to them. A margin computed
 * from one therefore grows with the text it sits beside, which is the whole
 * behaviour a fixed ladder cannot have: at the largest accessibility size iOS
 * takes Title 1 from 28pt to 44, and a heading whose margins stayed at 22.8
 * would be visibly crowded by its own text.
 *
 * ## Empty is a legitimate state, not an error
 *
 * A host with no platform type scale — Fantom, and any consumer before the
 * first publish — reads `std::nullopt` and the caller falls back to the
 * font-size the cascade already carried. That is not a degraded path; it is the
 * web's own answer, which is the right one where there is no platform to ask.
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
