/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#import <UIKit/UIKit.h>

#include <cmath>
#include <memory>

#include <react/renderer/components/view/ElementControlSizeState.h>

/*
 * A control telling layout what it wants to be.
 *
 * Several form controls are sized by something only the control knows — a
 * file input's title, a date picker's value and mode, a text field's own
 * chrome — so each is asked rather than modelled. Written once because the
 * hazards are the same every time and are easy to get wrong separately:
 *
 *   - a report identical to what layout already holds must NOT commit, or the
 *     mount that follows re-enters this and the tree commits forever;
 *   - `intrinsicContentSize` read in the same turn as the content changed
 *     still describes the OLD content, because a `UIButtonConfiguration` is
 *     applied asynchronously — so callers lay out first;
 *   - a control with no state yet has nothing to tell, and says nothing.
 */
template <typename ConcreteStateT>
static inline void EXPReportControlSize(const std::shared_ptr<const ConcreteStateT> &state, CGSize intrinsic)
{
  if (state == nullptr || intrinsic.width <= 0 || intrinsic.height <= 0) {
    return;
  }
  const auto width = static_cast<facebook::react::Float>(intrinsic.width);
  const auto height = static_cast<facebook::react::Float>(intrinsic.height);
  state->updateState([=](const typename ConcreteStateT::Data &oldData) -> typename ConcreteStateT::SharedData {
    if (std::abs(oldData.width - width) < 0.01 && std::abs(oldData.height - height) < 0.01) {
      return nullptr;
    }
    auto newData = oldData;
    newData.width = width;
    newData.height = height;
    return std::make_shared<const typename ConcreteStateT::Data>(newData);
  });
}
