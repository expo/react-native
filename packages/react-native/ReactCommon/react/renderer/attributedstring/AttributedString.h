/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/InlineBoxDecorations.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/core/Sealable.h>
#include <react/renderer/debug/DebugStringConvertible.h>
#include <react/renderer/mounting/ShadowView.h>
#include <react/utils/hash_combine.h>

namespace facebook::react {

/*
 * Simple, cross-platform, React-specific implementation of attributed string
 * (aka spanned string).
 * `AttributedString` is basically a list of `Fragments` which have `string` and
 * `textAttributes` + `shadowNode` associated with the `string`.
 */
class AttributedString : public Sealable, public DebugStringConvertible {
 public:
  class Fragment {
   public:
    static std::string AttachmentCharacter();

    std::string string;
    TextAttributes textAttributes;
    ShadowView parentShadowView;

    /*
     * CSS box decorations of the inline element that contributed this
     * fragment (box-model-scope.md G2–G5). Carried on *every* fragment of the
     * element so painting can find its full extent, while `isInlineBoxStart` /
     * `isInlineBoxEnd` mark the element's edges — which is where the
     * inline-axis margin/border/padding occupy advance (CSS2 §10.6.1). A
     * wrapped box therefore pays for its edges once, not per line.
     *
     * Empty for essentially all text; engines that cannot express it ignore it.
     */
    /*
     * For an attachment (an atomic inline box), the distance from the box's
     * top to its baseline — what the text engine needs to sit it on the line's
     * baseline (CSS2 §10.8.1). Equal to the box's height when it has no line
     * boxes of its own, which is the synthesized bottom-edge baseline.
     */
    Float atomicInlineBaseline{0};

    /*
     * Where this atomic inline sits on the line — CSS `vertical-align`
     * (CSS2 §10.8.1).
     *
     * Carried here rather than read from the node at placement time because the
     * platform layout managers see fragments, not shadow nodes, and each one
     * has to make this decision itself: the position it wants is relative to
     * the line box, which only the engine that built the line knows.
     *
     * 0 = baseline (the initial value), 1 = top, 2 = bottom, 3 = middle. A
     * plain integer so this header keeps no dependency on the view props.
     */
    uint8_t atomicInlineVerticalAlign{0};

    /*
     * A forced line break from `<br>` (HTML §4.5.28).
     *
     * Marked explicitly rather than inferred from the fragment's element,
     * because whitespace collapsing has to tell this newline — which is
     * content — from an ordinary one in source text, which css-text-3 §3
     * collapses to a space. Deriving it from the parent view does not work:
     * `<br>` is a view-config alias of `<span>`, so that is the name it
     * carries.
     */
    bool forcedBreak{false};

    /*
     * An inline element that contributed no text of its own — `<span></span>`.
     *
     * It still has a box: the web gives it zero width and the height of the
     * line it sits on, and code measures empty inlines on purpose, as anchors.
     * Without a fragment there is nothing to hang that box on, so an empty
     * element gets an empty fragment and this flag, which says two things
     * nothing else can: whitespace collapsing must not drop it for having no
     * text, and the fragment-rect pass must answer with the caret box at its
     * position rather than the nothing a zero-length glyph range returns.
     */
    bool isEmptyElement{false};

    InlineBoxDecorations inlineBox{};
    bool isInlineBoxStart{false};
    bool isInlineBoxEnd{false};

    /** Advance this fragment reserves before its glyphs. */
    Float leadingInlineSpace() const
    {
      return isInlineBoxStart ? inlineBox.leadingInlineSpace() : 0;
    }

    /** Advance this fragment reserves after its glyphs. */
    Float trailingInlineSpace() const
    {
      return isInlineBoxEnd ? inlineBox.trailingInlineSpace() : 0;
    }

    /**
     * How far this fragment's border box extends above and below the line box,
     * which is what `getBoundingClientRect()` has to include.
     *
     * Unlike the inline-axis edges, these apply to EVERY fragment of the
     * element rather than only its first and last: a wrapped inline is one box
     * per line, and `box-decoration-break: slice` (CSS §8.6, the initial value)
     * draws the block-axis padding and border on each of them.
     *
     * Margin is excluded — this is the border box, and margin is outside it.
     */
    RectangleEdges<Float> blockAxisBoxEdges() const
    {
      return {
          .top = inlineBox.padding.top + inlineBox.borderWidth.top,
          .bottom = inlineBox.padding.bottom + inlineBox.borderWidth.bottom,
      };
    }

    /*
     * Returns true is the Fragment represents an attachment.
     * Equivalent to `string == AttachmentCharacter()`.
     */
    bool isAttachment() const;

    /*
     * Returns whether the underlying text and attributes are equal,
     * disregarding layout or other information.
     */
    bool isContentEqual(const Fragment &rhs) const;

    bool operator==(const Fragment &rhs) const;
  };

  class Range {
   public:
    int location{0};
    int length{0};
  };

  using Fragments = std::vector<Fragment>;

  /*
   * Appends and prepends a `fragment` to the string.
   */
  void appendFragment(Fragment &&fragment);
  void prependFragment(Fragment &&fragment);

  /*
   * Sets attributes which would apply to hypothetical text not included in the
   * AttributedString.
   */
  void setBaseTextAttributes(const TextAttributes &defaultAttributes);

  /*
   * Returns a read-only reference to a list of fragments.
   */
  const Fragments &getFragments() const;

  /*
   * The block-axis space that inline elements' decorations paint *outside* the
   * line box: padding + border + outline, taking the largest of each edge.
   *
   * An inline box never grows the line box vertically (CSS2 §10.6.1) — it
   * simply overflows it — so a platform view whose drawing surface is sized to
   * the measured text will clip those decorations away entirely. Views make
   * room with this without changing layout.
   */
  RectangleEdges<Float> inlineBoxBlockAxisOverflow() const;

  /*
   * The share of the block-axis ink overflow that comes from baseline-shifted
   * fragments (<sup>/<sub>) alone. Reserved in the run box's measured height
   * (see the definition) — unlike the box-decoration share, which overflows
   * without growing anything.
   */
  RectangleEdges<Float> baselineShiftInkOverflow() const;

  /*
   * Returns a reference to a list of fragments.
   */
  Fragments &getFragments();

  /*
   * Returns a string constructed from all strings in all fragments.
   */
  std::string getString() const;

  const TextAttributes &getBaseTextAttributes() const;

  /*
   * Returns `true` if the string is empty (has no any fragments).
   */
  bool isEmpty() const;

  /**
   * Compares equality of TextAttributes of all Fragments on both sides.
   */
  bool compareTextAttributesWithoutFrame(const AttributedString &rhs) const;

  bool isContentEqual(const AttributedString &rhs) const;

  bool operator==(const AttributedString &rhs) const;

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
  SharedDebugStringConvertibleList getDebugChildren() const override;
#endif

 private:
  Fragments fragments_;
  TextAttributes baseAttributes_;
};

} // namespace facebook::react

namespace std {
template <>
struct hash<facebook::react::AttributedString::Fragment> {
  size_t operator()(const facebook::react::AttributedString::Fragment &fragment) const
  {
    return facebook::react::hash_combine(
        fragment.string,
        fragment.textAttributes,
        fragment.parentShadowView.tag,
        fragment.parentShadowView.layoutMetrics);
  }
};

template <>
struct hash<facebook::react::AttributedString> {
  size_t operator()(const facebook::react::AttributedString &attributedString) const
  {
    auto seed = size_t{0};

    facebook::react::hash_combine(seed, attributedString.getBaseTextAttributes());
    for (const auto &fragment : attributedString.getFragments()) {
      facebook::react::hash_combine(seed, fragment);
    }

    return seed;
  }
};
} // namespace std
