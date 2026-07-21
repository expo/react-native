/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <memory>

#include <react/renderer/attributedstring/AttributedString.h>

namespace facebook::react {

class TextLayoutManager;

/*
 * Implemented by anonymous inline-formatting-context boxes so their containing
 * View can read the flattened content for painting state without depending on
 * the text module (implicit-text-plan.md §3.B).
 */
class InlineTextContentAccessor {
 public:
  virtual ~InlineTextContentAccessor() = default;

  virtual AttributedString getContentAttributedString() const = 0;

  virtual std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const = 0;
};

} // namespace facebook::react
