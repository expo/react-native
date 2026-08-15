/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>

namespace facebook::yoga {

// https://www.w3.org/TR/css-grid-2/#grid-auto-flow-property
//
// `dense` changes only the auto-placement cursor: a sparse flow never moves
// the cursor backwards, so a later small item cannot fill a hole an earlier
// spanning item left behind, while a dense flow restarts the search from the
// beginning for every item and does fill them.
enum class GridAutoFlow : uint8_t {
  Row = 0,
  RowDense = 1,
};

constexpr bool isDense(GridAutoFlow flow) {
  return flow == GridAutoFlow::RowDense;
}

} // namespace facebook::yoga
