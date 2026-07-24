/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineTextTagShadowNodes.h"

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/componentregistry/OnDemandComponentDescriptorProviders.h>

namespace facebook::react {

// NOLINTBEGIN(facebook-hte-CArray, modernize-avoid-c-arrays)
const char UnknownElementComponentName[] = "unknown";
const char BTagComponentName[] = "b";
const char ITagComponentName[] = "i";
const char SpanTagComponentName[] = "span";
const char UTagComponentName[] = "u";
// NOLINTEND(facebook-hte-CArray, modernize-avoid-c-arrays)

namespace {
// Self-register <u> via the LAZY on-demand seam at load. This TU defines the intrinsic component
// names and is always linked (because <b>/<i>/<span> are used), so this initializer always runs.
//
// <u> is registered ONLY here — never eagerly (not in the paragraph's supplemental providers, not in
// CoreComponentsRegistry). It is therefore resolved the first time a <u> is rendered — i.e. on a
// commit, long after all native init — through ComponentDescriptorProviderRegistry::request's
// on-demand fallback. That is the timing-safe, cross-platform seam: if <u> renders underlined, the
// lazy path works where eager registration raced and failed.
[[maybe_unused]] __attribute__((used)) const bool sRegisteredUTag = [] {
  OnDemandComponentDescriptorProviders::add(
      concreteComponentDescriptorProvider<UTagComponentDescriptor>());
  return true;
}();
} // namespace

} // namespace facebook::react
