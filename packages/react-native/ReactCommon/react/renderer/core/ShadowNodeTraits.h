/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>

namespace facebook::react {

/*
 * A set of predefined traits associated with a particular `ShadowNode` class
 * and an instance of that class. Used for efficient checking for interface
 * conformance for and storing important flags.
 */
class ShadowNodeTraits {
 public:
  /*
   * Underlying type for the traits.
   * The first 23 bits are reserved for Core.
   */
  enum Trait : int32_t {
    None = 0,

    // Note:
    // Not all traits are used yet (but all will be used in the near future).

    // Inherits `ConcreteViewShadowNode<>` template.
    ViewKind = 1 << 0,

    // Used when calculating relative layout in
    // LayoutableShadowNode::getRelativeLayoutMetrics. This trait marks node as
    // root, so when calculating relative layout, the calculation will not
    // traverse beyond this node. See T61257516 for details.
    RootNodeKind = 1 << 1,

    // The node is hidden.
    // Nodes with this trait (and all their descendants) will not produce views.
    Hidden = 1 << 2,

    // Inherits `YogaLayoutableShadowNode` and enforces that the yoga node is a
    // leaf.
    LeafYogaNode = 1 << 3,

    // Inherits `YogaLayoutableShadowNode` and has a custom measure function.
    // Only Leaf nodes can have this trait.
    MeasurableYogaNode = 1 << 4,

    // Indicates that the `ShadowNode` must form a stacking context.
    // A Stacking Context forms a level of a `ShadowView` hierarchy (in contrast
    // with a level of a `ShadowNode` hierarchy).
    // See W3C standard for more details: https://www.w3.org/TR/CSS2/zindex.html
    FormsStackingContext = 1 << 5,

    // Indicates that the node must form a `ShadowView`.
    FormsView = 1 << 6,

    // Internal to `ShadowNode`; do not use it outside.
    // Indicates that `children` list is shared between nodes and need
    // to be cloned before the first mutation.
    ChildrenAreShared = 1 << 7,

    // Indicates that direct children of the node should not be collapsed
    ChildrenFormStackingContext = 1 << 8,

    // Inherits `YogaLayoutableShadowNode` and has a custom baseline function.
    BaselineYogaNode = 1 << 9,

    // Forces the node not to form a host view.
    ForceFlattenView = 1 << 10,

    // Indicates if the node is keyboard focusable.
    KeyboardFocusable = 1 << 11,

    // Indicates if the node is uncullable. Apply this to your component
    // if it has side effects beyond just rendering (e.g. it opens a modal).
    Unstable_uncullableView = 1 << 12,

    // Must not be set directly. It is used by the view culling algorithm to
    // efficiently determine if a node is uncullable.
    Unstable_uncullableTrace = 1 << 13,

    // Indicates that the `YogaLayoutableShadowNode` must set `isDirty` flag for
    // Yoga node when a `ShadowNode` is being cloned. `ShadowNode`s that modify
    // Yoga styles in the constructor (or later) *after* the `ShadowNode`
    // is cloned must set this trait.
    // Any Yoga node (not only Leaf ones) can have this trait.
    // **Deprecated**: This trait is deprecated and will be removed in a future
    // version of React Native.
    DirtyYogaNode = 1 << 14,

    // The node is an anonymous box generated at the layout level (e.g. an
    // inline formatting context wrapping bare text children of a View). Such
    // nodes exist only in the box tree: they never join the shadow tree's
    // children lists and must not claim family parentage of the DOM children
    // they lay out (text-children-plan.md §3.A).
    AnonymousBox = 1 << 15,

    // The node is inline-level text content: it participates in a text run rather
    // than becoming its own block/flex item when it is a child of a View's anonymous
    // inline formatting context. Set by #text nodes and every inline text element
    // (Text and the intrinsics <b>/<i>/<span>/<u>/… and the unknown fallback via
    // TextShadowNode, plus the inline replaced <img>). Checking this trait — instead
    // of a hardcoded component-name list — lets any new intrinsic flow inline with no
    // core change, and avoids a components/view → components/text include dependency.
    InlineText = 1 << 16,

    // The node is an inline *replaced* element (an <img>-like attachment): it flows
    // inside the current text run and is positioned by the owning View's
    // attachment-layout pass, and it is NEVER blockified — where an inline text
    // element becomes its own flex item in a flex container, a replaced element
    // stays in the run. Stronger than InlineText, and set alongside it. Checking
    // this trait instead of the component name "img" is what lets a provider back
    // the element with any component (e.g. expo-image) under any name.
    InlineReplaced = 1 << 17,

    // The node itself consumes the inherited text cascade: a paragraph (which
    // folds it under its own TextProps) or an anonymous IFC box (which
    // measures and paints bare-text runs from it). Set by those classes'
    // BaseTraits.
    TextCascadeConsumer = 1 << 18,

    // Somewhere in this node's subtree is a TextCascadeConsumer that DEPENDS
    // on this node's cascade — i.e. not sealed off behind an inheritance
    // boundary. Maintained bottom-up by updateYogaChildren. When unset, an
    // inheritable-prop change on this node has no observer: nothing needs
    // dirtying and the cascade never needs to walk in.
    SubtreeHasCascadeDependents = 1 << 19,

    // The node is an inheritance boundary: the cascade below it restarts from
    // the defaults, so nothing below depends on anything above. Resolved from
    // the authored `all` and the UACascadeBoundary declaration below
    // (BaseViewProps::isInheritanceBoundary) at construction and on every
    // props change.
    InheritanceBoundary = 1 << 20,

    // The node IS a YogaLayoutableShadowNode. Layout code downcasts child
    // ShadowNodes constantly — per child, per pass — and RTTI dynamic_cast was
    // the top CPU consumer in inline-content-heavy profiles. The trait plus a
    // static_cast answers the same question in two loads.
    YogaLayoutableKind = 1 << 21,

    // The element's user-agent stylesheet declares `all: 'initial'` on this
    // element class — the native cascade's UA origin, which an authored `all`
    // cascades over: `initial` and `unset` override it, `revert` and an
    // absent declaration roll back to it (css-cascade-4 §7.3). Set in
    // BaseTraits (a static per-class fact, never mutated); root <Text>'s
    // ParagraphShadowNode is the one declarer — old React Native's "<Text> is
    // a style boundary" contract, expressed in the web's own vocabulary.
    UACascadeBoundary = 1 << 22,

    // This node resolves a length against a font size the cascade decides —
    // `margin-block: 1em`, `margin-block: 1rem`. It observes the cascade while
    // holding no text, and the dependents optimisation would otherwise skip it:
    // nothing below such a node consumes the cascade, so the walk would never
    // hand it one and its `em` would resolve against the default font size
    // rather than the inherited one.
    //
    // It cannot reuse TextCascadeConsumer, which is overloaded: that trait also
    // marks where LINE BOXES live, so a text-free <div> carrying it would start
    // answering `baseline()` from a box that has none.
    ResolvesRelativeLength = 1 << 23,
  };

  /*
   * Sets, unsets, and checks individual traits.
   */
  inline void set(Trait trait)
  {
    traits_ = ShadowNodeTraits::Trait(traits_ | trait);
  }

  inline void unset(Trait trait)
  {
    traits_ = ShadowNodeTraits::Trait(traits_ & ~trait);
  }

  inline bool check(Trait traits) const
  {
    return ShadowNodeTraits::Trait(traits_ & traits) == traits;
  }

  inline Trait get() const
  {
    return traits_;
  }

 private:
  Trait traits_{Trait::None};
};

} // namespace facebook::react
