/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "AttributedString.h"

#include <react/renderer/debug/DebugStringConvertibleItem.h>

namespace facebook::react {

using Fragment = AttributedString::Fragment;
using Fragments = AttributedString::Fragments;

#pragma mark - Fragment

std::string Fragment::AttachmentCharacter() {
  // C++20 makes char8_t a distinct type from char, and u8 string literals
  // consist of char8_t instead of char, which in turn requires std::u8string,
  // etc. Here we were assuming char was UTF-8 anyway, so just cast to that
  // (which is valid because char* is allowed to alias anything).
  return reinterpret_cast<const char*>(
      u8"\uFFFC"); // Unicode `OBJECT REPLACEMENT CHARACTER`
}

bool Fragment::isAttachment() const {
  return string == AttachmentCharacter();
}

bool Fragment::operator==(const Fragment& rhs) const {
  // Full equality is content equality plus the two parentShadowView fields
  // that identify and place the fragment's element. Deferring to
  // `isContentEqual` rather than listing the content fields again is what
  // keeps the two from drifting apart: a field added for layout gets picked
  // up by both, and there is exactly one place to decide whether a new field
  // is content.
  return isContentEqual(rhs) &&
      std::tie(parentShadowView.tag, parentShadowView.layoutMetrics) ==
      std::tie(rhs.parentShadowView.tag, rhs.parentShadowView.layoutMetrics);
}

bool Fragment::isContentEqual(const Fragment& rhs) const {
  // Inline box spacing changes the measured advance, so it is part of the
  // content for measure-cache purposes.
  // `atomicInlineBaseline` changes where the box sits on the line, so it is
  // part of the content for measure-cache purposes.
  return std::tie(
             string,
             textAttributes,
             inlineBox,
             isInlineBoxStart,
             isInlineBoxEnd,
             atomicInlineBaseline,
             atomicInlineVerticalAlign,
             forcedBreak) ==
      std::tie(
          rhs.string,
          rhs.textAttributes,
          rhs.inlineBox,
          rhs.isInlineBoxStart,
          rhs.isInlineBoxEnd,
          rhs.atomicInlineBaseline,
          rhs.atomicInlineVerticalAlign,
          rhs.forcedBreak);
}

#pragma mark - AttributedString

void AttributedString::appendFragment(Fragment&& fragment) {
  ensureUnsealed();
  // Empty fragments are dropped because they are nothing — except for the one
  // that is empty on purpose: an inline element with no text still has a box
  // on the line (CSSOM-View §4), and this fragment is the only record of it.
  if (!fragment.string.empty() || fragment.isEmptyElement) {
    fragments_.push_back(std::move(fragment));
  }
}

void AttributedString::prependFragment(Fragment&& fragment) {
  ensureUnsealed();
  if (!fragment.string.empty()) {
    fragments_.insert(fragments_.begin(), std::move(fragment));
  }
}

void AttributedString::setBaseTextAttributes(
    const TextAttributes& defaultAttributes) {
  baseAttributes_ = defaultAttributes;
}

const Fragments& AttributedString::getFragments() const {
  return fragments_;
}

Fragments& AttributedString::getFragments() {
  return fragments_;
}

RectangleEdges<Float> AttributedString::inlineBoxBlockAxisOverflow() const {
  auto overflow = RectangleEdges<Float>{};
  for (const auto& fragment : fragments_) {
    const auto& box = fragment.inlineBox;
    if (box.isEmpty()) {
      continue;
    }
    // The outline is stroked centred on a path `outlineOffset` outside the
    // border box, so it reaches `outlineOffset + outlineWidth` beyond it.
    auto outline =
        box.outlineWidth > 0 ? box.outlineOffset + box.outlineWidth : 0;
    overflow.top = std::max(
        overflow.top, box.padding.top + box.borderWidth.top + outline);
    overflow.bottom = std::max(
        overflow.bottom, box.padding.bottom + box.borderWidth.bottom + outline);
  }
  // Deliberately EXCLUDES the baseline-shift share: that ink is RESERVED in
  // the run box's measured height (baselineShiftInkOverflow below), so it
  // needs no canvas beyond the box. This function is the box-decoration
  // overflow only — the part that paints outside without growing anything
  // (CSS2 §10.6.1).
  return overflow;
}

RectangleEdges<Float> AttributedString::baselineShiftInkOverflow() const {
  /*
   * `<sup>`/`<sub>` shift GLYPH INK past the line box without growing the
   * LINE — the keep-the-rhythm deviation (SpecDeviations.md): Safari grows
   * the line for a superscript, we keep interior rhythm. The ink still has
   * to PAINT (CSS's initial `overflow: visible`; a line box never clips),
   * and it must never escape the RUN'S BOX either: measured height reserves
   * exactly this at the box's edges (InlineContentShadowNode::measureContent),
   * because ink past the box's top painted OVER whatever sat above it — a
   * demo's superscript rode into the title of the case before it.
   *
   * Separate from `inlineBoxBlockAxisOverflow` because the box-decoration
   * share (an inline box's block padding/border/outline) deliberately
   * overflows WITHOUT growing anything (CSS2 §10.6.1) — only the shift ink
   * is reserved in the box.
   *
   * The shift each platform applies is half the ascent of the already-
   * reduced font; ascent is under one em, so HALF THE FRAGMENT'S FONT SIZE
   * bounds it. A slightly generous reserve costs a couple of points of
   * height on the rare run that contains a shifted fragment.
   */
  auto overflow = RectangleEdges<Float>{};
  for (const auto& fragment : fragments_) {
    const auto& attrs = fragment.textAttributes;
    if (attrs.verticalAlign.has_value() &&
        *attrs.verticalAlign != TextVerticalAlign::Baseline) {
      Float size = !std::isnan(attrs.fontSize)
          ? attrs.fontSize
          : TextAttributes::defaultTextAttributes().fontSize;
      auto inkReach = size / 2;
      if (*attrs.verticalAlign == TextVerticalAlign::Super) {
        overflow.top = std::max(overflow.top, inkReach);
      } else {
        overflow.bottom = std::max(overflow.bottom, inkReach);
      }
    }
  }
  return overflow;
}

std::string AttributedString::getString() const {
  auto string = std::string{};
  for (const auto& fragment : fragments_) {
    string += fragment.string;
  }
  return string;
}

const TextAttributes& AttributedString::getBaseTextAttributes() const {
  return baseAttributes_;
}

bool AttributedString::isEmpty() const {
  return fragments_.empty();
}

bool AttributedString::compareTextAttributesWithoutFrame(
    const AttributedString& rhs) const {
  if (fragments_.size() != rhs.fragments_.size()) {
    return false;
  }

  for (size_t i = 0; i < fragments_.size(); i++) {
    if (fragments_[i].textAttributes != rhs.fragments_[i].textAttributes ||
        fragments_[i].string != rhs.fragments_[i].string) {
      return false;
    }
  }

  return true;
}

bool AttributedString::operator==(const AttributedString& rhs) const {
  return std::tie(fragments_, baseAttributes_) ==
      std::tie(rhs.fragments_, rhs.baseAttributes_);
}

bool AttributedString::isContentEqual(const AttributedString& rhs) const {
  if (fragments_.size() != rhs.fragments_.size()) {
    return false;
  }

  for (size_t i = 0; i < fragments_.size(); i++) {
    if (!fragments_[i].isContentEqual(rhs.fragments_[i])) {
      return false;
    }
  }

  return true;
}

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
SharedDebugStringConvertibleList AttributedString::getDebugChildren() const {
  auto list = SharedDebugStringConvertibleList{};

  for (auto&& fragment : fragments_) {
    auto propsList =
        fragment.textAttributes.DebugStringConvertible::getDebugProps();

    list.push_back(
        std::make_shared<DebugStringConvertibleItem>(
            "Fragment",
            fragment.string,
            SharedDebugStringConvertibleList(),
            propsList));
  }

  return list;
}
#endif

} // namespace facebook::react
