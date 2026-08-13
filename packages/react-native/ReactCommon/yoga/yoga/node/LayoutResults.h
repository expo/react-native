/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <array>
#include <memory>
#include <vector>

#include <yoga/debug/AssertFatal.h>
#include <yoga/enums/Dimension.h>
#include <yoga/enums/Direction.h>
#include <yoga/enums/Edge.h>
#include <yoga/enums/PhysicalEdge.h>
#include <yoga/algorithm/PlacedFloat.h>
#include <yoga/node/CachedMeasurement.h>
#include <yoga/numeric/FloatOptional.h>

namespace facebook::yoga {

/*
 * A pointer that copies what it points at.
 *
 * It exists so a rarely-used member can be held out of line without the owner
 * having to declare its own copy constructor. A hand-written one would have to
 * list every field, and would silently stop copying any field added after it —
 * the kind of omission that shows up as a layout that is subtly stale rather
 * than as a build error.
 */
template <typename T>
class DeepCopyPtr {
 public:
  DeepCopyPtr() = default;
  DeepCopyPtr(DeepCopyPtr&&) noexcept = default;
  DeepCopyPtr& operator=(DeepCopyPtr&&) noexcept = default;
  ~DeepCopyPtr() = default;

  DeepCopyPtr(const DeepCopyPtr& other)
      : ptr_(
            other.ptr_ != nullptr ? std::make_unique<T>(*other.ptr_)
                                  : nullptr) {}

  DeepCopyPtr& operator=(const DeepCopyPtr& other) {
    if (this != &other) {
      ptr_ = other.ptr_ != nullptr ? std::make_unique<T>(*other.ptr_) : nullptr;
    }
    return *this;
  }

  const T* get() const {
    return ptr_.get();
  }

  T& ensure() {
    if (ptr_ == nullptr) {
      ptr_ = std::make_unique<T>();
    }
    return *ptr_;
  }

 private:
  std::unique_ptr<T> ptr_{};
};

struct LayoutResults {
  // This value was chosen based on empirical data:
  // 98% of analyzed layouts require less than 8 entries.
  static constexpr int32_t MaxCachedMeasurements = 8;

  uint32_t computedFlexBasisGeneration = 0;
  FloatOptional computedFlexBasis = {};

  // Per-flex-item floor along the main axis derived from CSS Flexbox §4.5
  // automatic minimum sizing. Set by `resolveFlexibleLength` when the parent's
  // config does NOT carry the `MinSizeUndefinedInsteadOfAuto` errata and the
  // item has no explicit main-axis `min-{width,height}`. Read by the
  // shrink/bound machinery to keep items at least this large. `Undefined`
  // means "no auto-min applies."
  FloatOptional computedAutoMinMainSize = {};

  // The two float lists a node in a shared formatting context needs. They live
  // together behind one pointer because both are empty for almost every node:
  // as two inline vectors they cost 48 bytes on EVERY node of EVERY tree, for
  // a feature most trees never use, and that pushed `ViewShadowNode` past the
  // memory budget its static_assert defends. A tree with no floats now costs
  // one null pointer and allocates nothing.
  struct FloatLists {
    // Floats placed inside this node that belong to an ANCESTOR's formatting
    // context, in this node's content-box coordinates. A block that shares its
    // owner's context does not own the floats written inside it — the owner
    // does — so it hands them up here and the owner translates and adopts
    // them. Empty for a node that is an independent formatting context, which
    // keeps its own.
    std::vector<PlacedFloat> escaped;

    // The owner's floats, translated into this node's content-box coordinates,
    // for a node that shares the owner's formatting context. The other half of
    // the same rule: such a node has to place its own floats around them and
    // shorten its lines beside them, and it cannot see them any other way.
    std::vector<PlacedFloat> inherited;
  };

  const std::vector<PlacedFloat>& escapedFloats() const {
    const auto* floats = floats_.get();
    return floats != nullptr ? floats->escaped : noFloats();
  }

  const std::vector<PlacedFloat>& inheritedFloats() const {
    const auto* floats = floats_.get();
    return floats != nullptr ? floats->inherited : noFloats();
  }

  // Setting an empty list on a node that never had one stays allocation-free,
  // which is the common case: the layout algorithm hands every block its
  // (usually empty) list rather than checking first.
  void setEscapedFloats(std::vector<PlacedFloat> floats) {
    if (floats.empty() && floats_.get() == nullptr) {
      return;
    }
    ensureFloats().escaped = std::move(floats);
  }

  void setInheritedFloats(std::vector<PlacedFloat> floats) {
    if (floats.empty() && floats_.get() == nullptr) {
      return;
    }
    ensureFloats().inherited = std::move(floats);
  }

  // Where the block flow had reached when an absolutely-positioned child was
  // skipped: its STATIC POSITION (CSS2 §10.6.4), relative to the block
  // container's content box. Recorded by `calculateBlockLayout` and read by
  // absolute layout when neither inset on the block axis is given, which is
  // exactly when the spec asks for it. `Undefined` means no block container
  // recorded one, which is the case for every flex and grid child.
  FloatOptional staticPositionBlockStart = {};

  // Instead of recomputing the entire layout every single time, we cache some
  // information to break early when nothing changed
  uint32_t generationCount = 0;
  uint32_t configVersion = 0;
  Direction lastOwnerDirection = Direction::Inherit;

  uint32_t nextCachedMeasurementsIndex = 0;
  std::array<CachedMeasurement, MaxCachedMeasurements> cachedMeasurements = {};

  CachedMeasurement cachedLayout{};

  Direction direction() const {
    return direction_;
  }

  void setDirection(Direction direction) {
    direction_ = direction;
  }

  bool hadOverflow() const {
    return hadOverflow_;
  }

  void setHadOverflow(bool hadOverflow) {
    hadOverflow_ = hadOverflow;
  }

  float dimension(Dimension axis) const {
    return dimensions_[yoga::to_underlying(axis)];
  }

  void setDimension(Dimension axis, float dimension) {
    dimensions_[yoga::to_underlying(axis)] = dimension;
  }

  float measuredDimension(Dimension axis) const {
    return measuredDimensions_[yoga::to_underlying(axis)];
  }

  float rawDimension(Dimension axis) const {
    return rawDimensions_[yoga::to_underlying(axis)];
  }

  void setMeasuredDimension(Dimension axis, float dimension) {
    measuredDimensions_[yoga::to_underlying(axis)] = dimension;
  }

  void setRawDimension(Dimension axis, float dimension) {
    rawDimensions_[yoga::to_underlying(axis)] = dimension;
  }

  float position(PhysicalEdge physicalEdge) const {
    return position_[yoga::to_underlying(physicalEdge)];
  }

  void setPosition(PhysicalEdge physicalEdge, float dimension) {
    position_[yoga::to_underlying(physicalEdge)] = dimension;
  }

  float margin(PhysicalEdge physicalEdge) const {
    return margin_[yoga::to_underlying(physicalEdge)];
  }

  void setMargin(PhysicalEdge physicalEdge, float dimension) {
    margin_[yoga::to_underlying(physicalEdge)] = dimension;
  }

  float border(PhysicalEdge physicalEdge) const {
    return border_[yoga::to_underlying(physicalEdge)];
  }

  void setBorder(PhysicalEdge physicalEdge, float dimension) {
    border_[yoga::to_underlying(physicalEdge)] = dimension;
  }

  float padding(PhysicalEdge physicalEdge) const {
    return padding_[yoga::to_underlying(physicalEdge)];
  }

  void setPadding(PhysicalEdge physicalEdge, float dimension) {
    padding_[yoga::to_underlying(physicalEdge)] = dimension;
  }

  bool operator==(const LayoutResults& layout) const;

 private:
  static const std::vector<PlacedFloat>& noFloats() {
    static const std::vector<PlacedFloat> empty{};
    return empty;
  }

  FloatLists& ensureFloats() {
    return floats_.ensure();
  }

  DeepCopyPtr<FloatLists> floats_{};

  Direction direction_ : bitCount<Direction>() = Direction::Inherit;
  bool hadOverflow_ : 1 = false;

  std::array<float, 2> dimensions_ = {{YGUndefined, YGUndefined}};
  std::array<float, 2> measuredDimensions_ = {{YGUndefined, YGUndefined}};
  std::array<float, 2> rawDimensions_ = {{YGUndefined, YGUndefined}};
  std::array<float, 4> position_ = {};
  std::array<float, 4> margin_ = {};
  std::array<float, 4> border_ = {};
  std::array<float, 4> padding_ = {};
};

} // namespace facebook::yoga
