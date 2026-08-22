/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>
#include <vector>

#include <react/renderer/components/view/AccessibilityPrimitives.h>
#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/ReactPrimitives.h>

namespace facebook::react {

/*
 * Authored accessibility content for one anonymous inline formatting context.
 *
 * A text run is a layout/paint implementation detail. This value is the
 * semantic counterpart carried beside it: an ordered list of leaves exposed
 * to the platform accessibility API. Presentational inline elements are
 * deliberately absent. `fragmentIndices` only map an authored leaf back to
 * text-engine geometry; they are not part of the public semantic model.
 */
struct InlineAccessibilityElement final {
  enum class Kind { StaticText, Element, Attachment };

  Kind kind{Kind::StaticText};
  Tag tag{0};
  std::string label{};
  std::string role{};
  std::string hint{};
  std::string language{};
  AccessibilityTraits traits{AccessibilityTraits::None};
  AccessibilityState state{};
  AccessibilityValue value{};
  AccessibilityLiveRegion liveRegion{AccessibilityLiveRegion::None};
  std::vector<AccessibilityAction> actions{};
  bool disabled{false};
  bool onAccessibilityTap{false};
  bool onAccessibilityAction{false};
  EventEmitter::Shared eventEmitter{};
  std::vector<size_t> fragmentIndices{};
  /*
   * The mounted views (inline attachments) this leaf presents, in document order. An `Attachment`
   * leaf is exactly one: the view is the platform leaf, presented where this leaf stands. An
   * `Element` that wraps attachments (`<a href><img></a>`) presents them right after itself.
   */
  std::vector<Tag> attachmentTags{};

  bool operator==(const InlineAccessibilityElement &other) const
  {
    return kind == other.kind && tag == other.tag && label == other.label &&
        role == other.role && hint == other.hint &&
        language == other.language && traits == other.traits &&
        state == other.state &&
        value == other.value && liveRegion == other.liveRegion &&
        actions == other.actions && disabled == other.disabled &&
        onAccessibilityTap == other.onAccessibilityTap &&
        onAccessibilityAction == other.onAccessibilityAction &&
        eventEmitter == other.eventEmitter &&
        fragmentIndices == other.fragmentIndices &&
        attachmentTags == other.attachmentTags;
  }
};

/*
 * `elements` is the reading order of the run, and the only one: a platform exposes every element,
 * in this order, and decides none of it again. Every element is a stop or, for static text, a
 * readable leaf; an attachment is presented through its mounted view at its element's position.
 *
 * `attachmentTags` lists every inline attachment the run lays out, whether or not an element
 * presents it. Those views belong to the run's position in the reading order, so a platform must
 * not present them anywhere else: one that no element presents is inside a hidden subtree.
 */
struct InlineAccessibilityContent final {
  std::vector<InlineAccessibilityElement> elements{};
  std::vector<Tag> attachmentTags{};

  bool operator==(const InlineAccessibilityContent &other) const
  {
    return elements == other.elements && attachmentTags == other.attachmentTags;
  }
};

} // namespace facebook::react
