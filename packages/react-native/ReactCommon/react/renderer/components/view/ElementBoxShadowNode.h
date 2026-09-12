/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once


#include <react/renderer/components/view/ElementButtonShadowNode.h>

#include <string>

#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementBoxComponentName[];

/*
 * The box-backed flavor of a DOM element: a `View` that honors whatever
 * `display` the author wrote, and reports the authored tag.
 *
 * Box generation follows computed `display`, not the tag
 * (element-model-design.md). An intrinsic element is backed by the light
 * `TextShadowNode` while it folds into an inline formatting context, and by
 * this when its display establishes one. That is the same choice Blink makes
 * in `LayoutObject::CreateObject`, which constructs a different class per
 * computed display rather than one object that morphs.
 *
 * The two flavors are separate *components*, not one component with two node
 * types, and they have to be: a `ComponentDescriptor` derives its props type
 * from a single shadow node, so one component could not have both `TextProps`
 * and the much larger `ViewProps`. Keeping them separate is what lets a
 * folding `<span>` stay cheap while a box-flavored one gets the full View prop
 * surface.
 *
 * It forces no display of its own. An element is block because its user-agent
 * style says so, not because of the component backing it — which is what lets a
 * block element be defined without a C++ class, by anyone.
 *
 * Not addressable from JSX. The renderer swaps an element onto this component
 * at instance creation, which is why it carries `nodeName` — the element must
 * still report its own tag (`RN:span`, not `RN:element-box`).
 */
class ElementBoxProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementBoxProps() = default;
  ElementBoxProps(
      const PropsParserContext &context,
      const ElementBoxProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        listStyleTypeValue(
            convertRawProp(context, rawProps, "listStyleType", sourceProps.listStyleTypeValue, std::string{})),
        listStylePositionValue(
            convertRawProp(context, rawProps, "listStylePosition", sourceProps.listStylePositionValue, std::string{})),
        // NOT the raw HTML attribute name: `start` is ALSO Yoga's
        // inline-start inset, so `<ol start={98}>` forwarded verbatim both
        // seeded the counter and SHIFTED the whole list 98px — the component
        // translates the attribute to this private name (List.js), exactly
        // as <img> translates `src`.
        start(convertRawProp(context, rawProps, "listStart", sourceProps.start, 1)),
        /*
         * `href`, when this box is an `<a>`.
         *
         * An anchor is not always a run of glyphs. `display: 'block'` makes it
         * a box, and so does anything else that generates one — at which point
         * its destination cannot ride the text attributes, because the text
         * inside it belongs to an anonymous run that (correctly) does not
         * inherit the link.
         *
         * So the box carries it too, and the platform's link interaction is
         * installed on the view rather than over glyph rects. Same behaviour
         * for the author, two shapes underneath.
         *
         * On `ElementBoxProps` rather than `ViewProps`: this is an element
         * attribute, like `listStyleType` beside it, and every plain `<View>`
         * in every app has no business parsing one.
         */
        href(convertRawProp(context, rawProps, "href", sourceProps.href, std::string{})),
        /*
         * `-apple-visual-effect`, spelled as CSSOM spells it.
         *
         * WebKit's own private property for putting a system material behind
         * web content — the thing Liquid Glass is made of. The names are taken
         * from `CSSValueKeywords.in` rather than invented:
         * `-apple-system-blur-material{,-ultra-thin,-thin,-thick,-chrome}`
         * behind `HAVE_CORE_MATERIAL`, and `-apple-system-glass-material{,
         * -clear,-subdued,-media-controls,-media-controls-subdued}` behind
         * `HAVE_MATERIAL_HOSTING`.
         *
         * Matching WebKit's spelling rather than choosing one matters here: it
         * is the difference between implementing a platform property and
         * inventing a parallel one that will collide with it. It is not
         * queryable from a browser — the property is gated to embedders that
         * set a private `WKPreferences` flag — so the source is the only place
         * the names exist.
         *
         * DOM-CSS-LIMITATION(ios-only-materials): drawn on iOS only. The
         * keywords are Apple's and so are the two classes behind them
         * (`UIBlurEffect`, `UIGlassEffect`); Android ignores the prop and the
         * box keeps whatever background it was given. Android's nearest
         * equivalent is a `RenderEffect` blur of what is behind, which is a
         * different construction rather than the same one under another name —
         * so this is deliberately spelled `-apple-` rather than pretending to
         * be portable.
         */
        appleVisualEffect(
            convertRawProp(context, rawProps, "appleVisualEffect", sourceProps.appleVisualEffect, std::string{})),
        /*
         * How far the material fades in from its own top edge, in points.
         *
         * Zero — the default — is a material with a hard top edge, which is
         * what a field or a card wants. A BAR wants the other thing: the native
         * composer is a material that dissolves upward, so the transcript
         * slides under it rather than meeting a line, and the point where
         * chrome begins is not a place anything can be half in and half out of.
         */
        appleVisualEffectFade(convertRawProp(
            context,
            rawProps,
            "appleVisualEffectFade",
            sourceProps.appleVisualEffectFade,
            Float{0})),
        /*
         * `-apple-balloon-tail`, spelled like the other platform property here.
         *
         * A chat balloon is a rounded rectangle with a tail, and the two are
         * ONE shape: the platform's own balloon is a single `UIBezierPath`
         * masking the balloon's gradient, which is why the tail is never a
         * slightly different colour from the bubble it belongs to.
         *
         * CSS's spelling for an arbitrary shape is `clip-path: path(...)`, and
         * it cannot express this one: `path()` takes absolute coordinates, and
         * a balloon's path depends on a size only known after layout — which
         * changes on every frame of a send animation. So the shape is named and
         * the platform builds it from the box's own bounds.
         *
         * `left` | `right` | empty for none.
         *
         * DOM-CSS-LIMITATION(balloon-tail-clips-box-shadow): a `box-shadow` on
         * an element with a tail is clipped away. The shape is applied as a
         * mask on the view's own layer, and a layer's mask clips its shadow
         * along with everything else — so the shadow that would say "this
         * balloon is lifted above the page" cannot be drawn from the style
         * side. Closing it means casting the shadow from the same path, on a
         * layer that is not the masked one, which is work for here rather than
         * for whoever writes the style.
         *
         * DOM-CSS-LIMITATION(ios-only-balloon-tail): built on iOS only, where
         * the shape is a `CAShapeLayer` mask rebuilt each layout. Android
         * ignores it and the balloon is a plain rounded rectangle. Nothing about
         * the shape is iOS-specific — this one is unfinished rather than
         * blocked, and closing it is the same path in a `Drawable`.
         */
        wantsContextMenu(
            convertRawProp(context, rawProps, "wantsContextMenu", sourceProps.wantsContextMenu, false)),
        menuCommands(convertRawProp(
            context,
            rawProps,
            "menuCommands",
            sourceProps.menuCommands,
            std::vector<ElementMenuCommand>{})) {
    // ARIA, which is how an author of these elements spells accessibility.
    // Applied last so it wins over the `accessibility*` props, and applied
    // here rather than in the base so only elements pay for the reads.
    applyAriaAttributes(context, rawProps, *this);
  }

  // Empty when rendered without an authored tag, in which case core falls back
  // to the component name.
  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};

  /*
   * List properties. `list-style-type` and `list-style-position` are style
   * properties and `<ol start>` an HTML attribute, but all three live on the
   * props because markers are generated during layout, which reads them from
   * the shadow node rather than from a stylesheet.
   *
   * They sit on the generic box because a list container IS one: whichever
   * element a provider names `ul`, it is a box whose user-agent style says
   * `display: block`. An empty `listStyleTypeValue` means the container takes
   * the user-agent default for its nesting depth; an empty position means
   * `outside`.
   */
  std::string listStyleTypeValue{};
  std::string listStylePositionValue{};
  int start{1};

  /**
   * The link destination when this box is an `<a href>`; empty otherwise.
   *
   * Declared in initialiser order: a member initialiser list out of
   * declaration order is a `-Wreorder-ctor` error under the Android build's
   * `-Werror`, though not under Xcode's default warnings — so it compiles on
   * iOS and fails on Android, which is a confusing way to find out.
   */
  std::string href{};

  /**
   * The system material to draw behind this box, or empty for none.
   *
   * Paint only: it changes nothing about layout, which is why it lives here
   * rather than anywhere Yoga can see it.
   */
  std::string appleVisualEffect{};

  /**
   * The length of the material's fade-in from its top edge, in points.
   *
   * Paint only, like the material itself. Ignored when there is no material to
   * fade.
   */
  Float appleVisualEffectFade{0};

  /**
   * This box wants the PLATFORM's long press, not a timer.
   *
   * A gate, and it exists because the obvious condition cannot be tested from
   * here: `contextmenu` is a bubbling event, so React keeps the handler on its
   * own side and no prop announces it. Without a signal the choice is between
   * giving every box a `UIContextMenuInteraction` — which lifts whatever is
   * under a long finger, including the wrapper around a message rather than the
   * message — and giving none of them one.
   *
   * So a box asks. With it, the hold, its movement slop, the
   * scroll-cancels-the-hold rule, the lift and its haptic are all UIKit's, which
   * is what the platform's own chat uses for the same job. Without it the element still
   * publishes `contextmenu` from its own timer, so nothing that worked before
   * stops working.
   *
   * The same shape as `<img>`'s `shouldNotifyLoadEvents`: a flag set from
   * handler presence, because handler presence is not otherwise visible here.
   */
  bool wantsContextMenu{false};

  /**
   * The commands the platform's own peek presents, from a `<menu>` child.
   *
   * The same shape `<button>` takes, and for the same reason: a `<menu>` is
   * HTML's list of commands, and the element that owns one hands it to the
   * platform rather than laying it out. What differs is only who opens it — a
   * button opens its menu on a tap, a box on the hold `wantsContextMenu`
   * already asks UIKit for.
   *
   * Empty is the ordinary case, and it is what asks for the LIFT ALONE: a peek
   * with no menu is the preview by itself, which is what the element did before
   * there was any way to say otherwise.
   */
  std::vector<ElementMenuCommand> menuCommands{};
};

/**
 * `contextmenu` — a long press, spelled the way the web spells it.
 *
 * On a touch platform `contextmenu` IS the long press: it is the event a browser
 * fires when a finger rests on an element, and the one a page listens for to put
 * up something of its own. So a chat balloon that opens a reaction picker on a
 * hold is not reaching for a gesture recogniser; it is listening to the event
 * that already means this.
 *
 * Dispatched from the box's own `touchesBegan`/`touchesEnded`, not from a
 * `UILongPressGestureRecognizer`. That is where the platform has ALREADY waited
 * out an enclosing scroll view's `delaysContentTouches` and cancelled the touch
 * if the finger was leaving — so a hold that turns into a scroll never fires,
 * for free. A recogniser added alongside would have to be taught the same thing
 * and would get it slightly wrong.
 *
 * Every box gets it, and that costs nothing: the timer is scheduled in
 * `touchesBegan`, so a box nobody touches never runs any of this, and a box
 * whose event nobody listens for merely dispatches one ignored event per hold.
 */
class ElementBoxEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onContextMenu() const
  {
    dispatchEvent("contextMenu");
  }

  /**
   * A command chosen from the peek's own menu.
   *
   * Same event and same payload as `<button>`'s, so an author who has written
   * one `<menu>` has written both: the command carries its own handler and the
   * element reports which one ran.
   */
  void onCommand(const std::string& identifier) const
  {
    dispatchEvent("command", [identifier](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "id", jsi::String::createFromUtf8(runtime, identifier));
      return payload;
    });
  }
};

using ElementBoxShadowNode =
    AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps, ElementBoxEventEmitter>;
using ElementBoxComponentDescriptor = ConcreteComponentDescriptor<ElementBoxShadowNode>;

} // namespace facebook::react
