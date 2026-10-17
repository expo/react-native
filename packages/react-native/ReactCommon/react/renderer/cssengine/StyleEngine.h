/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <react/renderer/core/EnvironmentValues.h>
#include <react/renderer/core/RawEvent.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/cssengine/AncestorFeatures.h>
#include <react/renderer/cssengine/MediaQueries.h>
#include <react/renderer/cssengine/StyleContext.h>
#include <react/renderer/cssengine/StyleSheet.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>

namespace facebook::react {

class UIManager;

namespace cssengine {

/*
 * One entry of a StyleX style or an inline style, parsed once when the style
 * reaches the engine. In a list of declarations an entry is a property and
 * its value; in a conditional value (`{default: …, ':hover': …}`) an entry is
 * a condition and the value under it. A block (`':hover': {…}`) is folded
 * into the values of the properties it declares, since StyleX compiles it to
 * the rules their conditional values compile to.
 */
struct AuthorEntry {
  enum class Kind : uint8_t {
    // A value in CSS text
    Value,
    // `null`: no value under this condition
    Null,
    // A value React Native reads as it is (an array or object an inline
    // style hands over), written to the props unchanged
    Raw,
    // A conditional value
    Nested,
  };
  enum class Condition : uint8_t {
    // A property, in a list of declarations
    None,
    Default,
    Media,
    // One of the pseudo-classes the engine answers from the element, named
    // by `pseudoClass`
    PseudoClass,
    // A `when.*` condition (StyleX), the selector its generated rule has
    Selector,
    // `@starting-style`: holds only for the element's starting style, the
    // values a transition runs from as it comes to be rendered
    // (css-transitions-2 §3.3)
    Starting,
    // A condition the engine does not answer (`@supports`, `::backdrop`, a
    // `when.*` marker, an unknown pseudo-class)
    Ignored,
  };
  Kind kind{Kind::Value};
  Condition condition{Condition::None};
  // The property, or the condition as written
  std::string key;
  std::string text;
  folly::dynamic raw;
  std::vector<AuthorEntry> entries;
  // For `PseudoClass`, which one: 1 `:hover`, 2 `:focus`, 3 `:focus-visible`,
  // 4 `:active`, 5 `:disabled`
  int pseudoClass{0};
  std::shared_ptr<const MediaQueryList> media;
  std::shared_ptr<const SelectorList> selector;
};

struct AuthorStyle {
  std::vector<AuthorEntry> declarations;
  // Whether a condition reads an element's siblings or its place among them
  bool readsSiblings{false};
  // Whether a value is given under `@starting-style`
  bool hasStartingStyle{false};
};

/*
 * Parses a style as JavaScript hands it over: an array of `[key, value]`
 * pairs, in the order the style declares them. A value is a string, a
 * number, null, `{c: [[key, value], …]}` for a conditional value or a block,
 * or `{r: value}` for a value already in React Native's form.
 */
AuthorStyle parseAuthorStyle(const folly::dynamic &entries);

/*
 * What the engine reads of the device: what media queries ask. What `env()`
 * names is the surface's own (`EnvironmentValues`), which arrives with the
 * root of every commit the engine styles.
 */
struct StyleEnvironment {
  MediaEnvironment media;
};

// What `hints()` reports of an element, before it is styled
enum StyleHint : uint32_t {
  // A declaration that may apply gives the element a box: a box `display`,
  // absolute or fixed position, a float, a grid placement
  StyleHintBox = 1u << 0,
  // An `overflow-x` that may scroll
  StyleHintScroll = 1u << 1,
  // A rule or a StyleX condition that may read the element's `:hover` or
  // `:active`, which a press drives: the author's styles answer a press
  StyleHintPressStates = 1u << 2,
  // A rule or a StyleX condition that may read the element's interaction
  // state, which it then has to report
  StyleHintStates = 1u << 3,
  // An `overflow` or `overflow-y` that may scroll
  StyleHintScrollBlock = 1u << 6,
  // A `display` that lays the children out in a row: flex or inline-flex.
  // With `StyleHintScrollBlock` and no `StyleHintFlexColumn`, the `overflow`
  // shorthand scrolls sideways: the row's items sit side by side with their
  // own widths, so the block-axis growth that stands in for a vertical scroll
  // container has nothing to grow
  StyleHintFlexRow = 1u << 7,
  // A `flex-direction` that stacks the children, or a `flex-wrap` that wraps
  // them: either way a row that would scroll sideways is not one
  StyleHintFlexColumn = 1u << 8,
  // An `overflow` or `overflow-y` that may clip the block axis (`hidden`,
  // `clip`): a region below the element that scrolls in that axis scrolls
  // rather than growing past the clip
  StyleHintClipBlock = 1u << 9,
};

} // namespace cssengine

/*
 * CSS for HTML elements, resolved in C++ while a tree is committed; see
 * README.md beside this file.
 */
class StyleEngine : public UIManagerCommitHook, public std::enable_shared_from_this<StyleEngine> {
 public:
  explicit StyleEngine(UIManager &uiManager);
  ~StyleEngine() override;

  StyleEngine(const StyleEngine &) = delete;
  StyleEngine &operator=(const StyleEngine &) = delete;

  /*
   * Installs `globalThis.__cssEngine`, the JavaScript side's way in.
   */
  static void installBindings(jsi::Runtime &runtime, std::weak_ptr<StyleEngine> engine);

  // -- Sheets, styles and the environment --

  int addStyleSheet(const std::string &text);
  void replaceStyleSheet(int id, const std::string &text);
  void removeStyleSheet(int id);
  int64_t registerStyle(const folly::dynamic &entries);
  void registerTokens(const folly::dynamic &entries);
  void registerKeyframes(const std::string &name, const folly::dynamic &frames);
  void setEnvironment(cssengine::StyleEnvironment environment);

  /*
   * Commits again every surface no pass has styled since the sheets, tokens
   * or environment last changed. A change does not commit by itself: the
   * commit that comes with it (a `<style>` rendered with its page, tokens
   * defined as a page's module loads) styles the tree under it, and the
   * runtime flushes once it is idle for the changes no commit followed.
   */
  void flush();

  // -- Queries --

  /*
   * The props the last pass gave the element, with its computed `color` and
   * font size, or null when no pass has styled it.
   */
  folly::dynamic computedStyle(const ShadowNode &node) const;

  /*
   * A custom property's computed value at the element, or null.
   */
  folly::dynamic customProperty(const ShadowNode &node, const std::string &name) const;

  bool matches(const ShadowNode &node, const std::string &selectors) const;

  // -- Script's inline style --

  /*
   * What script wrote to elements' inline styles through `element.style`
   * (cssom-1 §6.7): for each element, its declarations in the order written,
   * as `[property, value]` pairs, an empty list clearing them. They are the
   * element's inline style together with React's `style`, the last write to
   * a property winning: they apply over React's values, until React writes
   * a property anew (a value other than the one it had when script wrote
   * it). Restyles the elements whose declarations changed, and nothing else,
   * with a commit of its own: no JavaScript renders.
   */
  void setScriptStyles(
      const std::vector<std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>> &writes);

  /*
   * The declarations script wrote to the element's inline style that stand,
   * as `[property, value]` pairs: the ones React has not written since.
   */
  folly::dynamic scriptStyle(const ShadowNode &node) const;

  // -- Script's attributes --

  /*
   * What script wrote to elements' attributes through `setAttribute` and
   * `removeAttribute` (DOM §4.9): for each element, every attribute script
   * has written, as `[name, value]` pairs, a null value for one it removed,
   * an empty list clearing them. Selectors see them over React's attributes,
   * until React writes an attribute anew (a value other than the one it had
   * when script wrote it), as React DOM sets an attribute only when its prop
   * changes. Restyles the elements whose attributes changed, and nothing
   * else, with a commit of its own: no JavaScript renders.
   */
  void setScriptAttributes(const std::vector<std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>> &writes);

  // -- Interaction states --

  /*
   * Keeps the hover, active and focus states of the elements that ask for
   * them (`cssStateful`) from their pointer and focus events, as a browser
   * keeps `:hover`, `:active` and `:focus`, and restyles the surface with a
   * commit of its own: no JavaScript renders. Pointer enter and leave set and
   * clear hover (leave clears active too), down sets active on the target and
   * its stateful ancestors, up and cancel clear it, and focus and blur set
   * and clear focus and focus-visible. A disabled element has none of them.
   * Returns false, so the event goes on to JavaScript as before.
   */
  bool handleEvent(const RawEvent &event);

  /*
   * What the engine has done since the counters were last reset, for timing:
   * the style passes and their time, the elements resolved and the ones
   * whose last result was kept, the props parsed and the nodes cloned, and
   * the time in selector matching. Counters and a clock read per pass and per
   * resolved element, so always kept.
   */
  struct Stats {
    uint64_t passes{0};
    uint64_t passNanos{0};
    uint64_t nodesVisited{0};
    uint64_t subtreesKept{0};
    uint64_t elementsResolved{0};
    // Why: a new element, its props, its parent's context, its siblings, or
    // a change to the sheets, tokens or environment
    uint64_t resolvedNew{0};
    uint64_t resolvedProps{0};
    uint64_t resolvedParent{0};
    uint64_t resolvedSiblings{0};
    uint64_t resolvedGeneration{0};
    // An element whose own hover, active or focus state changed
    uint64_t resolvedStates{0};
    // An element that reads an `env()` value its surface changed
    uint64_t resolvedEnvironment{0};
    // An element whose inline style script wrote to
    uint64_t resolvedScriptWrites{0};
    uint64_t resolveNanos{0};
    uint64_t matchNanos{0};
    uint64_t elementsKept{0};
    // Elements whose new context their descendants could not tell apart
    uint64_t childContextsKept{0};
    uint64_t propsParsed{0};
    uint64_t propsParseNanos{0};
    uint64_t nodesCloned{0};
    uint64_t restyles{0};
    uint64_t snapshots{0};
    uint64_t stylesRegistered{0};
    uint64_t registerNanos{0};
    uint64_t hintsAsked{0};
    uint64_t hintsNanos{0};
    // Pointer and focus events that changed an element's state, and the
    // commits that restyled it
    uint64_t stateEvents{0};
    uint64_t stateCommits{0};
    uint64_t elementsKeptAcrossParent{0};
  };
  Stats stats() const;
  void resetStats();

  /*
   * What the cascade did for the element in the last pass, for debugging:
   * its declarations in cascade order, the longhands they came to, the rules
   * that matched and its own custom properties.
   */
  folly::dynamic explain(const ShadowNode &node) const;

  /*
   * `StyleHint` bits for an element with these inputs, over every state,
   * ancestor and media condition: what JavaScript has to know of an element
   * before the engine has styled it.
   */
  uint32_t hints(
      const std::string &tag,
      const std::string &className,
      const folly::dynamic &attributes,
      int64_t styleId,
      const folly::dynamic &inlineStyle) const;

 private:
  uint32_t hintsUncounted(
      const std::string &tag,
      const std::string &className,
      const folly::dynamic &attributes,
      int64_t styleId,
      const folly::dynamic &inlineStyle) const;

 public:
  // -- UIManagerCommitHook --

  void commitHookWasRegistered(const UIManager &uiManager) noexcept override;
  void commitHookWasUnregistered(const UIManager &uiManager) noexcept override;
  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree &shadowTree,
      const RootShadowNode::Shared &oldRootShadowNode,
      const RootShadowNode::Unshared &newRootShadowNode,
      const ShadowTreeCommitOptions &commitOptions) noexcept override;

  // Opaque outside the implementation
  struct Snapshot;
  struct CacheEntry;
  class Pass;

 private:
  std::shared_ptr<const Snapshot> snapshot() const;
  // Installs a new snapshot built from the sheets, tokens, keyframes and
  // environment. `sheetsChanged` rebuilds the rule index; `invalidates`
  // starts a new generation, under which every element is resolved again —
  // a change no element styled so far can depend on (keyframes, which only
  // a style naming them reads, and a style naming them is new) keeps the
  // generation. Called with `stateMutex_` held.
  void rebuildLocked(bool sheetsChanged = true, bool invalidates = true);
  void restyleAll();
  // Commits the surface again with the path to each element cloned, so the
  // pass visits those elements and nothing else
  void restyleElements(
      SurfaceId surfaceId,
      const std::vector<std::shared_ptr<const ShadowNodeFamily>> &families,
      bool mountSynchronously);
  std::shared_ptr<const cssengine::AuthorStyle> style(int64_t id) const;
  std::shared_ptr<const CacheEntry> entryFor(const ShadowNode &node) const;
  // The element as the committed tree has it, for a query: its context with
  // its ancestors' and its earlier siblings', each placed among its siblings
  // whether or not a sheet reads that. Called with `cacheMutex_` held.
  cssengine::SharedStyleContext queryContext(const ShadowNode &node) const;

  UIManager &uiManager_;
  // Set once the engine is given anything (a sheet, a style, tokens, the
  // environment): until then no element can be styled, and an app that does
  // not use the engine pays nothing per commit
  std::atomic<bool> active_{false};

  // What a snapshot is built from, guarded by `stateMutex_`
  mutable std::mutex stateMutex_;
  std::vector<std::pair<int, std::shared_ptr<const cssengine::StyleSheet>>> sheets_;
  int nextSheetId_{1};
  std::vector<std::pair<std::string, std::string>> tokens_;
  std::unordered_map<std::string, std::shared_ptr<const cssengine::AuthorStyle>> keyframes_;
  cssengine::StyleEnvironment environment_;
  uint64_t generation_{0};

  mutable std::mutex snapshotMutex_;
  std::shared_ptr<const Snapshot> snapshot_;

  // Registered StyleX styles by id, 1-based
  mutable std::shared_mutex stylesMutex_;
  std::vector<std::shared_ptr<const cssengine::AuthorStyle>> styles_;
  // Whether a registered style reads siblings, so every pass supplies them
  bool stylesReadSiblings_{false};
  // Whether a registered style says `inherit` on a property that does not
  // inherit
  // The properties that do not inherit on which a registered style says
  // `inherit`; see `RuleSet::explicitInherits`
  std::unordered_set<std::string> stylesExplicitInherits_;
  // What registered styles' `when.*` selectors read of an ancestor
  std::unique_ptr<cssengine::AncestorFeatures> stylesFeatures_;

  // The last pass's work, by shadow node family. Held while a pass runs.
  mutable std::mutex cacheMutex_;
  std::unordered_map<const ShadowNodeFamily *, std::shared_ptr<CacheEntry>> cache_;
  size_t cacheSizeAtLastSweep_{0};

  // The generation each surface was last styled under, guarded by
  // `cacheMutex_`
  std::unordered_map<SurfaceId, uint64_t> styledGeneration_;
  // The `env()` values each surface was last styled with, for `explain()`,
  // guarded by `cacheMutex_`
  std::unordered_map<SurfaceId, EnvironmentValues> surfaceEnvironments_;

  // `Stats`, each counter updated on its own
  struct Counters;
  std::unique_ptr<Counters> counters_;

  // The hover, active and focus states the engine keeps, by element tag
  struct NativeState {
    uint32_t states{0};
    SurfaceId surfaceId{0};
    std::weak_ptr<const ShadowNodeFamily> family;
  };
  mutable std::mutex nativeStatesMutex_;
  std::unordered_map<Tag, NativeState> nativeStates_;

  // What script wrote to elements' inline styles and attributes, by element
  // tag; see `setScriptStyles` and `setScriptAttributes`
  struct ScriptWrites;
  mutable std::mutex scriptWritesMutex_;
  std::unordered_map<Tag, std::shared_ptr<const ScriptWrites>> scriptWrites_;

  // Selector lists `matches()` was asked, parsed
  mutable std::mutex selectorsMutex_;
  mutable std::unordered_map<std::string, std::shared_ptr<const cssengine::SelectorList>> selectors_;
};

} // namespace facebook::react
