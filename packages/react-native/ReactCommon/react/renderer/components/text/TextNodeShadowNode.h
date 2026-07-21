/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/core/ConcreteShadowNode.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char TextNodeComponentName[];

/*
 * Props for the first-class text node. The character data is a **direct field**
 * (`text`), not parsed out of `RawProps` — the `createTextNode` host-config path
 * sets it straight, and `commitTextUpdate` replaces it, avoiding RawProps parsing
 * on every text change (implicit-text-plan.md §3.F).
 */
class TextNodeProps final : public Props {
 public:
  TextNodeProps() = default;
  explicit TextNodeProps(std::string text) : text(std::move(text)) {}

  // Clone constructor (satisfies the descriptor's `cloneProps` invariant). It
  // deliberately does NOT parse "text" out of `rawProps` — character data only
  // ever changes through `createTextNode`, so a clone just carries the existing
  // `text` forward.
  TextNodeProps(
      const PropsParserContext &context,
      const TextNodeProps &sourceProps,
      const RawProps &rawProps)
      : Props(context, sourceProps, rawProps), text(sourceProps.text) {}

  std::string text{};
};

/*
 * First-class DOM text node (`Text : CharacterData`, DOM `nodeName` "#text").
 * Replaces `RawTextShadowNode`'s fake-`RCTRawText`-component packaging
 * (implicit-text-plan.md §3.F): it keeps a real per-node `ShadowNodeFamily` for
 * identity/traversal (DOM `childNodes`/`parentNode` resolve through it) and the
 * `instanceHandle`, but drops the RawProps parsing (character data is a direct
 * field), has no state, and is constructed by one internal descriptor — never
 * resolvable from JS by component name.
 */
class TextNodeShadowNode final : public ConcreteShadowNode<TextNodeComponentName, ShadowNode, TextNodeProps> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;

  const std::string &getText() const {
    return getConcreteProps().text;
  }
};

} // namespace facebook::react
