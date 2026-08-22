/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <memory>
#include <react/renderer/components/view/ListStyle.h>
#include <vector>

#include <yoga/node/Node.h>

#include <react/debug/react_native_assert.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/core/Sealable.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/debug/DebugStringConvertible.h>

namespace facebook::react {

class YogaLayoutableShadowNode : public LayoutableShadowNode {
  // Allow YogaCloneTest to read yogaNode_ for ownership assertions in unit
  // tests. The class is only defined in the tests target; production code
  // sees the friend as a forward declaration with no effect.
  friend class YogaCloneTest;

 public:
  using Shared = std::shared_ptr<const YogaLayoutableShadowNode>;
  using ListOfShared = std::vector<Shared>;

#pragma mark - Constructors

  YogaLayoutableShadowNode(
      const ShadowNodeFragment &fragment,
      const ShadowNodeFamily::Shared &family,
      ShadowNodeTraits traits);

  YogaLayoutableShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment);

  void completeClone(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment) override;

#pragma mark - Mutating Methods

  /*
   * Connects `measureFunc` function of Yoga node with
   * `LayoutableShadowNode::measure()` method.
   */
  void enableMeasurement();

  void appendChild(const std::shared_ptr<const ShadowNode> &child) override;
  void replaceChild(
      const ShadowNode &oldChild,
      const std::shared_ptr<const ShadowNode> &newChild,
      size_t suggestedIndex = SIZE_MAX) override;

  void updateYogaChildren();

  void updateYogaProps();

  /*
   * Sets layoutable size of node.
   */
  void setSize(Size size) const;

  void setPadding(RectangleEdges<Float> padding) const;

  /*
   * Sets position type of Yoga node (relative, absolute).
   */
  void setPositionType(YGPositionType positionType) const;

#pragma mark - LayoutableShadowNode

  void dirtyLayout() override;
  bool getIsLayoutClean() const override;

  /*
   * Computes layout using Yoga layout engine.
   * See `LayoutableShadowNode` for more details.
   */
  void layoutTree(LayoutContext layoutContext, LayoutConstraints layoutConstraints) override;

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext &layoutContext,
      const LayoutConstraints &layoutConstraints) const override;

  Float baseline(const LayoutContext &layoutContext, Size size) const override;

  Rect getContentBounds() const;

  /*
   * The content box this container's own inline run occupies, which is the
   * whole content box unless `align-content` moved it (css-align-3 §5.3).
   */
  Rect alignedInlineRunFrame(YogaLayoutableShadowNode &box, const LayoutContext &layoutContext) const;

#pragma mark - Text children content (anonymous inline formatting contexts)

  /*
   * Factory producing an anonymous box (a Yoga-layoutable node establishing an
   * inline formatting context) for a run of inline-level children (text nodes
   * and inline text elements) of a block container. Implemented and installed
   * by the text module (components/text) to keep the dependency direction
   * intact; returns nullptr for runs that generate no box (e.g. whitespace-only
   * anonymous items, per css-flexbox-1 §4). See text-children-plan.md §3.A.
   */
  using AnonymousTextContentFactory = std::shared_ptr<YogaLayoutableShadowNode> (*)(
      std::vector<std::shared_ptr<const ShadowNode>> runChildren,
      const ShadowNode &containerShadowNode);

  static void setAnonymousTextContentFactory(AnonymousTextContentFactory factory);
  static AnonymousTextContentFactory getAnonymousTextContentFactory();

  /*
   * The layoutable children, which includes anonymous boxes — those live here
   * and never in `children_`.
   */
  const ListOfShared &getYogaLayoutableChildren() const
  {
    return yogaLayoutableChildren_;
  }

  /*
   * List marker generation (css-lists-3 §3) runs on the list CONTAINER: a
   * marker's text depends on the item's position among its siblings, and a
   * shadow node has no parent pointer, so an item cannot count itself.
   */
  void prepareListContext(int depth);
  void assignListMarkerIfNeeded(YogaLayoutableShadowNode &child);

  struct ListContext {
    bool isList{false};
    ListStyleType type{ListStyleType::Disc};
    ListStylePosition position{ListStylePosition::Outside};
    int nextOrdinal{1};
  };
  ListContext listContext_{};

  /*
   * How many lists enclose this node, so an unordered list can take the UA
   * bullet for its depth (disc, circle, square) without walking ancestors.
   */
  int listDepth_{0};

  const std::vector<std::shared_ptr<YogaLayoutableShadowNode>> &getAnonymousTextContentChildren() const
  {
    return anonymousTextContentChildren_;
  }

  /*
   * Parallel to `getAnonymousTextContentChildren()`: for each anonymous run box,
   * the number of block-level (mounted) React children that precede it in
   * document order. Used to interleave per-run paint views with mounted children
   * in authored order (text-children-plan.md §3.B).
   */
  /*
   * Whether this container measures its own inline run, its single anonymous
   * box having been elided from the Yoga tree.
   */
  bool measuresOwnInlineRun() const {
    return measuresOwnInlineRun_;
  }

  const std::vector<int> &getAnonymousTextContentChildIndices() const
  {
    return anonymousTextContentChildIndices_;
  }

  /*
   * Effective inherited text attributes for this node (element-tree cascade,
   * text-children-plan.md §3.D). Propagated top-down in `configureYogaTree`.
   */
  /*
   * Cascade storage hooks. Only CONSUMER nodes — paragraphs and anonymous IFC
   * boxes — store the effective cascade (they read it at measure time, when
   * no configure walk is on the stack); everyone else derives it locally in
   * `configureYogaTree` from `receivedTextAttributes_`. The virtuals let the
   * configure pass stamp consumers without knowing their concrete types.
   */
  virtual void setInheritedCascade(
      const std::shared_ptr<const TextAttributes>& /*cascade*/) {}

  virtual const std::shared_ptr<const TextAttributes>* getStoredCascade()
      const {
    return nullptr;
  }

 protected:
  /**
   * Subclasses which provide MeasurableYogaNode may override to signal that a
   * new ShadowNode revision does not need to invalidate existing measurements.
   */
  virtual bool shouldNewRevisionDirtyMeasurement(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      const;

  /*
   * Yoga config associated (only) with this particular node.
   */
  yoga::Config yogaConfig_;

  /*
   * All Yoga functions only accept non-const arguments, so we have to mark
   * Yoga node as `mutable` here to avoid `static_cast`ing the pointer to this
   * all the time.
   */
  // DOM-CSS-LIMITATION(eager-yoga-node): held by value, so an element that
  // generates *no* box — a span-like inline that folds into its parent's
  // inline formatting context — still pays 744 bytes for a Yoga node it never
  // uses. Making this lazy would make folding elements cheaper than they are
  // now; it changes memory layout for every view, so it wants measuring
  // against a real screen first. See element-model-design.md.
  mutable yoga::Node yogaNode_;

 private:
  void updateYogaChildrenOwnersIfNeeded();

  /*
   * Return true if child's yogaNode's owner is this->yogaNode_. Otherwise
   * returns false.
   */
  bool doesOwn(const YogaLayoutableShadowNode &child) const;

  /*
   * Appends a Yoga node to the Yoga node associated with this node.
   * The method does *not* do anything besides that (no cloning or `owner` field
   * adjustment).
   */
  void appendYogaChild(const YogaLayoutableShadowNode::Shared &childNode);

  /*
   * Makes the child node with a given `index` (and Yoga node associated with) a
   * valid child node satisfied requirements of the Concurrent Layout approach.
   */
  void adoptYogaChild(size_t index);

  /**
   * Applies contextual values to the ShadowNode's Yoga tree after the
   * ShadowTree has been constructed, but before it has been is laid out or
   * committed.
   */
  void
  configureYogaTree(float pointScaleFactor, Float fontSizeMultiplier, YGErrata defaultErrata, bool swapLeftAndRight);

  /**
   * Return an errata based on a `layoutConformance` prop if given, otherwise
   * the passed default
   */
  YGErrata resolveErrata(YGErrata defaultErrata) const;

  /**
   * Replcaes a child with a mutable clone of itself, returning the clone.
   */
  YogaLayoutableShadowNode &cloneChildInPlace(size_t layoutableChildIndex);

  static yoga::Config &initializeYogaConfig(yoga::Config &config, YGConfigConstRef previousConfig = nullptr);
  static YGNodeRef
  yogaNodeCloneCallbackConnector(YGNodeConstRef oldYogaNode, YGNodeConstRef parentYogaNode, size_t childIndex);
  static YGSize yogaNodeMeasureCallbackConnector(
      YGNodeConstRef yogaNode,
      float width,
      YGMeasureMode widthMode,
      float height,
      YGMeasureMode heightMode);
  static float yogaNodeBaselineCallbackConnector(YGNodeConstRef yogaNode, float width, float height);
  static YogaLayoutableShadowNode &shadowNodeFromContext(YGNodeConstRef yogaNode);

#pragma mark - RTL Legacy Autoflip

  /*
   * Reassigns the following values:
   * - (left|right) → (start|end)
   * - margin(Left|Right) → margin(Start|End)
   * - padding(Left|Right) → padding(Start|End)
   * - borderTop(Left|Right)Radius → borderTop(Start|End)Radius
   * - borderBottom(Left|Right)Radius → borderBottom(Start|End)Radius
   * - border(Left|Right)Width → border(Start|End)Width
   * - border(Left|Right)Color → border(Start|End)Color
   * This is neccesarry to be backwards compatible with old renderer, it swaps
   * the values as well in https://fburl.com/diffusion/kl7bjr3h
   */
  void swapStyleLeftAndRight();
  /*
   * In shadow node passed as argument, reassigns following values
   * - borderTop(Left|Right)Radius → borderTop(Start|End)Radius
   * - borderBottom(Left|Right)Radius → borderBottom(Start|End)Radius
   * - border(Left|Right)Width → border(Start|End)Width
   * - border(Left|Right)Color → border(Start|End)Color
   */
  void swapLeftAndRightInViewProps();
  /*
   * In yoga node passed as argument, reassigns following values
   * - (left|right) → (start|end)
   * - margin(Left|Right) → margin(Start|End)
   * - padding(Left|Right) → padding(Start|End)
   */
  void swapLeftAndRightInYogaStyleProps();

  /*
   * Combine a base yoga::Style with aliased properties which should be
   * flattened into it. E.g. reconciling "marginInlineStart" and "marginStart".
   */
  static yoga::Style applyAliasedProps(const yoga::Style &baseStyle, const YogaStylableProps &props);

#pragma mark - Consistency Ensuring Helpers

  void ensureConsistency() const;
  void ensureYogaChildrenAlignment() const;
  void ensureYogaChildrenLookFine() const;

#pragma mark - Text children content helpers

 public:
  /*
   * True when `child` is inline-level content (a text node or an inline text
   * element) that participates in anonymous box generation under this node.
   *
   * Public alongside the two below because they are one classification, asked
   * as one question: an inline formatting context is built from all three, and
   * `ViewShadowNode` needs this one to walk *into* an inline text element when
   * collecting the run's atomic inlines. An `<img>` inside an `<a>` is on the
   * same line as the `<a>`, so the recursion has to see that an `<a>` is an
   * inline box rather than a leaf.
   */
  static bool isInlineTextContent(const ShadowNode &child);

  /*
   * True when `child` is an atomic inline-level box: an otherwise block-level
   * element (`View`, `Image`, …) opted inline via `display:'inline'` that is
   * sized or has non-inline content. In a block container it joins the
   * current run as an inline attachment (like the replaced `<img>`); in a
   * flex container it is blockified into a regular flex item (css-display-3
   * §2.7). Absolutely-positioned elements are never inline (CSS2 §9.7
   * blockification).
   */
  static bool isAtomicInline(const ShadowNode &child);

  /*
   * True when `child` is a span-like inline box: `display:'inline'` with auto
   * size and all-inline contents — its contents flow into the surrounding
   * inline formatting context with its inheritable text props applied,
   * exactly like a <span>. Mutually exclusive with `isAtomicInline`.
   */
  static bool isInlineFlowContent(const ShadowNode &child);

  /*
   * True when `child` is inline-level content of ANY kind — the union of the
   * two above.
   *
   * ## Read this before writing a new test for "is this inline?"
   *
   * Inline-level content in this renderer comes in two unrelated shapes, and
   * nothing in their representation makes them look alike:
   *
   *   - inline *text* content — `#text`, `<Text>`, `<span>`, `<a>`, `<b>`,
   *     `<label>`: `TextShadowNode` subclasses carrying the `InlineText` trait;
   *   - an inline-level *box* — `inline-block`, `inline-flex`, a sized
   *     `display: inline` View: a Yoga node whose `displayInline` is set.
   *
   * A predicate that names only one of them is wrong, and wrong in a way that
   * is very hard to see: the layout looks correct for every tree that happens
   * to contain a text node, and collapses for trees that do not. Three separate
   * defects came from exactly that mistake —
   *
   *   - `appendChild` tested only `isInlineTextContent` when deciding whether a
   *     container needed its inline rebuild, so a run made *only* of atomic
   *     inlines was laid out as block children and stacked vertically. A single
   *     space anywhere in the run fixed it, which is why it was mistaken for a
   *     bug about text;
   *   - `ViewShadowNode::layoutInlineAttachments` tested only
   *     `isInlineFlowContent` when recursing for attachments, so an `<img>`
   *     inside an `<a>` was never placed and simply vanished;
   *   - `InlineElementMetrics` had the union right, which is what showed the
   *     other two were wrong rather than the design being unclear.
   *
   * So the union has a name, and callers ask for it rather than assembling it.
   * If you are about to write `isInlineTextContent(x) || something`, this is
   * the function you want.
   */
  static bool isInlineLevelContent(const ShadowNode &child);

 private:

  /*
   * Appends an anonymous box produced by the factory for the given run into
   * the Yoga children (it is never part of `children_` — box tree only).
   */
  void appendAnonymousTextContentChild(
      std::vector<std::shared_ptr<const ShadowNode>> &&runChildren,
      int precedingMountedChildCount);

#pragma mark - Private member variables
  /*
   * List of children which derive from YogaLayoutableShadowNode
   */
  ListOfShared yogaLayoutableChildren_;

  /*
   * Anonymous boxes generated for runs of inline-level children. Owned
   * exclusively by this shadow-node revision (rebuilt on clone); present in
   * `yogaLayoutableChildren_` and the Yoga node, never in `children_`.
   */
  std::vector<std::shared_ptr<YogaLayoutableShadowNode>> anonymousTextContentChildren_;

  /*
   * This container measures its own inline run: its single anonymous box is
   * not a Yoga child, because a block container whose children are all inline
   * needs no anonymous box (CSS2 §9.2.1.1).
   */
  bool measuresOwnInlineRun_{false};

  /*
   * Parallel to `anonymousTextContentChildren_`: preceding mounted-child count
   * per run box (document-order interleaving, text-children-plan.md §3.B).
   */
  std::vector<int> anonymousTextContentChildIndices_;

  /*
   * Effective inherited text attributes (cascade input ⊕ own inheritable
   * props), assigned by the parent during `configureYogaTree`.
   */
 public:
  static const std::shared_ptr<const TextAttributes>&
  defaultCascadeTextAttributes();


  /*
   * Trait-based downcast: the YogaLayoutableKind trait is set by this class's
   * constructors, so the check-and-static_cast is exact, and ~50x cheaper than
   * RTTI dynamic_cast on the per-child hot paths that need it.
   */
  static const YogaLayoutableShadowNode* asYogaLayoutable(
      const ShadowNode& node) {
    return node.getTraits().check(ShadowNodeTraits::Trait::YogaLayoutableKind)
        ? static_cast<const YogaLayoutableShadowNode*>(&node)
        : nullptr;
  }

  static std::shared_ptr<const YogaLayoutableShadowNode> asYogaLayoutable(
      const std::shared_ptr<const ShadowNode>& node) {
    return node != nullptr &&
            node->getTraits().check(
                ShadowNodeTraits::Trait::YogaLayoutableKind)
        ? std::static_pointer_cast<const YogaLayoutableShadowNode>(node)
        : nullptr;
  }

 private:

  /*
   * == The inherited-text cascade: invariants in one place ==
   * (text-inheritance-boundaries.md has the model; the machinery is spread
   * across this class by lifecycle, so the rules live here.)
   *
   * 1. STORAGE is copy-on-write: nodes under an unstyled ancestor — the
   *    overwhelming majority — share one immutable object (the process-wide
   *    default). A node ESTABLISHES a distinct value (allocates) only when its
   *    own props carry inheritable text props (`hasInheritedTextProps`, one
   *    parse-time bit). Clones copy pointers; the per-child comparison in
   *    `configureYogaTree` is pointer identity in the common case.
   * 2. PROPAGATION happens only inside `configureYogaTree`, parent to child,
   *    and only into children that can observe it: a cascade CONSUMER
   *    (TextCascadeConsumer — paragraphs, anonymous IFC boxes) or a subtree
   *    containing one (SubtreeHasCascadeDependents). An InheritanceBoundary
   *    child (`all: 'initial'`) is handed the default instead.
   * 3. The DEPENDENTS BIT is maintained bottom-up: recomputed from scratch by
   *    `updateYogaChildren`, OR-ed in by `appendChild` (Fabric appends
   *    children one at a time, after construction — and adoption by ancestors
   *    happens before any deferred rebuild, so inline content sets the bit
   *    the moment it joins). Boundary children contribute nothing.
   * 4. DIRTYING: an inheritable-prop change (or boundary toggle) marks the
   *    node dirty ONLY if the bit says something below depends on it. No
   *    dependents, no walk.
   * 5. A cascade change that cannot alter size (e.g. color) still must reach
   *    the text: anonymous boxes are Yoga-dirtied on cascade change so they
   *    re-measure and republish their run state.
   *
   * Regression coverage: CascadeBoundary-itest, StringChildrenBehavior-itest
   * (M4), CascadeSiblingRerender-itest, CascadeLayoutClone-itest; perf rows in
   * StringChildrenOverhead-benchmark-itest.
   */
  // (The effective cascade is not stored here: consumers keep their own copy
  // via setInheritedCascade, and everyone else derives it on the fly.)

  /*
   * The cascade value handed down by the parent during `configureYogaTree`,
   * before this node folds in its own inheritable props. Retained across
   * revisions so a later pass can detect when an ancestor's inheritable prop
   * changed and re-cascade into an otherwise unchanged subtree that the
   * layout-context skip guard would skip (text-children-plan.md §3.D).
   */
  std::shared_ptr<const TextAttributes> receivedTextAttributes_{
      defaultCascadeTextAttributes()};


  /*
   * Whether the full Yoga subtree of this Node has been configured.
   */
  bool yogaTreeHasBeenConfigured_{false};

  /*
   * Inline-level children joined since the Yoga children were last built, and
   * the rebuild is DEFERRED to the next configure pass. Fabric appends
   * children one at a time, and rebuilding the anonymous-box structure on
   * every inline append is O(children) each — O(n²) for a container with n
   * inline children. One deferred rebuild is O(n).
   * (Declared next to the bool above so the two share one alignment slot.)
   */
  bool yogaChildrenNeedInlineRebuild_{false};
};

} // namespace facebook::react
