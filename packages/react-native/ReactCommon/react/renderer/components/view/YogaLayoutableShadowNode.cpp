/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "YogaLayoutableShadowNode.h"

#include <react/renderer/components/view/ElementBoxShadowNode.h>
#include <react/renderer/components/view/ListStyle.h>
#include <react/renderer/dom/NodeNameProvider.h>
#include <cxxreact/TraceSection.h>
#include <logger/react_native_log.h>
#include <react/debug/flags.h>
#include <react/debug/react_native_assert.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/LayoutConformanceShadowNode.h>
#include <react/renderer/components/view/BaseViewProps.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/ComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/debug/DebugStringConvertibleItem.h>
#include <react/utils/FloatComparison.h>
#include <glog/logging.h>
#include <unordered_set>
#include <yoga/Yoga.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>

namespace facebook::react {

/*
 * The text attributes a node starts from when no ancestor has set any.
 *
 * The default size itself lives in `TextAttributes::defaultTextAttributes()` —
 * see the note there for why one default in one place is the only arrangement
 * that keeps `<View>{'hi'}</View>` and `<View><Text>hi</Text></View>` the same
 * size.
 */
const std::shared_ptr<const TextAttributes>&
YogaLayoutableShadowNode::defaultCascadeTextAttributes() {
  static const auto instance = std::make_shared<const TextAttributes>(
      TextAttributes::defaultTextAttributes());
  return instance;
}

// Whether `child` is an inline-level box (`display:'inline'`, not absolutely
// positioned) — the union of atomic inline boxes and span-like inline flow
// content. Defined with the other classification predicates below.
static bool isInlineLevelBox(const ShadowNode& child);

// Whether the author's own `display` makes `child` block-level regardless of
// its UA default (css-display-3 §2's blockification, from the other
// direction): `display: 'block'` on an element whose trait says inline takes
// it out of inline flow.
static bool authorDisplayBlockifies(const ShadowNode& child);

// Whether the inheritable text props that feed the element-tree cascade
// (text-children-plan.md §3.D) differ between two revisions of a View's props.
// A change here must re-run the cascade into descendant IFCs even though none
// of these keys is a Yoga layout style. Extend this as the inherited set grows
// (§5.6).
static bool inheritableTextPropsDiffer(
    const BaseViewProps& a,
    const BaseViewProps& b) {
  // Toggling an inheritance boundary rewires what the whole subtree inherits.
  if (a.cascadeReset != b.cascadeReset) {
    return true;
  }
  if (a.inheritedColor != b.inheritedColor ||
      a.inheritedFontFamily != b.inheritedFontFamily ||
      a.inheritedFontWeight != b.inheritedFontWeight ||
      a.inheritedFontStyle != b.inheritedFontStyle ||
      a.inheritedFontVariant != b.inheritedFontVariant ||
      a.inheritedTextAlign != b.inheritedTextAlign ||
      a.inheritedTextTransform != b.inheritedTextTransform) {
    return true;
  }
  // NaN-aware compares for the optional-by-NaN Float props.
  const std::pair<Float, Float> floatPairs[] = {
      {a.inheritedFontSize, b.inheritedFontSize},
      {a.inheritedLetterSpacing, b.inheritedLetterSpacing},
      {a.inheritedLineHeight, b.inheritedLineHeight}};
  for (const auto& [x, y] : floatPairs) {
    const bool xNan = std::isnan(x);
    const bool yNan = std::isnan(y);
    if (xNan || yNan) {
      if (xNan != yNan) {
        return true;
      }
    } else if (x != y) {
      return true;
    }
  }
  return false;
}

static int FabricDefaultYogaLog(
    const YGConfigConstRef /*unused*/,
    const YGNodeConstRef /*unused*/,
    YGLogLevel level,
    const char* format,
    va_list args) {
  va_list args_copy;
  va_copy(args_copy, args);

  // Adding 1 to add space for terminating null character.
  int size_s = vsnprintf(nullptr, 0, format, args);
  auto size = static_cast<size_t>(size_s);
  std::vector<char> buffer(size);

  vsnprintf(buffer.data(), size, format, args_copy);
  switch (level) {
    case YGLogLevelError:
      react_native_log_error(buffer.data());
      break;
    case YGLogLevelFatal:
      react_native_log_fatal(buffer.data());
      break;
    case YGLogLevelWarn:
      react_native_log_warn(buffer.data());
      break;
    case YGLogLevelInfo:
    case YGLogLevelDebug:
    case YGLogLevelVerbose:
    default:
      react_native_log_info(buffer.data());
  }

  return size_s;
}

thread_local LayoutContext threadLocalLayoutContext;

YogaLayoutableShadowNode::YogaLayoutableShadowNode(
    const ShadowNodeFragment& fragment,
    const ShadowNodeFamily::Shared& family,
    ShadowNodeTraits traits)
    : LayoutableShadowNode(fragment, family, traits),
      yogaConfig_(FabricDefaultYogaLog),
      yogaNode_(&initializeYogaConfig(yogaConfig_)) {
  traits_.set(ShadowNodeTraits::Trait::YogaLayoutableKind);
  YGNodeSetContext(&yogaNode_, this);

  if (getTraits().check(ShadowNodeTraits::Trait::MeasurableYogaNode)) {
    react_native_assert(
        getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode));

    YGNodeSetMeasureFunc(&yogaNode_, yogaNodeMeasureCallbackConnector);
  }

  if (getTraits().check(ShadowNodeTraits::Trait::BaselineYogaNode)) {
    YGNodeSetBaselineFunc(
        &yogaNode_,
        YogaLayoutableShadowNode::yogaNodeBaselineCallbackConnector);
  }

  // Asked once per node construction, so both halves are kept cheap: the
  // boundary query is virtual on Props rather than an RTTI cast (those already
  // account for ~7% of the main thread in a mount profile), and the trait check
  // runs first because a node that is neither a user-agent boundary nor
  // carrying an `all` declaration is the overwhelming majority.
  if (props_ != nullptr &&
      props_->isInheritanceBoundary(
          getTraits().check(ShadowNodeTraits::Trait::UACascadeBoundary)) &&
      ReactNativeFeatureFlags::enableStringChildren()) {
    traits_.set(ShadowNodeTraits::Trait::InheritanceBoundary);
  }

  updateYogaProps();
  updateYogaChildren();

  ensureConsistency();
}

YogaLayoutableShadowNode::YogaLayoutableShadowNode(
    const ShadowNode& sourceShadowNode,
    const ShadowNodeFragment& fragment)
    : LayoutableShadowNode(sourceShadowNode, fragment),
      yogaConfig_(FabricDefaultYogaLog),
      yogaNode_(
          static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
              .yogaNode_),
      // The cascade has to survive cloning. `measure()` lays out a CLONE, so
      // without this an atomic inline measured its own text with default
      // attributes — a 15pt cascade came out at the 14pt default, which is
      // both the wrong glyph size and the wrong baseline to align by.
      receivedTextAttributes_(
          static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
              .receivedTextAttributes_),
      yogaChildrenNeedInlineRebuild_(
          static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
              .yogaChildrenNeedInlineRebuild_) {
  // Note, cloned `yoga::Node` instance (copied using copy-constructor)
  // inherits dirty flag, measure function, and other properties being set
  // originally in the `YogaLayoutableShadowNode` constructor above.
  react_native_assert(
      YGNodeIsDirty(
          &static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
               .yogaNode_) == YGNodeIsDirty(&yogaNode_) &&
      "Yoga node must inherit dirty flag.");
  if (!getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode) &&
      !fragment.children) {
    // Children unchanged: copy the filtered list directly from the source,
    // skipping per-child dynamic_pointer_cast. When fragment.children is set,
    // updateYogaChildren() below rebuilds the vector from the new children
    // list — populating it here would be immediately discarded.
    yogaLayoutableChildren_ =
        static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
            .yogaLayoutableChildren_;
  }

  YGConfigConstRef previousConfig =
      &static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
           .yogaConfig_;

  YGNodeSetContext(&yogaNode_, this);
  yogaNode_.setOwner(nullptr);
  YGNodeSetConfig(
      &yogaNode_, &initializeYogaConfig(yogaConfig_, previousConfig));
  updateYogaChildrenOwnersIfNeeded();

  // We do not need to reconfigure this subtree before the next layout pass if
  // the previous node with the same props and children has already been
  // configured.
  if (!fragment.props && !fragment.children) {
    yogaTreeHasBeenConfigured_ =
        static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
            .yogaTreeHasBeenConfigured_;
  }

  if (fragment.props) {
    updateYogaProps();
  }

  // Inheritable text props (the `color`/`fontSize` cascade, §3.D) touch no Yoga
  // style, so a change to them alone would not dirty layout — yet descendant
  // anonymous IFC boxes must re-measure and re-cascade. Dirty this node so a
  // layout pass runs and `configureYogaTree` re-propagates the cascade
  // (text-children-plan.md §3.D). The dirty flag is picked up by the parent's
  // `updateYogaChildren` (which compares child dirtiness) and propagated to the
  // surface root, so `layoutIfNeeded` actually runs the pass.
  if (ReactNativeFeatureFlags::enableStringChildren() && fragment.props) {
    const auto& source =
        static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode);
    const auto* oldProps = source.props_->asBaseViewProps();
    const auto* newProps = props_->asBaseViewProps();
    if (newProps != nullptr) {
      // The boundary is a per-node fact resolved from the authored `all` and
      // the element's UA declaration (UACascadeBoundary rides along in the
      // traits copied from the source revision, immutable per class); keep
      // the resolved trait in sync on the revision that changed props.
      if (newProps->isInheritanceBoundary(getTraits().check(
              ShadowNodeTraits::Trait::UACascadeBoundary))) {
        traits_.set(ShadowNodeTraits::Trait::InheritanceBoundary);
      } else {
        traits_.unset(ShadowNodeTraits::Trait::InheritanceBoundary);
      }
    }
    // One-load fast path: when neither revision sets any inheritable text
    // prop or boundary — almost every View — nothing can differ. And when
    // something does differ, dirty only if some descendant text actually
    // DEPENDS on this node's cascade; with no dependents there is no observer,
    // and the whole subtree walk the dirtying would cause is skipped.
    if (oldProps != nullptr && newProps != nullptr &&
        (oldProps->hasInheritedTextProps || newProps->hasInheritedTextProps ||
         oldProps->cascadeReset != newProps->cascadeReset) &&
        getTraits().check(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents) &&
        inheritableTextPropsDiffer(*oldProps, *newProps)) {
      yogaNode_.setDirty(true);
    }
  }

  if (fragment.children) {
    updateYogaChildren();
  } else if (!static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode)
                  .anonymousTextContentChildren_.empty()) {
    // Anonymous boxes are owned exclusively by one shadow-node revision
    // (text-children-plan.md §4.1): rebuild rather than share the source's.
    updateYogaChildren();
    // The rebuilt boxes start with NO inherited text attributes, and waiting
    // for the next configure pass to stamp them is NOT enough: this clone can
    // be created DURING the layout walk itself — the walk clones nodes to
    // write layout metrics — which runs after the pass's configure already
    // finished, and `updateTextRunStateIfNeeded` then publishes the fresh
    // boxes' DEFAULT attributes in that same pass. On screen: whole runs of
    // text drop to 14pt black system font until some later pass happens to
    // repair them — the "text loses its font styling on re-render" bug.
    // The cascade this node received is right here (the constructor copied
    // it), so stamp the rebuilt boxes with it NOW, exactly as
    // configureYogaTree's anonymous-box pass would.
    if (ReactNativeFeatureFlags::enableStringChildren()) {
      // The cascade this node received lives on the SOURCE's boxes (they are
      // the consumers that store it); the rebuilt boxes take it from there.
      const auto& sourceNode =
          static_cast<const YogaLayoutableShadowNode&>(sourceShadowNode);
      std::shared_ptr<const TextAttributes> cascade =
          defaultCascadeTextAttributes();
      for (const auto& oldBox : sourceNode.anonymousTextContentChildren_) {
        if (const auto* oldLayoutable =
                YogaLayoutableShadowNode::asYogaLayoutable(*oldBox)) {
          if (const auto* stored = oldLayoutable->getStoredCascade()) {
            cascade = *stored;
            break;
          }
        }
      }
      for (const auto& box : anonymousTextContentChildren_) {
        auto* layoutableBox = YogaLayoutableShadowNode::asYogaLayoutable(*box);
        if (layoutableBox == nullptr) {
          continue;
        }
        auto& mutableBox =
            const_cast<YogaLayoutableShadowNode&>(*layoutableBox);
        mutableBox.receivedTextAttributes_ = cascade;
        mutableBox.setInheritedCascade(cascade);
      }
    }

    // Belt and braces: still force a reconfigure so the next pass re-runs the
    // full cascade over the rebuilt boxes (markers, list depth).
    yogaTreeHasBeenConfigured_ = false;
  }

  ensureConsistency();
}

void YogaLayoutableShadowNode::completeClone(
    const ShadowNode& /*sourceShadowNode*/,
    const ShadowNodeFragment& fragment) {
  if (getTraits().check(ShadowNodeTraits::Trait::MeasurableYogaNode) &&
      // New children means we must always dirty to visit. Otherwise, ask the
      // Node if the new revision invalidates measurement.
      (fragment.children ||
       shouldNewRevisionDirtyMeasurement(*this, fragment))) {
    yogaNode_.setDirty(true);
  }
}

void YogaLayoutableShadowNode::dirtyLayout() {
  yogaNode_.setDirty(true);
}

bool YogaLayoutableShadowNode::getIsLayoutClean() const {
  return !YGNodeIsDirty(&yogaNode_);
}

#pragma mark - Mutating Methods

void YogaLayoutableShadowNode::enableMeasurement() {
  ensureUnsealed();

  YGNodeSetMeasureFunc(
      &yogaNode_, YogaLayoutableShadowNode::yogaNodeMeasureCallbackConnector);
}

void YogaLayoutableShadowNode::appendYogaChild(
    const YogaLayoutableShadowNode::Shared& childNode) {
  // The caller must check this before calling this method.
  react_native_assert(
      !getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode));

  ensureYogaChildrenLookFine();

  yogaLayoutableChildren_.push_back(childNode);
  yogaNode_.insertChild(&childNode->yogaNode_, YGNodeGetChildCount(&yogaNode_));

  ensureYogaChildrenLookFine();
}

void YogaLayoutableShadowNode::adoptYogaChild(size_t index) {
  ensureUnsealed();
  ensureYogaChildrenLookFine();

  // The caller must check this before calling this method.
  react_native_assert(
      !getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode));

  auto& childNode =
      *YogaLayoutableShadowNode::asYogaLayoutable(*getChildren().at(index));

  if (YGNodeGetOwner(&childNode.yogaNode_) == nullptr) {
    // The child node is not owned.
    childNode.yogaNode_.setOwner(&yogaNode_);
    // At this point the child yoga node must be already inserted by the caller.
    // react_native_assert(layoutableChildNode.yogaNode_.isDirty());
  } else {
    // The child is owned by some other node, we need to clone that.
    // TODO: At this point, React has wrong reference to the node. (T138668036)
    auto clonedChildNode = childNode.clone({});

    // Replace the child node with a newly cloned one in the children list.
    replaceChild(childNode, clonedChildNode, index);
  }

  ensureYogaChildrenLookFine();
}

void YogaLayoutableShadowNode::appendChild(
    const std::shared_ptr<const ShadowNode>& childNode) {
  ensureUnsealed();
  ensureConsistency();

  // Calling the base class (`ShadowNode`) method.
  LayoutableShadowNode::appendChild(childNode);

  if (getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode)) {
    // This node is a declared leaf.
    return;
  }

  if (ReactNativeFeatureFlags::enableStringChildren() &&
      getAnonymousTextContentFactory() != nullptr &&
      // Inline-level content of EITHER kind means this container's Yoga
      // children need rebuilding with anonymous boxes. Testing only
      // `isInlineTextContent` here meant a run made *entirely* of atomic
      // inlines never flagged the rebuild, so the boxes were appended as
      // ordinary block-level children and stacked vertically; a single space
      // anywhere in the run flipped the condition and fixed the whole run,
      // which is why it read as a bug about text.
      //
      // In a flex container an inline-level box is blockified instead
      // (css-display-3 §2.7). Flagging the rebuild there is harmless:
      // `configureYogaTree` re-runs and takes the same blockifying path.
      (isInlineLevelContent(*childNode) ||
       !anonymousTextContentChildren_.empty())) {
    // Inline-level content joined (or its runs may have shifted). The Yoga
    // children need rebuilding with fresh anonymous boxes — but doing it per
    // append is O(children) each and O(n²) for the whole construction, so it
    // is deferred: one rebuild, at the start of the next configure pass.
    yogaNode_.setDirty(true);
    yogaChildrenNeedInlineRebuild_ = true;
    // Inline content means anonymous boxes will exist — consumers. The
    // dependents bit is normally computed by the (now deferred) rebuild, but
    // ancestors OR it in as they adopt this node, which happens before the
    // deferred rebuild runs; it must be visible immediately.
    traits_.set(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
    return;
  }

  if (yogaChildrenNeedInlineRebuild_) {
    // A pending rebuild covers this child's yoga plumbing — but its cascade
    // dependents must surface now, for the same adoption-ordering reason.
    if (ReactNativeFeatureFlags::enableStringChildren()) {
      if (const auto* layoutableChild =
              YogaLayoutableShadowNode::asYogaLayoutable(*childNode)) {
        const auto childTraits = layoutableChild->getTraits();
        if (!childTraits.check(ShadowNodeTraits::Trait::InheritanceBoundary) &&
            (childTraits.check(ShadowNodeTraits::Trait::TextCascadeConsumer) ||
             childTraits.check(
                 ShadowNodeTraits::Trait::SubtreeHasCascadeDependents))) {
          traits_.set(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
        }
      }
    }
    return;
  }

  if (auto yogaLayoutableChild =
          YogaLayoutableShadowNode::asYogaLayoutable(childNode)) {
    // Here we don't have information about the previous structure of the node
    // (if it that existed before), so we don't have anything to compare the
    // Yoga node with (like a previous version of this node). Therefore we must
    // dirty the node.
    yogaNode_.setDirty(true);

    // Appending the Yoga node.
    appendYogaChild(yogaLayoutableChild);

    ensureYogaChildrenLookFine();
    ensureYogaChildrenAlignment();

    // Adopting the Yoga node.
    adoptYogaChild(getChildren().size() - 1);

    // Fabric appends children one by one after construction, so the
    // cascade-dependents bit computed by updateYogaChildren (which ran with no
    // children) must be OR-ed in here. Appends only add — the full recompute
    // on any children-changing clone handles removal.
    if (ReactNativeFeatureFlags::enableStringChildren() &&
        !getTraits().check(
            ShadowNodeTraits::Trait::SubtreeHasCascadeDependents)) {
      const auto childTraits = yogaLayoutableChild->getTraits();
      if (!childTraits.check(ShadowNodeTraits::Trait::InheritanceBoundary) &&
          (childTraits.check(ShadowNodeTraits::Trait::TextCascadeConsumer) ||
           childTraits.check(
               ShadowNodeTraits::Trait::SubtreeHasCascadeDependents))) {
        traits_.set(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
      }
    }

    ensureConsistency();
  }
}

void YogaLayoutableShadowNode::replaceChild(
    const ShadowNode& oldChild,
    const std::shared_ptr<const ShadowNode>& newChild,
    size_t suggestedIndex) {
  LayoutableShadowNode::replaceChild(oldChild, newChild, suggestedIndex);

  ensureUnsealed();
  ensureYogaChildrenLookFine();

  auto layoutableOldChild =
      YogaLayoutableShadowNode::asYogaLayoutable(oldChild);
  auto layoutableNewChild =
      YogaLayoutableShadowNode::asYogaLayoutable(newChild);

  if (layoutableOldChild == nullptr && layoutableNewChild == nullptr) {
    // No need to mutate yogaLayoutableChildren_
    return;
  }

  bool suggestedIndexAccurate = suggestedIndex >= 0 &&
      suggestedIndex < yogaLayoutableChildren_.size() &&
      yogaLayoutableChildren_[suggestedIndex].get() == layoutableOldChild;

  auto oldChildIter = suggestedIndexAccurate
      ? yogaLayoutableChildren_.begin() + suggestedIndex
      : std::find_if(
            yogaLayoutableChildren_.begin(),
            yogaLayoutableChildren_.end(),
            [&](const YogaLayoutableShadowNode::Shared& layoutableChild) {
              return layoutableChild.get() == layoutableOldChild;
            });
  auto oldChildIndex = oldChildIter - yogaLayoutableChildren_.begin();

  if (oldChildIter == yogaLayoutableChildren_.end()) {
    // oldChild does not exist as part of our node
    return;
  }

  if (layoutableNewChild) {
    // Both children are layoutable, replace the old one with the new one
    react_native_assert(
        YGNodeGetOwner(&layoutableNewChild->yogaNode_) == nullptr);
    layoutableNewChild->yogaNode_.setOwner(&yogaNode_);
    yogaNode_.replaceChild(&layoutableNewChild->yogaNode_, oldChildIndex);
    *oldChildIter = layoutableNewChild;
  } else {
    // Layoutable child replaced with non layoutable child. Remove the
    // previous child from the layoutable children list.
    yogaNode_.removeChild(oldChildIndex);
    yogaLayoutableChildren_.erase(oldChildIter);
  }

  ensureYogaChildrenLookFine();
}

bool YogaLayoutableShadowNode::doesOwn(
    const YogaLayoutableShadowNode& child) const {
  return YGNodeGetOwner(&child.yogaNode_) == &yogaNode_;
}

bool YogaLayoutableShadowNode::shouldNewRevisionDirtyMeasurement(
    const ShadowNode& /*sourceShadowNode*/,
    const ShadowNodeFragment& /*fragment*/) const {
  return true;
}

// Detects the ABA scenario where a freshly-allocated `yogaNode_` happens
// to land at the same address a previous parent occupied. After such a
// realloc, any Yoga child whose owner pointer still equals `&yogaNode_`
// is a stale match — yoga would mistake it for "owned by us" and skip the
// clone-on-write check. We rewrite those spurious owner pointers to a
// recognisable sentinel so the next `YGNodeGetOwner(child) == this` check
// correctly returns false and yoga clones the child as it would for any
// foreign tree.
//
// No-op in the common case: right after a clone, children's owner
// pointers still reference the source node, not us.
void YogaLayoutableShadowNode::updateYogaChildrenOwnersIfNeeded() {
  // Magic constant intentionally recognisable in debuggers when the address
  // pops up. `reinterpret_cast` is not constexpr, so this is a runtime-
  // initialised function-local static.
  // NOLINTBEGIN(cppcoreguidelines-pro-type-reinterpret-cast)
  static auto* const kDetachedYogaNodeOwnerSentinel =
      reinterpret_cast<yoga::Node*>(0xBADC0FFEE0DDF00DULL);
  // NOLINTEND(cppcoreguidelines-pro-type-reinterpret-cast)
  for (auto& childYogaNode : yogaNode_.getChildren()) {
    if (YGNodeGetOwner(childYogaNode) == &yogaNode_) {
      childYogaNode->setOwner(kDetachedYogaNodeOwnerSentinel);
    }
  }
}

void YogaLayoutableShadowNode::updateYogaChildren() {
  if (getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode)) {
    return;
  }

  ensureUnsealed();
  yogaChildrenNeedInlineRebuild_ = false;

  const auto stringChildrenEnabled =
      ReactNativeFeatureFlags::enableStringChildren() &&
      getAnonymousTextContentFactory() != nullptr;

  bool isClean = !YGNodeIsDirty(&yogaNode_) &&
      getChildren().size() == YGNodeGetChildCount(&yogaNode_);

  auto oldYogaChildren =
      isClean ? yogaNode_.getChildren() : std::vector<yoga::Node*>{};

  /*
   * Which children are SHARED WITH ANOTHER TREE, recorded before the detach
   * below erases the evidence.
   *
   * `adoptYogaChild` clones a child whose yoga node is owned by another node —
   * that is the guard that makes structural sharing safe — but it recognises
   * such a child BY its owner, and `setChildren({})` resets every owner to
   * null. A child carried over from the previous commit (sealed, shared with
   * the committed tree) then re-adopts through the "not owned" fast path, its
   * yoga node ends up in this parent, and the next layout writes metrics into
   * the OTHER TREE'S node: an `Attempt to mutate a sealed object` abort in
   * Debug — the image-events demo took the whole app down with it — and
   * silently corrupted old-tree metrics in Release, where the seal is
   * compiled out. Only this rebuild path has the detach-first ordering, so
   * only it needs the memory.
   */
  std::unordered_set<const yoga::Node*> childrenSharedWithAnotherTree;
  for (const auto& childToScan : getChildren()) {
    // Dereferenced: the shared_ptr overload would take a reference on every
    // child and drop it again, two atomic operations apiece, to read a pointer
    // this scan only compares.
    if (const auto* yogaChildToScan =
            YogaLayoutableShadowNode::asYogaLayoutable(*childToScan)) {
      const auto* owner = YGNodeGetOwner(&yogaChildToScan->yogaNode_);
      if (owner != nullptr && owner != &yogaNode_) {
        childrenSharedWithAnotherTree.insert(&yogaChildToScan->yogaNode_);
      }
    }
  }

  yogaNode_.setChildren({});
  yogaLayoutableChildren_.clear();
  anonymousTextContentChildren_.clear();
  anonymousTextContentChildIndices_.clear();
  yogaLayoutableChildren_.reserve(getChildren().size());

  // Contiguous inline-level content (text nodes; inline text elements get
  // blockified into their own single-node runs per css-flexbox-1 §4) is
  // wrapped in anonymous boxes established by the text module's factory.
  // `mountedChildCount` tracks how many block-level (mounted) children precede
  // the run being flushed, so the mounting layer can interleave the per-run
  // paint views with mounted children in document order (§3.B).
  int mountedChildCount = 0;
  std::vector<std::shared_ptr<const ShadowNode>> inlineRun;
  auto flushInlineRun = [&]() {
    if (!inlineRun.empty()) {
      // Structural invariant: a run contains inline-level content and nothing
      // else. A block-level child in here would be laid out by the text engine
      // as though it were part of a line, which produces geometry that looks
      // plausible and is wrong — and it is the shape a mis-written
      // "is this inline?" test creates, which is the mistake this whole
      // classification has made three times.
      // `maybe_unused`: the assertion below is the only reader, and it
      // compiles away in production builds.
      for ([[maybe_unused]] const auto& runChild : inlineRun) {
        react_native_assert(
            isInlineLevelContent(*runChild) &&
            "only inline-level content may join an inline run");
      }
      appendAnonymousTextContentChild(std::move(inlineRun), mountedChildCount);
      inlineRun.clear();
      isClean = false;
    }
  };

  const bool containerIsBlock =
      static_cast<const YogaStylableProps&>(*props_).displayBlock;

  for (size_t i = 0; i < getChildren().size(); i++) {
    // An inline *replaced* element (e.g. <img>) is layoutable but flows inside
    // the current run as an attachment, never as a block Yoga child
    // (text-children-plan.md §3.C). It still mounts (differ-driven) and is
    // positioned by the owning View's attachment-layout pass.
    //
    // In a BLOCK container only. A flex container blockifies its inline-level
    // children into flex items (css-flexbox-1 §4, css-display-3 §2.7), so an
    // <img> in a flex row is an ordinary item that honours `gap` and
    // `alignItems`. This branch used to fire unconditionally, and the mistake
    // was invisible on iOS — expo-image's shadow node does not declare the
    // trait, so only Android's framework-backed <img> took the run path: three
    // images in a `gap: 12` row rendered TOUCHING and baseline-bottom on one
    // platform and correctly spaced on the other, from identical C++.
    // The trait states the element's UA default, not an unconditional fate:
    // an author `display: 'block'` blockifies an inline replaced element out
    // of inline flow (css-display-3 §2), and it lays out as an ordinary
    // block-level Yoga child below — which is also what lets <img>'s
    // box-chrome composite fill its wrapper's content box by flex.
    if (stringChildrenEnabled && containerIsBlock &&
        getChildren()[i]->getTraits().check(
            ShadowNodeTraits::Trait::InlineReplaced) &&
        !authorDisplayBlockifies(*getChildren()[i])) {
      inlineRun.push_back(getChildren()[i]);
      continue;
    }
    if (auto yogaLayoutableChild =
            YogaLayoutableShadowNode::asYogaLayoutable(getChildren()[i])) {
      const auto isBlockContainer = containerIsBlock;
      if (stringChildrenEnabled && isBlockContainer &&
          isInlineLevelBox(*yogaLayoutableChild)) {
        // `display:'inline'` element in a block container: an inline-level
        // box that joins the current run, never a block-level Yoga child —
        // either an *atomic* inline (an inline attachment like the replaced
        // `<img>`) or, when un-sized with all-inline contents, a *span-like*
        // inline box whose contents flow into the run
        // (isInlineFlowContent). In flex containers it falls through below
        // and is blockified into a regular flex item (css-display-3 §2.7).
        inlineRun.push_back(getChildren()[i]);
        continue;
      }
      // Box-generation rules for run contiguity (each verified against
      // Safari): a `display:'none'` child generates NO box and never
      // interrupts inline content — the surrounding text runs stay contiguous
      // in both block and flex containers. An absolutely-positioned child is
      // out-of-flow: in a block container it does not interrupt the IFC
      // (CSS2 §9.2.1.1 anonymous boxes form around in-flow block-level boxes
      // only), but in a flex container it DOES separate text-run sequences
      // (css-flexbox-1 §4). Either way the child remains an ordinary Yoga
      // child (Display::None is skipped by layout; absolute children are
      // positioned by absolute layout), only the run flush is skipped.
      const auto& childStyle =
          static_cast<const YogaStylableProps&>(*yogaLayoutableChild->props_)
              .yogaStyle;
      const bool interruptsInlineContent = !stringChildrenEnabled ||
          !(childStyle.display() == yoga::Display::None ||
            (isBlockContainer &&
             childStyle.positionType() == yoga::PositionType::Absolute));
      if (interruptsInlineContent) {
        flushInlineRun();
      }
      // Empty is the ordinary case — no child belongs to another tree — and
      // testing it first skips hashing a pointer per child.
      if (!childrenSharedWithAnotherTree.empty() &&
          childrenSharedWithAnotherTree.count(&yogaLayoutableChild->yogaNode_) !=
              0) {
        // See the note above the detach: this child belongs to another tree,
        // and the detach hid that from `adoptYogaChild`. Clone it here, with
        // the same fragment `cloneChildInPlace` uses, so the adoption below
        // takes the fresh copy.
        auto clonedChild = yogaLayoutableChild->clone(
            {.props = ShadowNodeFragment::propsPlaceholder(),
             .children = ShadowNodeFragment::childrenPlaceholder(),
             .state = yogaLayoutableChild->getState()});
        replaceChild(*yogaLayoutableChild, clonedChild, static_cast<ssize_t>(i));
        yogaLayoutableChild =
            YogaLayoutableShadowNode::asYogaLayoutable(getChildren()[i]);
      }
      appendYogaChild(yogaLayoutableChild);
      adoptYogaChild(i);
      mountedChildCount++;

      if (isClean) {
        auto yogaChildIndex = yogaLayoutableChildren_.size() - 1;
        auto& oldYogaChildNode = *oldYogaChildren.at(yogaChildIndex);
        auto& newYogaChildNode =
            yogaLayoutableChildren_.at(yogaChildIndex)->yogaNode_;

        isClean = isClean && !newYogaChildNode.isDirty() &&
            (newYogaChildNode.style() == oldYogaChildNode.style());
      }
    } else if (stringChildrenEnabled && isInlineTextContent(*getChildren()[i])) {
      const auto& child = getChildren()[i];
      const auto isBlockContainer =
          static_cast<const YogaStylableProps&>(*props_).displayBlock;
      const std::string_view childComponentName{child->getComponentName()};
      if (isBlockContainer || childComponentName == "#text" ||
          child->getTraits().check(ShadowNodeTraits::Trait::InlineReplaced)) {
        // Text runs always join the current run; in block containers inline
        // *elements* join it too (single inline formatting context,
        // CSS2 §9.2.1.1). An inline replaced element always flows inside the
        // run as an attachment, never blockified (text-children-plan.md §3.C).
        inlineRun.push_back(child);
      } else {
        // Inline text *element* in a flex container: blockified into its own
        // anonymous item, exactly as on web (css-flexbox-1 §4).
        flushInlineRun();
        inlineRun.push_back(child);
        flushInlineRun();
      }
    }
  }
  flushInlineRun();

  if (!anonymousTextContentChildren_.empty()) {
    // Text-bearing containers paint their runs and must not be flattened
    // away by view flattening (text-children-plan.md §3.B).
    traits_.set(ShadowNodeTraits::Trait::FormsView);
    traits_.set(ShadowNodeTraits::Trait::FormsStackingContext);
  }

  /*
   * An anonymous box exists to keep inline content apart from block-level
   * SIBLINGS (CSS2 §9.2.1.1). A block container whose children are all inline
   * has no such siblings — its inline content forms line boxes in the
   * container itself — so the box is a node with no job: a shadow node, a Yoga
   * node, and a configure pass per text-bearing container.
   *
   * Measure the run on this node instead and keep the box off the Yoga tree.
   * It stays alive as the run's content object (painting, attachments and the
   * cascade all still go through it), it simply stops being laid out
   * separately.
   */
  measuresOwnInlineRun_ = false;
  if (ReactNativeFeatureFlags::enableStringChildren() && containerIsBlock &&
      anonymousTextContentChildren_.size() == 1 &&
      yogaLayoutableChildren_.size() == 1 &&
      yogaLayoutableChildren_[0] == anonymousTextContentChildren_[0]) {
    yogaNode_.setChildren({});
    yogaLayoutableChildren_.clear();
    measuresOwnInlineRun_ = true;
    enableMeasurement();
    YGNodeSetBaselineFunc(
        &yogaNode_, YogaLayoutableShadowNode::yogaNodeBaselineCallbackConnector);
  } else if (
      !getTraits().check(ShadowNodeTraits::Trait::MeasurableYogaNode) &&
      YGNodeHasMeasureFunc(&yogaNode_)) {
    // The container measured its own run on a previous revision and no longer
    // qualifies; Yoga forbids a measure function on a node with children.
    YGNodeSetMeasureFunc(&yogaNode_, nullptr);
  }

  react_native_assert(
      yogaLayoutableChildren_.size() == YGNodeGetChildCount(&yogaNode_));

  yogaNode_.setDirty(!isClean);
  // Element-tree cascade dependents (string-children-perf-plan.md, lever 1):
  // a node has cascade dependents when some consumer below it — a paragraph
  // or an anonymous IFC box — actually inherits through it. A child that is
  // an inheritance boundary contributes nothing: its subtree restarts from
  // the defaults and cannot observe this node's cascade. When the bit is
  // unset, an inheritable-prop change here dirties nothing and the cascade
  // never walks in.
  if (ReactNativeFeatureFlags::enableStringChildren()) {
    bool hasDependents = !anonymousTextContentChildren_.empty();
    if (!hasDependents) {
      for (const auto& child : yogaLayoutableChildren_) {
        const auto childTraits = child->getTraits();
        if (childTraits.check(ShadowNodeTraits::Trait::InheritanceBoundary)) {
          continue;
        }
        if (childTraits.check(ShadowNodeTraits::Trait::TextCascadeConsumer) ||
            childTraits.check(
                ShadowNodeTraits::Trait::SubtreeHasCascadeDependents)) {
          hasDependents = true;
          break;
        }
      }
    }
    if (hasDependents) {
      traits_.set(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
    } else {
      traits_.unset(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
    }
  }

}

static YogaLayoutableShadowNode::AnonymousTextContentFactory&
anonymousTextContentFactorySingleton() {
  static YogaLayoutableShadowNode::AnonymousTextContentFactory factory =
      nullptr;
  return factory;
}

void YogaLayoutableShadowNode::setAnonymousTextContentFactory(
    AnonymousTextContentFactory factory) {
  anonymousTextContentFactorySingleton() = factory;
}

YogaLayoutableShadowNode::AnonymousTextContentFactory
YogaLayoutableShadowNode::getAnonymousTextContentFactory() {
  return anonymousTextContentFactorySingleton();
}

bool YogaLayoutableShadowNode::isInlineTextContent(const ShadowNode& child) {
  // Inline-level text content joins a text run rather than becoming its own block/flex
  // item. Identified by the InlineText trait — set by #text, Text, every inline text
  // intrinsic (<b>/<i>/<span>/<u>/… and the unknown fallback, all TextShadowNode
  // subclasses), and the inline replaced <img>. Using the trait instead of a hardcoded
  // component-name list means a new intrinsic flows inline with no change here, and keeps
  // components/view free of a components/text include dependency.
  return child.getTraits().check(ShadowNodeTraits::Trait::InlineText);
}

static bool isInlineLevelBox(const ShadowNode& child) {
  // An otherwise block-level element opted inline via `display:'inline'`
  // (YogaStylableProps::displayInline). Absolutely-positioned boxes blockify
  // (CSS2 §9.7) and must stay ordinary Yoga children so absolute layout can
  // position them.
  const auto* props =
      dynamic_cast<const YogaStylableProps*>(child.getProps().get());
  return props != nullptr && props->displayInline &&
      props->yogaStyle.positionType() != yoga::PositionType::Absolute;
}

static bool authorDisplayBlockifies(const ShadowNode& child) {
  const auto* props =
      dynamic_cast<const YogaStylableProps*>(child.getProps().get());
  return props != nullptr && props->displayBlock;
}

bool YogaLayoutableShadowNode::isAtomicInline(const ShadowNode& child) {
  return isInlineLevelBox(child) && !isInlineFlowContent(child);
}

bool YogaLayoutableShadowNode::isInlineLevelContent(const ShadowNode& child) {
  // The union, in one place. See the header for why asking for half of this is
  // the mistake that produced three separate layout bugs.
  return isInlineTextContent(child) || isInlineLevelBox(child);
}

bool YogaLayoutableShadowNode::isInlineFlowContent(const ShadowNode& child) {
  // A span-like inline box: `display:'inline'` on an otherwise block-level
  // element whose size is auto and whose contents are all inline-level — its
  // contents flow into the surrounding IFC with its inheritable text props
  // applied, exactly like a <span> (Safari-pinned). A *sized* inline View
  // stays an atomic inline box instead: an RN View is an opaque native box,
  // closer to a replaced element, so the web's "non-replaced inline boxes
  // ignore width/height" rule is deliberately not applied (documented
  // divergence; see StyleSheetTypes.js). Fragment-level box decorations
  // (background/border painted per line fragment) are not painted yet.
  if (!isInlineLevelBox(child)) {
    return false;
  }
  if (YogaLayoutableShadowNode::asYogaLayoutable(child) == nullptr) {
    return false;
  }
  const auto& props =
      static_cast<const YogaStylableProps&>(*child.getProps());
  // `inline-flex`/`inline-block` are inline-level but establish a formatting
  // context, so they are atomic by definition: their contents are flex items /
  // block boxes of their own and can never join the surrounding inline flow.
  if (props.displayInlineAtomic) {
    return false;
  }
  if (!props.yogaStyle.dimension(yoga::Dimension::Width).isAuto() ||
      !props.yogaStyle.dimension(yoga::Dimension::Height).isAuto()) {
    return false;
  }
  for (const auto& grandChild : child.getChildren()) {
    // Inline-level content flows: text/inline elements (trait) and nested
    // inline boxes — span-like flow or atomic (a span containing an <img>
    // flows on web). Block-level content inside an inline box would require
    // block-in-inline splitting (CSS2 §9.2.1.1); such boxes — and ones with
    // absolutely-positioned children — fall back to atomic inline.
    if (!isInlineTextContent(*grandChild) && !isInlineLevelBox(*grandChild)) {
      return false;
    }
  }
  return true;
}

void YogaLayoutableShadowNode::appendAnonymousTextContentChild(
    std::vector<std::shared_ptr<const ShadowNode>>&& runChildren,
    int precedingMountedChildCount) {
  auto box = getAnonymousTextContentFactory()(std::move(runChildren), *this);
  if (box == nullptr) {
    // The run generates no box (e.g. whitespace-only anonymous flex item).
    return;
  }
  // Structural invariant: the factory must produce an anonymous IFC box. The
  // cascade-dirty path (configureYogaTree) and the mounting layer both branch on
  // the AnonymousBox trait, and the box is a Yoga leaf that measures its own text
  // run — a non-anonymous or non-leaf box would silently break text repaint on
  // cascade change or accrue stray Yoga children.
  react_native_assert(box->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox));
  react_native_assert(box->getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode));

  anonymousTextContentChildIndices_.push_back(precedingMountedChildCount);

  if (static_cast<const YogaStylableProps&>(*props_).displayBlock) {
    // Anonymous block boxes always fill the containing block on web; pin
    // stretch so `alignItems` overrides cannot shrink-wrap the text.
    auto boxStyle = box->yogaNode_.style();
    boxStyle.setAlignSelf(yoga::Align::Stretch);
    box->yogaNode_.setStyle(boxStyle);
  } else {
    // In a FLEX container this box is an anonymous flex item (a text-run
    // sequence, or a single blockified inline text element — css-flexbox-1
    // §4), and a flex item's `flex-shrink` initial value is 1 (§7.3). React
    // Native's own default is 0, and an inline TEXT element carries no yoga
    // style to say otherwise (TextProps is not YogaStylable), so without
    // this the item could never yield: a long <label> beside a checkbox in
    // a flex row overflowed and CLIPPED at the row's edge where every
    // browser wraps its text.
    auto boxStyle = box->yogaNode_.style();
    boxStyle.setFlexShrink(yoga::FloatOptional{1.0f});
    box->yogaNode_.setStyle(boxStyle);
  }

  yogaLayoutableChildren_.push_back(box);
  yogaNode_.insertChild(&box->yogaNode_, YGNodeGetChildCount(&yogaNode_));
  box->yogaNode_.setOwner(&yogaNode_);
  // Structural invariant: the box must be a Yoga child of its owning container.
  // Both the container-frame geometry and the run-state publish assume this
  // parentage; a detached/mis-parented box cannot reach layout correctly.
  react_native_assert(box->yogaNode_.getOwner() == &yogaNode_);
  anonymousTextContentChildren_.push_back(std::move(box));
  // Structural invariant: the index vector (document order, used to interleave
  // paint views with mounted children) is parallel to the box vector — they are
  // cleared together and must grow together, or run paint order desyncs.
  react_native_assert(
      anonymousTextContentChildIndices_.size() ==
      anonymousTextContentChildren_.size());
}

void YogaLayoutableShadowNode::updateYogaProps() {
  ensureUnsealed();

  auto& props = static_cast<const YogaStylableProps&>(*props_);
  auto styleResult = applyAliasedProps(props.yogaStyle, props);

  if (ReactNativeFeatureFlags::enableStringChildren() &&
      props.displayBlock) {
    if (ReactNativeFeatureFlags::enableYogaDisplayBlock()) {
      // Native block formatting context: a first-class Yoga display type
      // (text-children-plan.md §3.A/§4.5). Block-level children stack in the
      // block direction with block sizing (not flex items); the block layout
      // algorithm lives in Yoga's CalculateLayout.
      styleResult.setDisplay(yoga::Display::Block);
    } else {
      // Flag-off fallback: block is emulated on Yoga flex primitives —
      // vertical stacking with full-width children.
      styleResult.setFlexDirection(yoga::FlexDirection::Column);
      styleResult.setAlignItems(yoga::Align::Stretch);
    }
  }

  // An inline-level box is shrink-to-fit: its width is its content's, not its
  // container's (CSS2 §10.3.9). Without this an `inline-block` or
  // `inline-flex` box stretches on the cross axis like any other child and
  // fills the line — it measured the full 300pt container against the 20pt of
  // text it holds, so a chip stretched across the line instead of hugging its
  // label. An authored `alignSelf` still wins.
  //
  // Only while BOTH dimensions are auto, because that is the only case
  // stretch can reach. With an explicit size, the forced `FlexStart` was not
  // preventing a stretch — it was silently overriding the CONTAINER'S
  // `alignItems`: three fixed-size `<img>`s in an `alignItems: 'flex-end'`
  // row pinned to the TOP on both platforms while the same markup in a
  // browser sat them on the bottom, because a blockified flex item with a
  // fixed cross size aligns exactly as its container says (css-flexbox-1 §4).
  if (ReactNativeFeatureFlags::enableStringChildren() &&
      props.displayInlineAtomic &&
      styleResult.alignSelf() == yoga::Align::Auto &&
      styleResult.dimension(yoga::Dimension::Width).isAuto() &&
      styleResult.dimension(yoga::Dimension::Height).isAuto()) {
    styleResult.setAlignSelf(yoga::Align::FlexStart);
  }

  // Resetting `dirty` flag only if `yogaStyle` portion of `Props` was
  // changed.
  if (!YGNodeIsDirty(&yogaNode_) && (styleResult != yogaNode_.style())) {
    yogaNode_.setDirty(true);
  }

  yogaNode_.setStyle(styleResult);
  if (getTraits().check(ShadowNodeTraits::ViewKind)) {
    auto& viewProps = static_cast<const ViewProps&>(*props_);
    // https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block
    bool alwaysFormsContainingBlock =
        viewProps.transform != Transform::Identity() ||
        !viewProps.filter.empty();
    YGNodeSetAlwaysFormsContainingBlock(&yogaNode_, alwaysFormsContainingBlock);
  }

  if (YGNodeStyleGetDisplay(&yogaNode_) == YGDisplayContents) {
    ShadowNode::traits_.set(ShadowNodeTraits::ForceFlattenView);
  } else {
    ShadowNode::traits_.unset(ShadowNodeTraits::ForceFlattenView);
  }
}

/*static*/ yoga::Style YogaLayoutableShadowNode::applyAliasedProps(
    const yoga::Style& baseStyle,
    const YogaStylableProps& props) {
  yoga::Style result{baseStyle};

  // Aliases with precedence
  if (props.insetInlineEnd.isDefined()) {
    result.setPosition(yoga::Edge::End, props.insetInlineEnd);
  }
  if (props.insetInlineStart.isDefined()) {
    result.setPosition(yoga::Edge::Start, props.insetInlineStart);
  }
  if (props.marginInline.isDefined()) {
    result.setMargin(yoga::Edge::Horizontal, props.marginInline);
  }
  if (props.marginInlineStart.isDefined()) {
    result.setMargin(yoga::Edge::Start, props.marginInlineStart);
  }
  if (props.marginInlineEnd.isDefined()) {
    result.setMargin(yoga::Edge::End, props.marginInlineEnd);
  }
  if (props.marginBlock.isDefined()) {
    result.setMargin(yoga::Edge::Vertical, props.marginBlock);
  }
  if (props.paddingInline.isDefined()) {
    result.setPadding(yoga::Edge::Horizontal, props.paddingInline);
  }
  if (props.paddingInlineStart.isDefined()) {
    result.setPadding(yoga::Edge::Start, props.paddingInlineStart);
  }
  if (props.paddingInlineEnd.isDefined()) {
    result.setPadding(yoga::Edge::End, props.paddingInlineEnd);
  }
  if (props.paddingBlock.isDefined()) {
    result.setPadding(yoga::Edge::Vertical, props.paddingBlock);
  }

  // Aliases without precedence
  if (result.position(yoga::Edge::Bottom).isUndefined()) {
    result.setPosition(yoga::Edge::Bottom, props.insetBlockEnd);
  }
  if (result.position(yoga::Edge::Top).isUndefined()) {
    result.setPosition(yoga::Edge::Top, props.insetBlockStart);
  }
  if (result.margin(yoga::Edge::Top).isUndefined()) {
    result.setMargin(yoga::Edge::Top, props.marginBlockStart);
  }
  if (result.margin(yoga::Edge::Bottom).isUndefined()) {
    result.setMargin(yoga::Edge::Bottom, props.marginBlockEnd);
  }
  if (result.padding(yoga::Edge::Top).isUndefined()) {
    result.setPadding(yoga::Edge::Top, props.paddingBlockStart);
  }
  if (result.padding(yoga::Edge::Bottom).isUndefined()) {
    result.setPadding(yoga::Edge::Bottom, props.paddingBlockEnd);
  }

  return result;
}

namespace {

/*
 * The DOM tag a node reports, or empty for one that does not carry a name.
 */
std::string domNameOf(const ShadowNode& node) {
  const auto* provider = dynamic_cast<const NodeNameProvider*>(node.getProps().get());
  return provider != nullptr ? provider->domNodeName() : std::string{};
}

/*
 * The anonymous IFC box a list item wraps its inline content in, or nullptr if
 * it has none (an item whose content is all block-level, say).
 */
ListMarkerSink* markerSinkOf(const YogaLayoutableShadowNode& item) {
  // An item whose content is all inline measures its own run, and its box is
  // not among the Yoga children at all.
  if (item.measuresOwnInlineRun() &&
      item.getAnonymousTextContentChildren().size() == 1) {
    return const_cast<ListMarkerSink*>(dynamic_cast<const ListMarkerSink*>(
        item.getAnonymousTextContentChildren()[0].get()));
  }
  // Otherwise the anonymous IFC box is a Yoga child, never a shadow-tree
  // child, so this walks the layoutable children rather than `getChildren()`.
  for (const auto& child : item.getYogaLayoutableChildren()) {
    if (child->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox)) {
      return const_cast<ListMarkerSink*>(
          dynamic_cast<const ListMarkerSink*>(child.get()));
    }
  }
  return nullptr;
}

} // namespace

/*
 * Generates a list item's marker (css-lists-3 §3). This runs on the list
 * CONTAINER, not the item, for one reason: a marker's text depends on the
 * item's position among its siblings, and a shadow node has no parent pointer,
 * so an item cannot count itself. The container has its children in order.
 *
 * It runs before layout, so the marker is part of what the item measures.
 */
void YogaLayoutableShadowNode::assignListMarkerIfNeeded(
    YogaLayoutableShadowNode& child) {
  if (!listContext_.isList) {
    return;
  }
  if (domNameOf(child) != "li") {
    return;
  }

  auto* sink = markerSinkOf(child);
  if (sink == nullptr) {
    // Nothing to put a marker on: the item has no inline content of its own.
    return;
  }

  const auto ordinal = listContext_.nextOrdinal++;
  const auto marker = ListMarker{
      .text = listMarkerText(listContext_.type, ordinal),
      .outside = listContext_.position == ListStylePosition::Outside,
      .symbolic = isSymbolicListStyleType(listContext_.type)};

  if (sink->getListMarker() == marker) {
    return;
  }
  sink->setListMarker(marker);
  // An `inside` marker is measured, so Yoga's cached layout for the box is
  // stale the moment it changes.
  for (const auto& grandChild : child.getChildren()) {
    if (grandChild->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox)) {
      const_cast<YogaLayoutableShadowNode&>(
          static_cast<const YogaLayoutableShadowNode&>(*grandChild))
          .yogaNode_.markDirtyAndPropagate();
    }
  }
}

/*
 * Reads the list properties off this node's own props, once per layout, so the
 * per-child work above is a lookup rather than a parse.
 */
void YogaLayoutableShadowNode::prepareListContext(int depth) {
  listContext_ = ListContext{};
  const auto* boxProps =
      dynamic_cast<const ElementBoxProps*>(getProps().get());
  if (boxProps == nullptr) {
    return;
  }
  const auto name = boxProps->domNodeName();
  const auto ordered = name == "ol";
  // `<menu>` is a list of commands and the HTML Standard renders it exactly
  // as `<ul>` (html.css groups them for both margins and the disc marker) —
  // it was missing from this recognition, so its items generated no markers
  // at all while every stylesheet said `disc`.
  if (!ordered && name != "ul" && name != "menu") {
    return;
  }

  listContext_.isList = true;
  // An unordered list with no authored type takes the UA bullet for its depth
  // — disc, then circle, then square — which is how `ul ul { … }` in a UA
  // stylesheet behaves without needing an ancestor walk.
  const auto fallback =
      ordered ? ListStyleType::Decimal : nestedBulletForDepth(depth);
  listContext_.type =
      listStyleTypeFromString(boxProps->listStyleTypeValue, fallback);
  listContext_.position = listStylePositionFromString(
      boxProps->listStylePositionValue, ListStylePosition::Outside);
  // `<ol start>` seeds the counter; unordered lists always count from 1.
  listContext_.nextOrdinal = ordered ? boxProps->start : 1;
}

void YogaLayoutableShadowNode::configureYogaTree(
    float pointScaleFactor,
    Float fontSizeMultiplier,
    YGErrata defaultErrata,
    bool swapLeftAndRight) {
  ensureUnsealed();

  if (yogaChildrenNeedInlineRebuild_) {
    // The one deferred rebuild for all the inline appends since construction.
    updateYogaChildren();
    ensureConsistency();
  }

  prepareListContext(listDepth_);

  // Set state on our own Yoga node
  YGErrata errata = resolveErrata(defaultErrata);
  YGConfigSetErrata(&yogaConfig_, errata);
  YGConfigSetPointScaleFactor(&yogaConfig_, pointScaleFactor);

  // A measurable node's measurement depends on `fontSizeMultiplier`, but unlike
  // `pointScaleFactor` it is not part of the Yoga config, so a change does not
  // invalidate Yoga's layout cache. Dirty the node when it changes to force
  // re-measurement. We propagate up to the root so an unchanged, still-cached
  // ancestor isn't skipped by `calculateLayoutInternal` before reaching us.
  if (ReactNativeFeatureFlags::enableFontScaleChangesUpdatingLayout() &&
      getTraits().check(ShadowNodeTraits::Trait::MeasurableYogaNode) &&
      !floatEquality(
          getLayoutMetrics().fontSizeMultiplier, fontSizeMultiplier)) {
    yogaNode_.markDirtyAndPropagate();
  }

  // TODO: `swapLeftAndRight` modified backing props and cannot be undone
  if (swapLeftAndRight) {
    swapStyleLeftAndRight();
  }

  yogaTreeHasBeenConfigured_ = true;

  // Element-tree cascade of inheritable text attributes
  // (text-children-plan.md §3.D): fold this node's inheritable props into the
  // effective attributes assigned by our parent, then hand the result to
  // children below.
  // The effective cascade at this node: derived locally from what the parent
  // handed down, folded with this node's own inheritable props. Nothing but
  // consumers stores it (setInheritedCascade below); Views carry only the
  // 8-byte received memo the change-detection compares against.
  // Read once: the getter is a cross-module call ending in a
  // sequentially-consistent atomic load, and the child loop below asks per
  // child.
  const bool stringChildrenEnabled =
      ReactNativeFeatureFlags::enableStringChildren();

  auto effectiveCascade = receivedTextAttributes_;
  if (stringChildrenEnabled) {
    if (const auto* baseViewProps = props_->asBaseViewProps();
        baseViewProps != nullptr && baseViewProps->hasInheritedTextProps) {
      // Copy-on-write: only a node that actually carries inheritable props
      // establishes a new cascade object; everyone else keeps sharing.
      auto next = std::make_shared<TextAttributes>(*effectiveCascade);
      baseViewProps->applyInheritedTextAttributes(*next);
      effectiveCascade = std::move(next);
    }
    if (getTraits().check(ShadowNodeTraits::Trait::TextCascadeConsumer)) {
      setInheritedCascade(effectiveCascade);
    }
  }

  // Recursively propagate the configuration to child nodes. If a child was
  // already configured as part of a previous ShadowTree generation, we only
  // need to reconfigure it if the context values passed to the Node have
  // changed.
  for (size_t i = 0; i < yogaLayoutableChildren_.size(); i++) {
    const auto& child = *yogaLayoutableChildren_[i];
    auto childLayoutMetrics = child.getLayoutMetrics();
    auto childErrata = YGConfigGetErrata(&child.yogaConfig_);

    // The layout-context skip guard below is not enough on its own: when an
    // ancestor's inheritable text prop changes but a descendant subtree is
    // otherwise unchanged (same props, same layout context), we must still
    // push the new cascade value down to its anonymous IFC boxes. Detect a
    // changed cascade by comparing against what we handed this child last time
    // (text-children-plan.md §3.D).
    // Boundary and dependents gating (string-children-perf-plan.md, lever 1 +
    // the `all` boundary): a boundary child restarts from the defaults — hand
    // it those — and a child with no consumer anywhere below it has nothing
    // that could observe the cascade, so it neither compares nor receives.
    const auto childTraits = child.getTraits();
    const bool childIsBoundary =
        childTraits.check(ShadowNodeTraits::Trait::InheritanceBoundary);
    const auto& cascadeForChild = childIsBoundary
        ? defaultCascadeTextAttributes()
        : effectiveCascade;
    const bool childObservesCascade = childIsBoundary ||
        childTraits.check(ShadowNodeTraits::Trait::TextCascadeConsumer) ||
        childTraits.check(ShadowNodeTraits::Trait::SubtreeHasCascadeDependents);
    const bool cascadeChanged = stringChildrenEnabled &&
        childObservesCascade &&
        child.receivedTextAttributes_ != cascadeForChild &&
        !(*child.receivedTextAttributes_ == *cascadeForChild);

    if (child.yogaTreeHasBeenConfigured_ && !cascadeChanged &&
        childLayoutMetrics.pointScaleFactor == pointScaleFactor &&
        floatEquality(
            childLayoutMetrics.fontSizeMultiplier, fontSizeMultiplier) &&
        childLayoutMetrics.wasLeftAndRightSwapped == swapLeftAndRight &&
        childErrata == child.resolveErrata(errata)) {
      continue;
    }

    if (doesOwn(child)) {
      auto& mutableChild = const_cast<YogaLayoutableShadowNode&>(child);
      if (childObservesCascade) {
        mutableChild.receivedTextAttributes_ = cascadeForChild;
      }
      // Nesting depth, so a nested `<ul>` can take the next UA bullet without
      // walking ancestors it has no pointer to.
      mutableChild.listDepth_ = listDepth_ + (listContext_.isList ? 1 : 0);
      // An anonymous IFC box measures and paints from the cascade. A cascade
      // change that does not alter size (e.g. `color`) leaves Yoga's cached
      // layout valid, so the box would never be revisited and its containing
      // View would never republish the run. Dirty it to force a re-measure and
      // a state republish with the new attributes.
      if (cascadeChanged &&
          mutableChild.getTraits().check(
              ShadowNodeTraits::Trait::AnonymousBox)) {
        mutableChild.yogaNode_.markDirtyAndPropagate();
      }
      mutableChild.configureYogaTree(
          pointScaleFactor,
          fontSizeMultiplier,
          child.resolveErrata(errata),
          swapLeftAndRight);
    } else {
      auto& clonedChild = cloneChildInPlace(i);
      if (childObservesCascade) {
        clonedChild.receivedTextAttributes_ = cascadeForChild;
      }
      clonedChild.listDepth_ = listDepth_ + (listContext_.isList ? 1 : 0);
      clonedChild.configureYogaTree(
          pointScaleFactor, fontSizeMultiplier, errata, swapLeftAndRight);
    }
  }

  // An elided anonymous box is not among the Yoga children the loop above
  // walks, so it would never be configured and the cascade would stop dead at
  // the container: its text would fall back to the default font. Configure it
  // here with the cascade its container resolved.
  if (measuresOwnInlineRun_ && anonymousTextContentChildren_.size() == 1) {
    auto& box = *anonymousTextContentChildren_[0];
    box.ensureUnsealed();
    box.receivedTextAttributes_ = effectiveCascade;
    box.listDepth_ = listDepth_ + (listContext_.isList ? 1 : 0);
    box.configureYogaTree(
        pointScaleFactor, fontSizeMultiplier, errata, swapLeftAndRight);
  }

  // Markers are assigned in a second pass, once every child is configured: the
  // anonymous box a marker attaches to is created during the child's own
  // configuration, and the loop above deliberately skips children whose
  // configuration is unchanged — which would drop items out of the count.
  // An anonymous IFC box is a Yoga LEAF: the inline content it wraps —
  // including atomic inlines like `inline-block` and `<img>` — hangs off it as
  // SHADOW children, never as Yoga children. The loop above walks
  // `yogaLayoutableChildren_`, so without this the cascade stopped dead at the
  // anonymous box and an atomic inline's text fell back to the default font,
  // rendering visibly smaller than the text around it.
  if (ReactNativeFeatureFlags::enableStringChildren() &&
      getTraits().check(ShadowNodeTraits::Trait::AnonymousBox)) {
    for (const auto& child : getChildren()) {
      auto* layoutableChild =
          YogaLayoutableShadowNode::asYogaLayoutable(*child);
      if (layoutableChild == nullptr) {
        continue;
      }
      auto& mutableChild =
          const_cast<YogaLayoutableShadowNode&>(*layoutableChild);
      mutableChild.receivedTextAttributes_ = effectiveCascade;
      if (mutableChild.getTraits().check(
              ShadowNodeTraits::Trait::TextCascadeConsumer)) {
        mutableChild.setInheritedCascade(effectiveCascade);
      }
    }
  }

  // Markers are assigned in their own pass, once every child is configured:
  // the anonymous box a marker attaches to is created during the child's own
  // configuration, and the loop above deliberately skips children whose
  // configuration is unchanged — which would drop items out of the count.
  if (listContext_.isList) {
    for (const auto& child : getChildren()) {
      auto* layoutableChild =
          YogaLayoutableShadowNode::asYogaLayoutable(*child);
      if (layoutableChild != nullptr) {
        assignListMarkerIfNeeded(
            const_cast<YogaLayoutableShadowNode&>(*layoutableChild));
      }
    }
  }
}

YGErrata YogaLayoutableShadowNode::resolveErrata(YGErrata defaultErrata) const {
  if (auto layoutConformanceNode =
          dynamic_cast<const LayoutConformanceShadowNode*>(this)) {
    switch (layoutConformanceNode->getConcreteProps().mode) {
      case LayoutConformance::Strict:
        // CSS Flexbox §4.5 automatic minimum sizing is the spec-compliant
        // behaviour, so strict conformance should adopt it — but its probe
        // walks measure callbacks with `AtMost 0`, which can surface latent
        // bugs in platform measure overrides. Gate the rollout behind a
        // feature flag so the behaviour can be ramped independently of strict
        // conformance: when enabled, clear every errata bit (fully
        // spec-compliant); when disabled (default), keep
        // `MinSizeUndefinedInsteadOfAuto` set so strict subtrees preserve
        // today's behaviour and the auto-min probe stays explicitly opt-in
        // via `YogaConfig` setup.
        return ReactNativeFeatureFlags::enableFlexboxAutoMinSizeInStrictMode()
            ? YGErrataNone
            : YGErrataMinSizeUndefinedInsteadOfAuto;
      case LayoutConformance::Compatibility:
        return YGErrataAll;
    }
  }

  return defaultErrata;
}

YogaLayoutableShadowNode& YogaLayoutableShadowNode::cloneChildInPlace(
    size_t layoutableChildIndex) {
  ensureUnsealed();

  const auto& childNode = *yogaLayoutableChildren_[layoutableChildIndex];

  // TODO: Why does this not use `ShadowNodeFragment::statePlaceholder()` like
  // `adoptYogaChild()`?
  auto clonedChildNode = childNode.clone(
      {.props = ShadowNodeFragment::propsPlaceholder(),
       .children = ShadowNodeFragment::childrenPlaceholder(),
       .state = childNode.getState()});

  replaceChild(childNode, clonedChildNode, layoutableChildIndex);
  return static_cast<YogaLayoutableShadowNode&>(*clonedChildNode);
}

void YogaLayoutableShadowNode::setSize(Size size) const {
  ensureUnsealed();

  auto style = yogaNode_.style();
  style.setDimension(
      yoga::Dimension::Width, yoga::StyleSizeLength::points(size.width));
  style.setDimension(
      yoga::Dimension::Height, yoga::StyleSizeLength::points(size.height));
  yogaNode_.setStyle(style);
  yogaNode_.setDirty(true);
}

void YogaLayoutableShadowNode::setPadding(RectangleEdges<Float> padding) const {
  ensureUnsealed();

  auto style = yogaNode_.style();

  auto leftPadding = yoga::StyleLength::points(padding.left);
  auto topPadding = yoga::StyleLength::points(padding.top);
  auto rightPadding = yoga::StyleLength::points(padding.right);
  auto bottomPadding = yoga::StyleLength::points(padding.bottom);

  if (leftPadding != style.padding(yoga::Edge::Left) ||
      topPadding != style.padding(yoga::Edge::Top) ||
      rightPadding != style.padding(yoga::Edge::Right) ||
      bottomPadding != style.padding(yoga::Edge::Bottom)) {
    style.setPadding(yoga::Edge::Top, yoga::StyleLength::points(padding.top));
    style.setPadding(yoga::Edge::Left, yoga::StyleLength::points(padding.left));
    style.setPadding(
        yoga::Edge::Right, yoga::StyleLength::points(padding.right));
    style.setPadding(
        yoga::Edge::Bottom, yoga::StyleLength::points(padding.bottom));
    yogaNode_.setStyle(style);
    yogaNode_.setDirty(true);
  }
}

void YogaLayoutableShadowNode::setPositionType(
    YGPositionType positionType) const {
  ensureUnsealed();

  auto style = yogaNode_.style();
  style.setPositionType(yoga::scopedEnum(positionType));
  yogaNode_.setStyle(style);
  yogaNode_.setDirty(true);
}

void YogaLayoutableShadowNode::layoutTree(
    LayoutContext layoutContext,
    LayoutConstraints layoutConstraints) {
  ensureUnsealed();

  TraceSection s1("YogaLayoutableShadowNode::layoutTree");

  bool swapLeftAndRight = layoutContext.swapLeftAndRightInRTL &&
      layoutConstraints.layoutDirection == LayoutDirection::RightToLeft;

  {
    TraceSection s2("YogaLayoutableShadowNode::configureYogaTree");
    configureYogaTree(
        layoutContext.pointScaleFactor,
        layoutContext.fontSizeMultiplier,
        YGErrataAll /*defaultErrata*/,
        swapLeftAndRight);
  }

  auto minimumSize = layoutConstraints.minimumSize;
  auto maximumSize = layoutConstraints.maximumSize;

  // The caller must ensure that layout constraints make sense.
  // Values cannot be NaN.
  react_native_assert(!std::isnan(minimumSize.width));
  react_native_assert(!std::isnan(minimumSize.height));
  react_native_assert(!std::isnan(maximumSize.width));
  react_native_assert(!std::isnan(maximumSize.height));
  // Values cannot be negative.
  react_native_assert(minimumSize.width >= 0);
  react_native_assert(minimumSize.height >= 0);
  react_native_assert(maximumSize.width >= 0);
  react_native_assert(maximumSize.height >= 0);
  // Minimum size cannot be infinity.
  react_native_assert(!std::isinf(minimumSize.width));
  react_native_assert(!std::isinf(minimumSize.height));

  // Yoga C++ API (and `YGNodeCalculateLayout` function particularly)
  // does not allow to specify sizing modes (see
  // https://www.w3.org/TR/css-sizing-3/#auto-box-sizes) explicitly. Instead,
  // it infers these from styles associated with the root node. To pass the
  // actual layout constraints to Yoga we represent them as
  // `(min/max)(Height/Width)` style properties. Also, we pass `ownerWidth` &
  // `ownerHeight` to allow proper calculation of relative (e.g. specified in
  // percents) style values.

  auto& yogaStyle = yogaNode_.style();

  auto ownerWidth = yogaFloatFromFloat(maximumSize.width);
  auto ownerHeight = yogaFloatFromFloat(maximumSize.height);

  yogaStyle.setMaxDimension(
      yoga::Dimension::Width, yoga::StyleSizeLength::points(maximumSize.width));

  yogaStyle.setMaxDimension(
      yoga::Dimension::Height,
      yoga::StyleSizeLength::points(maximumSize.height));

  yogaStyle.setMinDimension(
      yoga::Dimension::Width, yoga::StyleSizeLength::points(minimumSize.width));

  yogaStyle.setMinDimension(
      yoga::Dimension::Height,
      yoga::StyleSizeLength::points(minimumSize.height));

  auto direction =
      yogaDirectionFromLayoutDirection(layoutConstraints.layoutDirection);

  threadLocalLayoutContext = layoutContext;

  {
    TraceSection s3("YogaLayoutableShadowNode::YGNodeCalculateLayout");
    YGNodeCalculateLayout(&yogaNode_, ownerWidth, ownerHeight, direction);
  }

  // Update layout metrics for root node. Updated for children in
  // YogaLayoutableShadowNode::layout
  if (yogaNode_.getHasNewLayout()) {
    auto layoutMetrics = layoutMetricsFromYogaNode(yogaNode_);
    layoutMetrics.pointScaleFactor = layoutContext.pointScaleFactor;
    layoutMetrics.fontSizeMultiplier = layoutContext.fontSizeMultiplier;
    layoutMetrics.wasLeftAndRightSwapped = swapLeftAndRight;
    setLayoutMetrics(layoutMetrics);
    yogaNode_.setHasNewLayout(false);
  }

  layout(layoutContext);
}

static EdgeInsets calculateOverflowInset(
    Rect contentFrame,
    Rect contentBounds) {
  auto size = contentFrame.size;
  auto overflowInset = EdgeInsets{};
  overflowInset.left = std::min(contentBounds.getMinX(), Float{0.0});
  overflowInset.top = std::min(contentBounds.getMinY(), Float{0.0});
  overflowInset.right =
      -std::max(contentBounds.getMaxX() - size.width, Float{0.0});
  overflowInset.bottom =
      -std::max(contentBounds.getMaxY() - size.height, Float{0.0});
  return overflowInset;
}

void YogaLayoutableShadowNode::layout(LayoutContext layoutContext) {
  // Reading data from a dirtied node does not make sense.
  react_native_assert(!YGNodeIsDirty(&yogaNode_));

  // An elided anonymous box gets no frame from Yoga, because it is not a Yoga
  // child. It fills this container's content box by definition — that is what
  // being the container's own inline formatting context means — and everything
  // downstream (run publishing, fragment rects, attachment placement) reads
  // that frame.
  if (measuresOwnInlineRun_ && anonymousTextContentChildren_.size() == 1) {
    auto& box = *anonymousTextContentChildren_[0];
    box.yogaNode_.setLayoutDirection(yogaNode_.getLayout().direction());
    auto boxMetrics = getLayoutMetrics();
    boxMetrics.frame = getLayoutMetrics().getContentFrame();
    box.ensureUnsealed();
    box.setLayoutMetrics(boxMetrics);
  }

  const auto& yogaChildren = yogaNode_.getChildren();
  for (size_t childIndex = 0; childIndex < yogaChildren.size(); childIndex++) {
    auto* childYogaNode = yogaChildren[childIndex];
    auto* childNodePtr = &shadowNodeFromContext(childYogaNode);

    // Verifying that the Yoga node belongs to the ShadowNode.
    react_native_assert(&childNodePtr->yogaNode_ == childYogaNode);

    if (childYogaNode->getHasNewLayout()) {
      childYogaNode->setHasNewLayout(false);

      // Reading data from a dirtied node does not make sense.
      react_native_assert(!childYogaNode->isDirty());

      // We must copy layout metrics from Yoga node only once (when the parent
      // node exclusively ownes the child node).
      react_native_assert(YGNodeGetOwner(childYogaNode) == &yogaNode_);

      /*
       * The last line of defence for structural sharing: a child that is
       * still SEALED here is shared with a committed tree, and writing its
       * metrics would mutate that tree — an `Attempt to mutate a sealed
       * object` abort in Debug, and in Release (where the seal is compiled
       * out) silently corrupted old-generation metrics. The contract that is
       * supposed to prevent this — Yoga's clone-node callback plus
       * `configureYogaTree`'s ownership adoption — recognises foreign
       * children BY their yoga owner, and interleaved generations (a React
       * commit racing a state-progression commit, as an image `onLoad`
       * handler's setState produces) can launder a shared child through an
       * owner-resetting detach so that it arrives here wearing this parent's
       * ownership. Clone it in place, exactly as the callback would have,
       * and lay out the clone. Debug-only by construction — `getSealed()` is
       * constant `true` in Release, where `cloneChildInPlace` on every child
       * would be pure churn, and the abort this guards against is also
       * Debug-only; the ownership adoption above remains the primary
       * mechanism in both modes.
       */
      if (childNodePtr->getSealed() && !this->getSealed()) {
        auto& clonedChild = cloneChildInPlace(childIndex);
        childYogaNode = &clonedChild.yogaNode_;
        childYogaNode->setHasNewLayout(false);
        childNodePtr = &clonedChild;
      }
      auto& childNode = *childNodePtr;

      // We are about to mutate layout metrics of the node.
      childNode.ensureUnsealed();

      auto newLayoutMetrics = layoutMetricsFromYogaNode(*childYogaNode);
      newLayoutMetrics.pointScaleFactor = layoutContext.pointScaleFactor;
      newLayoutMetrics.fontSizeMultiplier = layoutContext.fontSizeMultiplier;
      newLayoutMetrics.wasLeftAndRightSwapped =
          layoutContext.swapLeftAndRightInRTL &&
          newLayoutMetrics.layoutDirection == LayoutDirection::RightToLeft;

      // Child node's layout has changed. When a node is added to
      // `affectedNodes`, onLayout event is called on the component. Comparing
      // `newLayoutMetrics.frame` with `childNode.getLayoutMetrics().frame` to
      // detect if layout has not changed is not advised, please refer to
      // D22999891 for details.
      if (layoutContext.affectedNodes != nullptr) {
        layoutContext.affectedNodes->push_back(&childNode);
      }

      childNode.setLayoutMetrics(newLayoutMetrics);

      if (newLayoutMetrics.displayType != DisplayType::None) {
        childNode.layout(layoutContext);
      }
    }
  }

  if (YGNodeStyleGetOverflow(&yogaNode_) == YGOverflowVisible) {
    // Note that the parent node's overflow layout is NOT affected by its
    // transform matrix. That transform matrix is applied on the parent node
    // as well as all of its child nodes, which won't cause changes on the
    // overflowInset values. A special note on the scale transform -- the
    // scaled layout may look like it's causing overflowInset changes, but
    // it's purely cosmetic and will be handled by pixel density conversion
    // logic later when render the view. The actual overflowInset value is not
    // changed as if the transform is not happening here.
    auto contentBounds = getContentBounds();
    layoutMetrics_.overflowInset =
        calculateOverflowInset(layoutMetrics_.frame, contentBounds);
  } else {
    layoutMetrics_.overflowInset = {};
  }
}

Rect YogaLayoutableShadowNode::getContentBounds() const {
  auto contentBounds = Rect{};

  for (auto childYogaNode : yogaNode_.getChildren()) {
    auto& childNode = shadowNodeFromContext(childYogaNode);

    // Verifying that the Yoga node belongs to the ShadowNode.
    react_native_assert(&childNode.yogaNode_ == childYogaNode);

    auto layoutMetricsWithOverflowInset = childNode.getLayoutMetrics();
    if (layoutMetricsWithOverflowInset.displayType != DisplayType::None) {
      auto viewChildNode = dynamic_cast<const ViewShadowNode*>(&childNode);
      auto hitSlop = viewChildNode != nullptr
          ? viewChildNode->getConcreteProps().hitSlop
          : EdgeInsets{};

      // The contentBounds should always union with existing child node layout
      // + overflowInset. The transform may in a deferred animation and not
      // applied yet.
      contentBounds.unionInPlace(insetBy(
          layoutMetricsWithOverflowInset.frame,
          layoutMetricsWithOverflowInset.overflowInset));
      contentBounds.unionInPlace(
          outsetBy(layoutMetricsWithOverflowInset.frame, hitSlop));

      auto childTransform = childNode.getTransform();
      if (childTransform != Transform::Identity()) {
        // The child node's transform matrix will affect the parent node's
        // contentBounds. We need to union with child node's after transform
        // layout here.
        contentBounds.unionInPlace(insetBy(
            layoutMetricsWithOverflowInset.frame * childTransform,
            layoutMetricsWithOverflowInset.overflowInset * childTransform));
        contentBounds.unionInPlace(outsetBy(
            layoutMetricsWithOverflowInset.frame * childTransform, hitSlop));
      }
    }
  }

  return contentBounds;
}

#pragma mark - Yoga Connectors

YGNodeRef YogaLayoutableShadowNode::yogaNodeCloneCallbackConnector(
    YGNodeConstRef /*oldYogaNode*/,
    YGNodeConstRef parentYogaNode,
    size_t childIndex) {
  TraceSection s("YogaLayoutableShadowNode::yogaNodeCloneCallbackConnector");

  auto& parentNode = shadowNodeFromContext(parentYogaNode);
  return &parentNode.cloneChildInPlace(childIndex).yogaNode_;
}

Float YogaLayoutableShadowNode::baseline(
    const LayoutContext& layoutContext,
    Size size) const {
  // With the anonymous box elided, the run's baseline is this container's:
  // the box is where the line boxes live, and Yoga has no child to ask.
  if (measuresOwnInlineRun_ && anonymousTextContentChildren_.size() == 1) {
    return anonymousTextContentChildren_[0]->baseline(layoutContext, size);
  }
  return LayoutableShadowNode::baseline(layoutContext, size);
}

Size YogaLayoutableShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  // The elided anonymous box: this container is the run's block container, so
  // it measures the run the box would have measured.
  if (measuresOwnInlineRun_ && anonymousTextContentChildren_.size() == 1) {
    auto& box = *anonymousTextContentChildren_[0];
    // The box resolves logical edges from its own Yoga node's LAID OUT
    // direction, and an elided box is never laid out. Hand it this
    // container's, which Yoga has already resolved by the time it asks us to
    // measure.
    box.yogaNode_.setLayoutDirection(yogaNode_.getLayout().direction());
    return box.measureContent(layoutContext, layoutConstraints);
  }
  return LayoutableShadowNode::measureContent(layoutContext, layoutConstraints);
}

YGSize YogaLayoutableShadowNode::yogaNodeMeasureCallbackConnector(
    YGNodeConstRef yogaNode,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode) {
  TraceSection s("YogaLayoutableShadowNode::yogaNodeMeasureCallbackConnector");

  auto& shadowNode = shadowNodeFromContext(yogaNode);

  auto minimumSize = Size{.width = 0, .height = 0};
  auto maximumSize = Size{
      .width = std::numeric_limits<Float>::infinity(),
      .height = std::numeric_limits<Float>::infinity()};

  switch (widthMode) {
    case YGMeasureModeUndefined:
      break;
    case YGMeasureModeExactly:
      minimumSize.width = floatFromYogaFloat(width);
      maximumSize.width = floatFromYogaFloat(width);
      break;
    case YGMeasureModeAtMost:
      maximumSize.width = floatFromYogaFloat(width);
      break;
  }

  switch (heightMode) {
    case YGMeasureModeUndefined:
      break;
    case YGMeasureModeExactly:
      minimumSize.height = floatFromYogaFloat(height);
      maximumSize.height = floatFromYogaFloat(height);
      break;
    case YGMeasureModeAtMost:
      maximumSize.height = floatFromYogaFloat(height);
      break;
  }

  auto size = shadowNode.measureContent(
      threadLocalLayoutContext,
      {.minimumSize = minimumSize, .maximumSize = maximumSize});

#ifdef REACT_NATIVE_DEBUG
  bool widthInBounds = size.width + kDefaultEpsilon >= minimumSize.width &&
      size.width - kDefaultEpsilon <= maximumSize.width;
  bool heightInBounds = size.height + kDefaultEpsilon >= minimumSize.height &&
      size.height - kDefaultEpsilon <= maximumSize.height;

  if (!widthInBounds || !heightInBounds) {
    LOG(ERROR) << shadowNode.getComponentDescriptor().getComponentName()
               << " returned an invalid measurement. Min: ["
               << minimumSize.width << "," << minimumSize.height << "] Max: ["
               << maximumSize.width << "," << maximumSize.height
               << "] Actual: [" << size.width << "," << size.height << "]";
  }
#endif

  return YGSize{
      yogaFloatFromFloat(size.width), yogaFloatFromFloat(size.height)};
}

float YogaLayoutableShadowNode::yogaNodeBaselineCallbackConnector(
    YGNodeConstRef yogaNode,
    float width,
    float height) {
  TraceSection s("YogaLayoutableShadowNode::yogaNodeBaselineCallbackConnector");

  auto& shadowNode = shadowNodeFromContext(yogaNode);
  auto baseline = shadowNode.baseline(
      threadLocalLayoutContext,
      {.width = floatFromYogaFloat(width),
       .height = floatFromYogaFloat(height)});

  return yogaFloatFromFloat(baseline);
}

YogaLayoutableShadowNode& YogaLayoutableShadowNode::shadowNodeFromContext(
    YGNodeConstRef yogaNode) {
  return dynamic_cast<YogaLayoutableShadowNode&>(
      *static_cast<ShadowNode*>(YGNodeGetContext(yogaNode)));
}

yoga::Config& YogaLayoutableShadowNode::initializeYogaConfig(
    yoga::Config& config,
    YGConfigConstRef previousConfig) {
  YGConfigSetCloneNodeFunc(
      &config, YogaLayoutableShadowNode::yogaNodeCloneCallbackConnector);
  if (previousConfig != nullptr) {
    YGConfigSetPointScaleFactor(
        &config, YGConfigGetPointScaleFactor(previousConfig));
    YGConfigSetErrata(&config, YGConfigGetErrata(previousConfig));
  }

  if (ReactNativeFeatureFlags::fixYogaFlexBasisFitContentInMainAxis()) {
    YGConfigSetExperimentalFeatureEnabled(
        &config, YGExperimentalFeatureFixFlexBasisFitContent, true);
  }

  return config;
}

#pragma mark - RTL left and right swapping

void YogaLayoutableShadowNode::swapStyleLeftAndRight() {
  ensureUnsealed();

  swapLeftAndRightInYogaStyleProps();
  swapLeftAndRightInViewProps();
}

void YogaLayoutableShadowNode::swapLeftAndRightInYogaStyleProps() {
  auto yogaStyle = yogaNode_.style();

  // Swap Yoga node values, position, padding and margin.

  if (yogaStyle.position(yoga::Edge::Left).isDefined()) {
    yogaStyle.setPosition(
        yoga::Edge::Start, yogaStyle.position(yoga::Edge::Left));
    yogaStyle.setPosition(yoga::Edge::Left, yoga::StyleLength::undefined());
  }

  if (yogaStyle.position(yoga::Edge::Right).isDefined()) {
    yogaStyle.setPosition(
        yoga::Edge::End, yogaStyle.position(yoga::Edge::Right));
    yogaStyle.setPosition(yoga::Edge::Right, yoga::StyleLength::undefined());
  }

  if (yogaStyle.padding(yoga::Edge::Left).isDefined()) {
    yogaStyle.setPadding(
        yoga::Edge::Start, yogaStyle.padding(yoga::Edge::Left));
    yogaStyle.setPadding(yoga::Edge::Left, yoga::StyleLength::undefined());
  }

  if (yogaStyle.padding(yoga::Edge::Right).isDefined()) {
    yogaStyle.setPadding(yoga::Edge::End, yogaStyle.padding(yoga::Edge::Right));
    yogaStyle.setPadding(yoga::Edge::Right, yoga::StyleLength::undefined());
  }

  if (yogaStyle.margin(yoga::Edge::Left).isDefined()) {
    yogaStyle.setMargin(yoga::Edge::Start, yogaStyle.margin(yoga::Edge::Left));
    yogaStyle.setMargin(yoga::Edge::Left, yoga::StyleLength::undefined());
  }

  if (yogaStyle.margin(yoga::Edge::Right).isDefined()) {
    yogaStyle.setMargin(yoga::Edge::End, yogaStyle.margin(yoga::Edge::Right));
    yogaStyle.setMargin(yoga::Edge::Right, yoga::StyleLength::undefined());
  }

  if (yogaStyle.border(yoga::Edge::Left).isDefined()) {
    yogaStyle.setBorder(yoga::Edge::Start, yogaStyle.border(yoga::Edge::Left));
    yogaStyle.setBorder(yoga::Edge::Left, yoga::StyleLength::undefined());
  }

  if (yogaStyle.border(yoga::Edge::Right).isDefined()) {
    yogaStyle.setBorder(yoga::Edge::End, yogaStyle.border(yoga::Edge::Right));
    yogaStyle.setBorder(yoga::Edge::Right, yoga::StyleLength::undefined());
  }

  yogaNode_.setStyle(yogaStyle);
}

void YogaLayoutableShadowNode::swapLeftAndRightInViewProps() {
  if (auto viewShadowNode = dynamic_cast<ViewShadowNode*>(this)) {
    // TODO: Do not mutate props directly.
    auto& props = const_cast<ViewProps&>(viewShadowNode->getConcreteProps());

    // Swap border node values, borderRadii, borderColors and borderStyles.
    if (props.borderRadii.topLeft.has_value()) {
      props.borderRadii.topStart = props.borderRadii.topLeft;
      props.borderRadii.topLeft.reset();
    }

    if (props.borderRadii.bottomLeft.has_value()) {
      props.borderRadii.bottomStart = props.borderRadii.bottomLeft;
      props.borderRadii.bottomLeft.reset();
    }

    if (props.borderRadii.topRight.has_value()) {
      props.borderRadii.topEnd = props.borderRadii.topRight;
      props.borderRadii.topRight.reset();
    }

    if (props.borderRadii.bottomRight.has_value()) {
      props.borderRadii.bottomEnd = props.borderRadii.bottomRight;
      props.borderRadii.bottomRight.reset();
    }

    if (props.borderColors.left.has_value()) {
      props.borderColors.start = props.borderColors.left;
      props.borderColors.left.reset();
    }

    if (props.borderColors.right.has_value()) {
      props.borderColors.end = props.borderColors.right;
      props.borderColors.right.reset();
    }

    if (props.borderStyles.left.has_value()) {
      props.borderStyles.start = props.borderStyles.left;
      props.borderStyles.left.reset();
    }

    if (props.borderStyles.right.has_value()) {
      props.borderStyles.end = props.borderStyles.right;
      props.borderStyles.right.reset();
    }
  }
}

#pragma mark - Consistency Ensuring Helpers

void YogaLayoutableShadowNode::ensureConsistency() const {
  ensureYogaChildrenLookFine();
  ensureYogaChildrenAlignment();
}

void YogaLayoutableShadowNode::ensureYogaChildrenLookFine() const {
#if defined(REACT_NATIVE_DEBUG)
  // Checking that the shapes of Yoga node children object look fine.
  // This is the only heuristic that might produce false-positive results
  // (really broken dangled nodes might look fine). This is useful as an early
  // signal that something went wrong.
  auto& yogaChildren = yogaNode_.getChildren();

  for (const auto& yogaChild : yogaChildren) {
    react_native_assert(yogaChild->getContext());
    react_native_assert(yogaChild->getChildren().size() < 16384);
    if (!yogaChild->getChildren().empty()) {
      react_native_assert(!yogaChild->hasMeasureFunc());
    }
  }
#endif
}

void YogaLayoutableShadowNode::ensureYogaChildrenAlignment() const {
#if defined(REACT_NATIVE_DEBUG)
  // If the node is not a leaf node, checking that:
  // - All children are `YogaLayoutableShadowNode` subclasses.
  // - All Yoga children are owned/connected to corresponding children of
  //   this node.

  auto& yogaChildren = yogaNode_.getChildren();
  auto& children = yogaLayoutableChildren_;

  if (getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode)) {
    react_native_assert(yogaChildren.empty());
    return;
  }

  react_native_assert(yogaChildren.size() == children.size());

  for (size_t i = 0; i < children.size(); i++) {
    auto& yogaChild = yogaChildren.at(i);
    auto& child = children.at(i);
    react_native_assert(
        yogaChild->getContext() ==
        YogaLayoutableShadowNode::asYogaLayoutable(*child));
  }
#endif
}

} // namespace facebook::react
