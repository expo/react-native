/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The HTML element catalog — every element, defined outside react-native.
 *
 * A side-effect import. Lowercase JSX types resolve by name through
 * ReactNativeViewConfigRegistry, so registering a view config under a tag is all
 * it takes for literal <span>, <p> or <h1> to work, with no reconciler change
 * and — for everything here except <img> — no native code.
 *
 * An element is three things:
 *
 *   - a TAG NAME, which is the registration key and what `nodeName` reports;
 *   - a USER-AGENT STYLE, which is every default a browser would apply, merged
 *     beneath the author's style so an author declaration still wins;
 *   - a BACKING COMPONENT, which is one of the two react-native offers —
 *     `inline-text` for an element that folds into a line of text, and
 *     `element-box` for one that generates a box — chosen from the computed
 *     `display` rather than from the tag.
 *
 * Block versus inline is therefore not a fourth thing to declare. It is what
 * the user-agent style says, and the rest follows.
 *
 * react-native supplies the machinery these render against — text nodes, the
 * anonymous inline formatting contexts, Yoga's block display, the lazy
 * descriptor seam — and names none of these elements.
 */

import type {UAStyle} from './uaStyles';

import Anchor from './Anchor';
import {withoutOutrankedBoxEdges} from './boxEdges';
import Button from './Button';
import {
  defineReactComponent,
  registerFrameworkComponent,
  registerFrameworkElement,
} from './ElementRegistry';
import Fieldset from './Fieldset';
import Form from './Form';
import {LEVELS as HEADING_LEVELS, makeHeading} from './Heading';
import Img from './Img';
import Input from './Input';
import Label from './Label';
import {LIST_TAGS, makeList} from './List';
import NativeChatBubble from './NativeChatBubble';
import NativeKeyboardAccessory from './NativeKeyboardAccessory';
import NativeMenuButton from './NativeMenuButton';
import NativeSafeArea from './NativeSafeArea';
import NativeScroll from './NativeScroll';
import Picture from './Picture';
import Quote from './Quote';
import Select from './Select';
import {systemColor} from './systemColors';
import TextArea from './TextArea';
import uaStyles, {
  CHECKABLE_FOOTPRINT_BY_PLATFORM,
  FIELD_SURFACE,
  RADIO_FOOTPRINT_BY_PLATFORM,
  buttonLabelColor,
  uaStyleFor,
} from './uaStyles';
import {Platform} from 'react-native';
import {createViewConfig} from 'react-native/Libraries/NativeComponent/ViewConfig';
import {type ViewConfig} from 'react-native/Libraries/Renderer/shims/ReactNativeTypes';
import {setFallbackViewConfigResolver} from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

const inlineTagViewConfig = {
  validAttributes: {
    isHighlighted: true,
    isPressable: true,
    maxFontSizeMultiplier: true,
  },
} as const;

/**
 * The user-agent style for a tag, as a function of the element's props.
 *
 * The sheet has to see the author's style to get out of its way: the two
 * layers merge by key, and where they spell an edge differently the sheet's
 * more specific spelling wins in Yoga whatever the cascade said. Without it
 * `<ol>`'s `paddingInlineStart: 40` survives `padding: 0`, the reset every
 * ported design system writes. See `boxEdges.js`.
 */
function uaStyleForProps(tag: string): (props: {[string]: unknown}) => UAStyle {
  return (props: {[string]: unknown}) =>
    withoutOutrankedBoxEdges(uaStyleFor(tag), props?.style);
}

function registerInlineTag(name: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {...inlineTagViewConfig.validAttributes, nodeName: true},
      // The authored tag rides along so the element reports itself whichever
      // component ends up backing it.
      recordNodeName: true,
      uiViewClassName: 'inline-text',
      resolveUIViewClassName: resolveInlineElementComponent(
        'inline-text',
        uaStyleFor(name),
      ),
      // <b>'s bold and <i>'s italics live in the UA sheet, not in their C++
      // props classes.
      uaStyle: uaStyleForProps(name),
    }),
  );
}

// Bold, italic and underline are declarations in the user-agent sheet, not
// components — so these are aliases of the generic inline backing like every
// other unstyled inline element, and react-native ships no `b`, `i` or `u`.
registerInlineTag('b');
registerInlineTag('i');
registerInlineTag('u');
registerInlineTag('span');

// The intrinsic <img> tag: an inline *replaced* element (text-children-plan.md
// §3.C) — it flows inside a bare-text IFC as an inline attachment, positioned
// by the owning View's attachment-layout pass.
//
// Which native component backs it depends on the host. When the Expo runtime is
// present, <img> is expo-image — the SDK's image component, with its caching,
// format support and SwiftUI awareness — and this is the catalog's first
// SDK-backed element. Elsewhere (Fantom, bare hosts) it falls back to the
// framework's Image machinery. Resolved lazily at first render, by which time
// the native runtime is up; layout treats both the same way, through the
// InlineText + InlineReplaced traits their shadow nodes declare.
// Registered under its own host name because the tag `img` is a *component*
// (Img.js): `src`, `srcset`, `alt` and `object-fit` are translations rather than
// renames, so they are done in JavaScript and the box below is what it renders.
// The native class name stays `img` — the JSX tag and the native component are
// independent, which is what lets the element keep its C++ `ImgTagComponentName`
// while the tag itself becomes a component.
registerFrameworkElement('element-img', () => {
  // $FlowFixMe[unclear-type] the Expo runtime global has no static type here.
  // $FlowFixMe[prop-missing] `expo` is installed by expo-modules-core at runtime.
  const expoRuntime: any = globalThis.expo;
  const expoViewConfig = expoRuntime?.getViewConfig?.('ExpoImage');
  if (expoViewConfig != null) {
    return createViewConfig({
      ...expoViewConfig,
      validAttributes: {
        ...expoViewConfig.validAttributes,
        // The HTML-shaped singular source; expo-image's native side takes a
        // list of them.
        source: {
          process: (src: unknown) =>
            src == null || Array.isArray(src) ? src : [src],
        },
        nodeName: true,
      },
      // No `recordNodeName`: that would record `element-img`, and the DOM name
      // is `img`, which the component states.
      uiViewClassName: 'ViewManagerAdapter_ExpoImage',
      uaStyle: uaStyleFor('img'),
    });
  }
  return createViewConfig({
    // The image-load events the Image machinery fires must be declared, or the
    // reconciler rejects e.g. "topLoadStart".
    directEventTypes: {
      topLoadStart: {registrationName: 'onLoadStart'},
      topProgress: {registrationName: 'onProgress'},
      topError: {registrationName: 'onError'},
      topLoad: {registrationName: 'onLoad'},
      topLoadEnd: {registrationName: 'onLoadEnd'},
    },
    validAttributes: {
      // The same singular-to-list conversion the `expo-image` branch does, and
      // for the same reason: `<img src>` is one source, while both platforms'
      // image views take a list of candidates. Android's `RCTImageView.setSource`
      // takes a `ReadableArray` outright, so a bare object reaches it as the
      // wrong shape and draws nothing.
      source: {
        process: (src: unknown) =>
          src == null || Array.isArray(src) ? src : [src],
      },
      resizeMode: true,
      // The Android event gate — see Img.js, which sets it from handler
      // presence. Without it in the attribute set the flag never reaches the
      // view and load/error events fire on iOS only.
      shouldNotifyLoadEvents: true,
      nodeName: true,
      tintColor: {
        process: require('react-native/Libraries/StyleSheet/processColor')
          .default,
      },
    },
    uiViewClassName: 'img',
    uaStyle: uaStyleFor('img'),
  });
});

/**
 * The inline box for an element whose tag is a *component*.
 *
 * Same shape as `registerInlineAlias`, minus `recordNodeName`: that stamps the
 * JSX type onto `nodeName`, which for a component-backed element is the host
 * name (`element-q`) rather than the DOM name (`q`). The component states the
 * DOM name instead, and the UA style is looked up under it, so the host name
 * stays an implementation detail.
 *
 * This is the inline counterpart of `registerBlockElementUnderName`.
 */
function registerInlineElementUnderName(hostName: string, domName: string) {
  registerFrameworkElement(hostName, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {...inlineTagViewConfig.validAttributes, nodeName: true},
      uiViewClassName: 'inline-text',
      resolveUIViewClassName: resolveInlineElementComponent(
        'inline-text',
        uaStyleFor(domName),
      ),
      uaStyle: uaStyleForProps(domName),
    }),
  );
}

/**
 * Elements whose rendering is identical to an already-registered intrinsic.
 * They point at that intrinsic's native component through `uiViewClassName`,
 * so they need no shadow node, descriptor or native code of their own — the
 * same view-config aliasing that maps an intrinsic onto any existing RN
 * component.
 *
 * The authored tag is preserved for DOM APIs: a view config is per-component,
 * not per-tag, so `recordNodeName` has the reconciler stamp the JSX type onto a
 * `nodeName` prop that the element reports through `NodeNameProvider`. Without
 * it an aliased <strong> would identify as <b>.
 */
function registerInlineAlias(name: string, uiViewClassName: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {
        ...inlineTagViewConfig.validAttributes,
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName,
      resolveUIViewClassName: resolveInlineElementComponent(
        uiViewClassName,
        uaStyleFor(name),
      ),
      uaStyle: uaStyleForProps(name),
    }),
  );
}

// Their bold/italic now comes from the UA sheet, so they alias the unstyled
// <span> — one source of truth for the default, and no dependence on <b>/<i>
// happening to carry it.
// A forced line break. Registered as an inline element so it takes part in the
// inline formatting context; the break itself is emitted by
// `BaseTextShadowNode`, which gives it a newline that survives whitespace
// collapsing (css-text-3 §3 collapses ordinary newlines to a space).
registerInlineAlias('br', 'inline-text');
registerInlineAlias('strong', 'inline-text');
registerInlineAlias('em', 'inline-text');
// Inline and clickable: DOM click events already dispatch to inline elements
// (W3C pointer events), so <a> needs no gesture handler or Pressable to be
// interactive — an `onClick` on the element is enough.
//
// Its user-agent style is a FUNCTION of its props, which is what a browser's
// own sheet does here: the colour and underline come from `a:link`, and that
// selector matches an anchor *with an href*. A bare <a> used as a jump target
// or a placeholder is unstyled text, and styling it blue would be wrong.
// `:visited` is deliberately not attempted; see the limitations note.
const anchorLinkUAStyle: UAStyle = {
  ...uaStyleFor('a'),
  /*
   * The PLATFORM's link colour, not the browser's `-webkit-link` blue.
   *
   * `#0000EE` is a fixed sRGB value: it does not move for dark mode, for
   * increased contrast, or for a Material You palette, so a document in dark
   * mode gets 1990s hyperlink blue on near-black — legible, and unmistakably
   * not a native app. `LinkText` resolves to `UIColor.linkColor` on iOS and
   * `?android:attr/textColorLink` on Android, both of which re-resolve per
   * trait collection and per configuration, so the theme arrives without this
   * file knowing the theme exists.
   *
   * Android names the LINK colour specifically rather than `colorPrimary`:
   * `colorPrimary` is the app's brand accent — it tints buttons and switches,
   * and under Material You it follows the wallpaper, so links would change
   * colour with the user's home screen and could collide with a nearby filled
   * button. `textColorLink` is the platform's own answer for this exact
   * question and is what a `TextView` with `autoLink` uses.
   */
  color: systemColor('LinkText'),
  /*
   * UNDERLINED ON ANDROID ONLY, because that is where the platform underlines.
   *
   * Asked rather than assumed: `UITextView`'s default `linkTextAttributes`
   * contains a colour and no underline attribute at all, so an underlined link
   * in an iOS document reads as a web page — pinned in
   * `EXPLinkTextAttributesTests`. Android is the opposite: `URLSpan` sets
   * `setUnderlineText(true)` in `updateDrawState`, and Material's guidance for
   * links in body text asks for the underline explicitly.
   *
   * DOM-CSS-DEVIATION(ios-links-are-not-underlined): `html.css` underlines
   * every `a:link` and iOS does not.
   *
   * The accessibility tradeoff is real and is the platform's to make: without
   * an underline the link is distinguished from body text by COLOUR ALONE,
   * which WCAG 1.4.1 warns against. iOS's answer is that its link colour clears
   * the contrast bar against label colour; an author who disagrees can state
   * `textDecorationLine` and win, as with any user-agent default.
   */
  textDecorationLine: Platform.OS === 'ios' ? 'none' : 'underline',
};
// The host `<a>` renders. Registered under its own name because the tag is a
// component — see Anchor.js: an anchor with an href is a link and has to carry
// that role, which is a prop rather than a style.
registerFrameworkElement('element-a', () =>
  createViewConfig({
    ...inlineTagViewConfig,
    validAttributes: {
      ...inlineTagViewConfig.validAttributes,
      nodeName: true,
      href: true,
      // HTML's implicit role for an anchor that has an href. It has to be
      // declared here to survive: an attribute the view config does not list is
      // dropped before it reaches the text attributes, which is why setting the
      // role alone produced no accessibility element at all.
      accessibilityRole: true,
    },
    // No `recordNodeName`: the host is `element-a` and the DOM name is `a`,
    // which the component states.
    uiViewClassName: 'inline-text',
    resolveUIViewClassName: resolveInlineElementComponent(
      'inline-text',
      uaStyleFor('a'),
    ),
    uaStyle: (props: {[string]: unknown}) =>
      props?.href != null ? anchorLinkUAStyle : uaStyleFor('a'),
  }),
);

// <button> is the first element with a native interaction backing. Its UA
// `display: inline-block` already makes it a box, so what changes here is only
// *which* box: `element-button`, which carries a press event emitter and, with
// `enableNativeGestureRecognizers` on, installs a real platform gesture
// recognizer.
//
// That recognizer does not dispatch the click. Activation already works and is
// already right — the pointer handler dispatches `click` natively and suppresses
// it when an enclosing scroll view scrolled during the gesture — so emitting one
// here too would fire every handler twice. What the recognizer adds is the press
// *state*, which nothing reports today: `:active` cannot be evaluated without
// it, and a press stolen by a scroll has to un-press without JavaScript
// deciding when.
// The box `<button>` renders. Registered under its own name because the tag is
// a component — see Button.js for why HTML's default `type="submit"` makes that
// necessary.
/*
 * The colour a disabled control's text takes.
 *
 * A browser greys a disabled control, and it is not cosmetic: a control that
 * looks usable and is not reads as a broken app rather than a disabled control.
 *
 * A COLOUR rather than an `opacity` on the box, deliberately. Opacity would
 * double-dim the controls that already grey themselves from `isEnabled` —
 * `<input type="range">` and `<select>` — and would fade an author's background
 * along with the label. Colour is inherited, so it reaches whatever the
 * control's label is made of and nothing else.
 *
 * Both platforms name their own "present but inert" label colour rather than
 * stating values, so a disabled element follows light and dark and sits at the
 * same weight as the disabled system controls beside it. Theming by default is
 * the one place worth departing from the web, where a user-agent sheet would
 * hand back a fixed grey: a native app themes without being asked, and an
 * element that does not looks imported.
 *
 * `PlatformColor` on Android reaches these through
 * `ColorPropConverter.resolveThemeAttribute`, which has to read a
 * ColorStateList: `TypedValue.data` holds a colour only when the attribute is a
 * literal one, and the platform's text colours are ColorStateLists. Trusting it
 * returns an invisible colour. See `ColorPropConverterTest`.
 */
// `GrayText` is CSS's own name for disabled text, resolved per platform in
// `systemColors.js`.
const DISABLED_TEXT_COLOR: unknown = systemColor('GrayText');

registerFrameworkElement('element-button-box', () =>
  createViewConfig({
    ...inlineTagViewConfig,
    validAttributes: {
      ...inlineTagViewConfig.validAttributes,
      nodeName: true,
      disabled: true,
      // CSS `touch-action`. `none` claims a gesture that starts on this
      // element, so an enclosing scroll container may not steal it — the
      // behaviour a scrubbable control needs. Declared as an attribute rather
      // than a style because the renderer's style pipeline does not carry it.
      touchAction: true,
      // The platform prominence ('prominent' | 'neutral') and whether the
      // author has claimed the surface — both computed in Button.js, both read
      // by the platform views to decide what chrome to draw.
      buttonStyle: true,
      hasAuthorChrome: true,
      // Whether the author's styles answer a press themselves, so the platform
      // does not answer it too. See ElementButtonShadowNode.h.
      authorStatesPressFeedback: true,
      // The commands a `<menu>` child was flattened into. Data, not content:
      // a platform menu is drawn in a window the app does not own, so there is
      // nothing for child shadow nodes to lay out. See Button.js.
      menuCommands: true,
      // `-apple-visual-effect` on a button, because a glass control is a
      // button with a material behind it, which is what the platform's own
      // composer button is. Declared here or it never reaches the shadow node.
      appleVisualEffect: true,
      appleVisualEffectFade: true,
    },
    directEventTypes: {
      topElementPressChange: {registrationName: 'onPressChange'},
      topElementCommand: {registrationName: 'onCommand'},
    },
    // No `recordNodeName`: the host is registered under its own name, and the
    // component states the DOM name.
    uiViewClassName: 'inline-text',
    resolveUIViewClassName: resolveInlineElementComponent(
      'inline-text',
      uaStyleFor('button'),
      'element-button',
    ),
    uaStyle: (props: {[string]: unknown}) => buttonUAStyle(props),
  }),
);

/**
 * `<button>`'s user-agent style for a given set of props.
 *
 * Named and shared because `<input type=submit|reset|button>` needs the same
 * one. They are buttons — the same native view, the same press tracking — and
 * HTML gives them the same appearance, so they must not be able to disagree
 * about what a button looks like.
 */
function buttonUAStyle(props: {[string]: unknown}): {[string]: unknown} {
  let style: {[string]: unknown} = uaStyleFor('button');
  /*
   * The chrome is a unit. The platter, the content insets, the minimum touch
   * height and the label typography are one design — each measured against
   * the others on a real platform button — so when the author claims the
   * surface (`hasAuthorChrome`, computed next to the style prop in
   * Button.js/Input.js and also read by the platform views to hide the
   * platter), the metrics that exist to fit that platter withdraw with it.
   * What remains is the neutral inline-block box a preflight-reset web
   * <button> is: contents centred, typography and colour inherited — which
   * is the world design systems that restyle every control are written for.
   *
   * DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit): on the web an
   * author background keeps the UA padding (~2px) and ButtonText colour.
   * Here the insets are platform chrome metrics, not web's hairlines, and
   * keeping them under an author's surface would look like neither platform
   * nor web. Informational.
   */
  if (props?.hasAuthorChrome === true) {
    return without(style, CHROME_METRIC_KEYS);
  }
  // The prominent variant's label — white on iOS's filled configuration,
  // `colorOnPrimary` on Material's filled button. The surface itself is the
  // platform view's to draw; only the label colour rides through the sheet,
  // because the renderer draws the label.
  if (props?.buttonStyle === 'prominent') {
    style = {...style, color: buttonLabelColor(true)};
  }
  if (props?.disabled === true) {
    style = {...style, color: DISABLED_TEXT_COLOR};
  }
  const authorStyle = props?.style;
  if (authorStates(authorStyle, PADDING_KEYS)) {
    style = without(style, PADDING_KEYS);
  }
  if (authorStates(authorStyle, HEIGHT_KEYS)) {
    style = without(style, HEIGHT_KEYS);
  }
  return style;
}
/*
 * The padding half of `<button>`'s user-agent style, withdrawn when the author
 * states any padding of their own.
 *
 * This is the cascade, done where it can be done. A user-agent declaration is a
 * lower origin than an author's, so `<button style={{padding: 0}}>` must win —
 * but React Native has no origins. Styles are flattened by key and Yoga then
 * resolves by EDGE SPECIFICITY, and `paddingInline`/`paddingBlock` are applied
 * by `applyAliasedProps` unconditionally (aliases "with precedence"). So a
 * user-agent `paddingInline: 8` beats an author's `padding: 0`, and the cascade
 * runs backwards — measured, not assumed: the fixture asserting 2 got 10.
 *
 * That is the same inversion that makes `<p>`'s longhand margin workaround
 * unacceptable, so it is not one to accept here either. `<button>` already
 * supplies its user-agent style through a FUNCTION of its props, which is the
 * seam for exactly this: if the author has said anything about padding, ours
 * does not participate.
 *
 * DOM-CSS-LIMITATION(no-cascade-origins): the general problem remains. Any
 * user-agent entry written in a more specific spelling than the author's
 * overrides it, and only elements with a `uaStyle` function can opt out.
 */
const PADDING_KEYS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingStart',
  'paddingEnd',
  'paddingHorizontal',
  'paddingVertical',
  'paddingBlock',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInline',
  'paddingInlineStart',
  'paddingInlineEnd',
];

/*
 * The block-size half of the same problem.
 *
 * `<button>`'s user-agent `minHeight` is the platform's minimum touch target,
 * and CSS is unambiguous that `min-height` beats `height` — so it is correct,
 * right up until an author states a height and does not get it. That is not
 * hypothetical: a radio's 16pt indicator and a switch's 24pt track are both
 * built out of `<button>`, and a 44pt floor turns each of them into a 44pt box.
 *
 * A control that states its own height owns its geometry, exactly as one that
 * states its own padding does, so the user-agent minimum withdraws on the same
 * terms. `maxHeight` counts too: an author capping the height below the minimum
 * has expressed the same intent even more explicitly.
 */
const HEIGHT_KEYS = ['height', 'minHeight', 'maxHeight'];

/*
 * Everything in the user-agent button entry that exists to fit the platform
 * platter: its insets, its minimum touch height, and the label typography
 * measured against it. Withdrawn together when the author claims the surface
 * — see `buttonUAStyle`. The box-model basics stay: `display`, `textAlign`,
 * `alignContent` and `flexShrink` describe what a button IS (an inline-block
 * whose label centres and whose width floors at its content), not what the
 * platform's chrome looks like.
 */
const CHROME_METRIC_KEYS = [
  ...PADDING_KEYS,
  ...HEIGHT_KEYS,
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'color',
];

function authorStates(style: unknown, keys: ReadonlyArray<string>): boolean {
  if (style == null) {
    return false;
  }
  if (Array.isArray(style)) {
    return style.some(entry => authorStates(entry, keys));
  }
  if (typeof style !== 'object') {
    return false;
  }
  const asObject: {[string]: unknown} = style as $FlowFixMe;
  return keys.some(key => asObject[key] != null);
}

function without(
  style: {[string]: unknown},
  keys: ReadonlyArray<string>,
): {[string]: unknown} {
  const out: {[string]: unknown} = {...style};
  for (const key of keys) {
    delete out[key];
  }
  return out;
}

// <label> names the control it is for — see Label.js. The box is a plain
// inline run; what the component adds is the association, which
// is the difference between a control that announces "switch, off" and one that
// announces what it switches.
registerInlineElementUnderName('element-label', 'label');
registerFrameworkComponent('label', Label);

// <input>: one tag standing for about twenty controls, dispatched on `type`.
//
// The backing is chosen per instance from the `type` prop, which the renderer
// already supports (`resolveUIViewClassName`) — a checkbox and a slider are not
// variations of one widget, and on the platform they are different controls
// entirely. Types not yet implemented keep today's behaviour rather than
// silently rendering an empty box: they fall through to the inline unknown
// element, exactly as an unregistered tag does.
//
// `type="range"` is a real platform slider (`UISlider` / Android's seek bar).
// It is the first element whose gesture is a *drag it owns*: an enclosing
// scroll container must not cancel a scrub, which is what `touch-action`
// expresses and what the native views assert for themselves.
const INPUT_BACKING: {[string]: string} = {
  range: 'element-range',
  checkbox: 'element-checkbox',
  radio: 'element-radio',
  // The date and time family, which share one picker element and differ by
  // which of the two halves it shows.
  date: 'element-date-input',
  time: 'element-date-input',
  'datetime-local': 'element-date-input',
  color: 'element-color-input',
  file: 'element-file-input',
  // The textual types differ by keyboard and masking, not by control: one
  // field backs them all, and the `type` prop is what it reads to decide.
  text: 'element-text-input',
  password: 'element-text-input',
  email: 'element-text-input',
  number: 'element-text-input',
  tel: 'element-text-input',
  url: 'element-text-input',
  search: 'element-text-input',
  // The button flavours of `<input>`. They are buttons — the same element that
  // backs `<button>` — and differ only in what the form does with them, which
  // is a form's concern rather than a control's.
  submit: 'element-button',
  reset: 'element-button',
  button: 'element-button',
};

/**
 * The `<input>` types that ARE buttons, derived from the backing map rather
 * than listed again — the two cannot drift, and a type that gains a button
 * backing gains a button's appearance in the same edit.
 */
const BUTTON_INPUT_TYPES: Set<string> = new Set(
  Object.keys(INPUT_BACKING).filter(
    type => INPUT_BACKING[type] === 'element-button',
  ),
);

const TEXTUAL_INPUT_TYPES = new Set([
  'text',
  'password',
  'email',
  'number',
  'tel',
  'url',
  'search',
]);

// Browsers size form controls from their user-agent sheet, and the platforms
// disagree about how tall a slider's touch target should be: iOS draws a
// `UISlider` 31pt high, Android's seek bar wants a 48dp target. Neither is
// "the" answer, so each gets its own — an author width/height still wins.
const RANGE_UA_HEIGHT = Platform.OS === 'android' ? 48 : 31;

registerFrameworkElement('element-input', () =>
  createViewConfig({
    validAttributes: {
      nodeName: true,
      type: true,
      buttonStyle: true,
      hasAuthorChrome: true,
      authorStatesPressFeedback: true,
      checked: true,
      name: true,
      value: true,
      defaultValue: true,
      min: true,
      max: true,
      step: true,
      disabled: true,
      readOnly: true,
      placeholder: true,
      maxLength: true,
      autoFocus: true,
      spellCheck: true,
      autoCorrect: true,
      autoComplete: true,
      enterKeyHint: true,
      inputMode: true,
      accept: true,
      multiple: true,
      // The echo half of the controlled-input handshake described on
      // `ElementTextInputEventEmitter::onElementInput`: the highest event
      // count JavaScript has processed, which the view compares against its
      // own before writing a `value` back.
      mostRecentEventCount: true,
      // Whether a `beforeinput` handler exists. The synchronous path blocks the
      // JavaScript thread per keystroke, so it is only taken when it is used.
      hasBeforeInput: true,
      touchAction: true,
    },
    directEventTypes: {
      // The DOM's two: `input` fires for every intermediate value while
      // scrubbing, `change` only for the value the user settled on.
      topElementInput: {registrationName: 'onInput'},
      topElementChange: {registrationName: 'onChange'},
      topElementFocus: {registrationName: 'onFocus'},
      topElementBlur: {registrationName: 'onBlur'},
      topElementSubmit: {registrationName: 'onSubmit'},
      topElementSelectionChange: {registrationName: 'onSelect'},
      // Dispatched synchronously, before the control applies the edit.
      topElementBeforeInput: {registrationName: 'onBeforeInput'},
    },
    // No `recordNodeName`: the host is `element-input` and the DOM name is
    // `input`, which the component states.
    uiViewClassName: 'inline-text',
    resolveUIViewClassName: (props: {[string]: unknown}) => {
      const type = typeof props?.type === 'string' ? props.type : 'text';
      return INPUT_BACKING[type] ?? 'inline-text';
    },
    uaStyle: (props: {[string]: unknown}) => ({
      /*
       * The table entry first, so this keeps the initial values every other
       * element gets — `color` among them. A `uaStyle` FUNCTION that builds a
       * fresh object silently opts out of them, which is how a control's label
       * becomes the one piece of text that does not theme.
       */
      ...uaStyleFor('input'),
      /*
       * `<input type=submit|reset|button>` IS a button, and looks like one.
       *
       * It resolves to `element-button` — the same native view `<button>`
       * mounts, with the same press tracking — but appearance is keyed off the
       * TAG, and `<input>`'s entry is the text field's. Without this the three
       * have a button's every behaviour and none of its chrome, and draw as
       * bare text: `<input type="submit">` indistinguishable from the word
       * "Submit" sitting in the paragraph. HTML and every browser give
       * them the same appearance as `<button>`, so they get the same style
       * object, from the same place.
       */
      ...(BUTTON_INPUT_TYPES.has(
        typeof props?.type === 'string' ? props.type : 'text',
      )
        ? buttonUAStyle(props)
        : null),
      // Size hints next, so the box type below cannot be displaced by them.
      ...inputSizeUAStyle(props),
      /*
       * Every form control is `display: inline-block` in a browser, and that is
       * not decoration: it is what lets a control sit *in a line of text*, which
       * is exactly how `<label><input> Subscribe</label>` is written. Without it
       * the control is block-level and takes a line of its own, so the label's
       * text falls beneath its checkbox — the same failure `<img>` would have,
       * and the same fix, because the box type belongs in the user-agent sheet.
       */
      display: 'inline-block',
    }),
  }),
);

/**
 * The size a control is born with, per type — each platform's own footprint for
 * that widget. Split out from the box type above so the two are not tangled:
 * this answers "how big", `display: inline-block` answers "what kind of box".
 */
function inputSizeUAStyle(props: {[string]: unknown}): {[string]: unknown} {
  switch (props?.type) {
    case 'range':
      return {width: 160, height: RANGE_UA_HEIGHT};
    case 'checkbox':
      return {
        ...CHECKABLE_FOOTPRINT_BY_PLATFORM[
          Platform.OS === 'android' ? 'android' : 'ios'
        ],
      };
    case 'file':
      // A button reading "Choose File", as a browser draws it — wide enough
      // for the chosen-file text that replaces the label.
      return Platform.OS === 'android'
        ? {width: 200, height: 48}
        : {width: 180, height: 36};
    case 'color':
      // A swatch. Browsers draw a small rectangle of the colour; both
      // platforms here do the same, sized for a comfortable touch target.
      return Platform.OS === 'android'
        ? {width: 64, height: 48}
        : {width: 52, height: 32};
    case 'datetime-local':
      // Wider than `date` and `time`, because the compact `UIDatePicker`
      // draws *two* pills for this type — a date and a time — and at the
      // 160pt those get it truncates the date to "8/2…". A control that
      // cannot show its own value is not a default worth keeping.
      return Platform.OS === 'android'
        ? {width: 260, height: 48}
        : {width: 220, height: 36};
    case 'date':
    case 'time':
      // A field showing the current value: the compact `UIDatePicker` on
      // iOS is small, Android's is a full-width button.
      return Platform.OS === 'android'
        ? {width: 220, height: 48}
        : {width: 160, height: 36};
    case 'radio':
      // Square, unlike the checkbox: a radio is a circle on both platforms.
      // The box is the touch target and the circle is drawn at its own design
      // size inside it — see RADIO_FOOTPRINT_BY_PLATFORM for why, and for the
      // margins that keep the LABEL the platform's distance from the ink
      // rather than from the box.
      return {
        ...RADIO_FOOTPRINT_BY_PLATFORM[
          Platform.OS === 'android' ? 'android' : 'ios'
        ],
      };
    default:
      // A text field's size comes from the platform's own: iOS lays out a
      // rounded-rect `UITextField` about 36pt tall, Android's `EditText`
      // sits on a 48dp touch target. Width is the browser's ~20-character
      // default, which an author style still overrides.
      const inputType = typeof props?.type === 'string' ? props.type : 'text';
      if (TEXTUAL_INPUT_TYPES.has(inputType)) {
        // The field SURFACE rides with the size: both are "what a text-entry
        // control looks like here", and neither belongs on checkables,
        // buttons, or pickers, which own their chrome. See FIELD_SURFACE.
        // Android: Material's filled text field container is 56dp tall with
        // 16dp inline padding (the padding rides in FIELD_SURFACE) — the field
        // spec, not the generic 48dp touch-target floor.
        return Platform.OS === 'android'
          ? {width: 200, height: 56, ...FIELD_SURFACE}
          : {width: 200, height: 36, ...FIELD_SURFACE};
      }
      // No intrinsic size for this type; the element keeps whatever the
      // backing control gives it.
      return {};
  }
}

// `<textarea>`: multi-line text. A separate element rather than a flag on
// `<input>`, because that is what HTML calls it and because iOS draws the two
// with unrelated classes — a `UITextField` and a `UITextView`.
//
// No `onSubmit` here on purpose: Return inserts a newline in a textarea, so
// there is no submit key to report.
registerFrameworkElement('element-textarea', () =>
  createViewConfig({
    validAttributes: {
      nodeName: true,
      value: true,
      defaultValue: true,
      placeholder: true,
      disabled: true,
      readOnly: true,
      maxLength: true,
      autoFocus: true,
      spellCheck: true,
      autoCorrect: true,
      rows: true,
      name: true,
      mostRecentEventCount: true,
      // CSS's `caret-color`. Declared here or it never reaches the shadow node,
      // and `processColor` because a colour arrives as a string or a dynamic
      // colour object and the shadow node reads neither.
      caretColor: {
        process: require('react-native/Libraries/StyleSheet/processColor')
          .default,
      },
    },
    directEventTypes: {
      topElementInput: {registrationName: 'onInput'},
      topElementChange: {registrationName: 'onChange'},
      topElementFocus: {registrationName: 'onFocus'},
      topElementBlur: {registrationName: 'onBlur'},
      topElementSelectionChange: {registrationName: 'onSelect'},
      // Dispatched synchronously, before the control applies the edit.
      topElementBeforeInput: {registrationName: 'onBeforeInput'},
      // The WRAPPED height of the text, which nothing in JavaScript can work
      // out for itself — it depends on the font, the width and the platform's
      // line breaking. What `field-sizing: content` would consume.
      topElementContentSizeChange: {registrationName: 'onContentSizeChange'},
    },
    // No `recordNodeName`: the host is `element-textarea` and the DOM name is
    // `textarea`, which the component states.
    uiViewClassName: 'element-textarea',
    // Sized from `rows`, at each platform's own line height, defaulting to
    // HTML's two.
    //
    // This has to be computed here rather than left to the native side. `rows`
    // reaches the shadow node, but neither platform's control reads it to size
    // itself — left to them, `rows={2}` and `rows={8}` draw boxes of exactly
    // the same height and the attribute does nothing at all. A browser derives
    // the height the same way: rows times the line height, plus the control's
    // own chrome.
    uaStyle: (props: {[string]: unknown}): UAStyle => {
      const authored = props?.rows;
      const rows =
        typeof authored === 'number' && authored > 0 ? Math.floor(authored) : 2;
      const [chrome, lineHeight] =
        Platform.OS === 'android' ? [40, 28] : [30, 21];
      // See `<input>`: a control is an inline-level box, and the table entry
      // comes first so the initial values are not lost.
      // The field surface widens to the sheet's indexer type FIRST: Flow
      // will not mix an exact-object spread with an indexer spread in one
      // literal, and the annotated intermediate is the sanctioned widening.
      const surface: UAStyle = {...FIELD_SURFACE};
      return {
        ...uaStyleFor('textarea'),
        ...surface,
        display: 'inline-block',
        width: 240,
        height: chrome + rows * lineHeight,
      };
    },
  }),
);

// The host element `<select>` renders. Registered under its own name because
// `select` itself is a *component* (Select.js): it reads its `<option>`
// children and hands them down as a list, which is a JavaScript job.
//
// No `recordNodeName` here — that would record `element-select`, and the DOM
// name is `select`. The component states it instead, which is the only place
// that knows it.
registerFrameworkElement('element-select', () =>
  createViewConfig({
    validAttributes: {
      nodeName: true,
      name: true,
      options: true,
      value: true,
      disabled: true,
    },
    directEventTypes: {
      // Only `change`. Choosing is atomic, so there is no `input` event
      // distinct from it.
      topElementChange: {registrationName: 'onChange'},
    },
    uiViewClassName: 'element-select',
    uaStyle: {
      // Inline-block, for the reason spelled out on `<input>`: a control sits in
      // a line of text, which is how a `<label>` wrapping one is written.
      display: 'inline-block',
      // No width: the shadow node MEASURES it — a `<select>` shrink-to-fits
      // its widest option, which is the web's rule (real Safari: 41/72/239px
      // for one-char/short/long option sets) and each platform's own idiom.
      // The measure floors at the platform touch-target width; an author
      // width overrides it entirely. See ElementSelectShadowNode.
      //
      /*
       * NO `alignSelf` here, and that is deliberate rather than an omission.
       *
       * `alignSelf: 'flex-start'` would stop the control filling the cross axis
       * of a plain column the way RN's `alignItems: stretch` default does. But
       * "an inline-level control never fills its container" is true of a BLOCK
       * container and not of a flex one: a `<select>` in `display: flex;
       * flex-direction: column` stretches in a real browser, so pinning it here
       * is a deviation rather than the web's behaviour.
       *
       * It also costs more than it buys. `align-self` is not axis-specific: in
       * a column it controls the width, but in a ROW it controls the vertical
       * position, so `flex-start` pins every select to the top of its row and
       * beats the row's own `alignItems: center`. Measured in a 44-point
       * settings row: 0.3 points above the control and 8.0 below it.
       *
       * Leaving it out costs the shrink-to-fit in a flex column — a select in
       * one fills the width. That is what a browser does, and an author who
       * wants otherwise writes the `alignSelf: 'flex-start'` they would have
       * written on the web.
       */
      height: Platform.OS === 'android' ? 48 : 36,
      /*
       * On Android the bare Spinner is a word and a small caret floating on
       * the page — nothing says "control". Material 3's dropdown is the
       * exposed-dropdown FIELD: the same filled container the text fields
       * wear, which is exactly what the field surface provides. iOS keeps the
       * platform's own answer, the gray pull-down `UIMenu` button, which
       * already reads as a control and takes no field chrome.
       */
      ...(Platform.OS === 'android' ? FIELD_SURFACE : null),
    },
  }),
);

// `<select>` is a component, not a box: it reads its `<option>` children and
// passes them to the control as a list. The reconciler routes the tag to it.
registerFrameworkComponent('select', Select);

// `<input>` is a component only because of `<form>`: which control it draws is
// still `resolveUIViewClassName`'s decision. See Input.js.
registerFrameworkComponent('input', Input);

/*
 * The host element `<native:scroll>` renders.
 *
 * Registered under its own name because `native:scroll` itself is a *component*
 * (NativeScroll.js): it wraps its children in the one content container a
 * scrolling container has, which is a JavaScript job.
 *
 * The prop surface is small on purpose. Every entry is either something only the
 * author can know (`contentInset`) or a way to switch off something that is on
 * by default — there is no prop here whose job is to turn on correct behaviour.
 */
registerFrameworkElement('native-scroll', () =>
  createViewConfig({
    validAttributes: {
      scrollEnabled: true,
      showsScrollIndicator: true,
      bounces: true,
      contentInset: true,
      automaticInsets: true,
      avoidsKeyboard: true,
      keyboardDismissMode: true,
      contentAnchor: true,
      edgeEffects: true,
      // Not a prop: the two commands the element answers, declared so the view
      // config knows the element has them.
    },
    bubblingEventTypes: {},
    directEventTypes: {
      topScroll: {registrationName: 'onScroll'},
      topScrollBeginDrag: {registrationName: 'onScrollBeginDrag'},
      topScrollEndDrag: {registrationName: 'onScrollEndDrag'},
      topMomentumScrollBegin: {registrationName: 'onMomentumScrollBegin'},
      topMomentumScrollEnd: {registrationName: 'onMomentumScrollEnd'},
      // Fires when nothing has scrolled, which is the common case: a keyboard
      // opening under a short list moves no content but changes the insets.
      topInsetChange: {registrationName: 'onInsetChange'},
    },
    uiViewClassName: 'native-scroll',
    uaStyle: {
      // Fills what is left of its container, which is what a scroll view is for.
      // An author style still wins, so a fixed-height one is a height away.
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      // Its whole purpose: content larger than the box, clipped to the box.
      overflow: 'hidden',
    },
  }),
);

/*
 * The host element `<native:keyboardaccessory>` renders.
 *
 * No attributes of its own. What makes it an accessory is the NAME — it is what
 * makes each platform mount a view that hands its children to the keyboard
 * rather than an ordinary one — and everything else is style and children.
 */
/*
 * The host element `<native:chatbubble>` renders.
 *
 * `tail` and `bubbleRadius` reach the shadow node only because they are listed
 * here — an attribute the view config does not name is dropped before it gets
 * there, silently, and the element renders as if it had been given nothing.
 *
 * No peek attributes: `wantsContextMenu` and the `<menu>` belong to the BOX,
 * which is what receives the touch and what has to come up with the words
 * inside it. What this element contributes is the SHAPE of the lift — its view
 * hands its own outline, tail included, up to the box, which gives it to UIKit.
 * See `ContextMenu.md`.
 */
registerFrameworkElement('native-chatbubble', () =>
  createViewConfig({
    validAttributes: {
      tail: true,
      bubbleRadius: true,
    },
    uiViewClassName: 'native-chatbubble',
  }),
);

registerFrameworkElement('native-keyboardaccessory', () =>
  createViewConfig({
    // `scope`: "screen" (the default) or "app". Declared here or it is dropped
    // before it reaches the shadow node.
    // `appleVisualEffect` and its fade: the bar's whole surface, declared here
    // for the same reason `scope` is — an attribute the view config does not
    // list never reaches the shadow node.
    validAttributes: {
      scope: true,
      // Also takes `-apple-system-glass-container`, which groups the glass
      // surfaces inside it into one shape — see `EXPMaterialSurface`.
      appleVisualEffect: true,
      appleVisualEffectFade: true,
      /*
       * How strongly the material is worn, 0 to 1. It attenuates the blur and
       * the tint together — see the prop's comment in the shadow node for what
       * that trade buys and costs.
       */
      appleVisualEffectOpacity: true,
      /*
       * Whether the bar reserves the home indicator's strip. On by default; off
       * is how an app draws into it, which is what the platform's own composer does —
       * see the prop's own comment in `ExpoKeyboardAccessoryShadowNode.h`.
       */
      automaticInsets: true,
    },
    bubblingEventTypes: {},
    directEventTypes: {
      /*
       * How much of the home indicator's strip the bar is reserving, and the
       * same answer as a fraction. The only signal that says whether the bar is
       * resting on the screen or riding the keys — see the event's own comment
       * in `ExpoKeyboardAccessoryEventEmitter.h` for why nothing else is.
       */
      topDockChange: {registrationName: 'onDockChange'},
    },
    uiViewClassName: 'native-keyboardaccessory',
  }),
);

/*
 * The host element `<native:keyboardpanel>` renders.
 *
 * A panel that takes the KEYBOARD'S place rather than sitting above it — what
 * the platform's own `+` opens. `visible` is the whole surface: raising it is the same
 * act as raising a keyboard, so the system runs the transition, sizes it and
 * dismisses it.
 */
registerFrameworkElement('native-keyboardpanel', () =>
  createViewConfig({
    validAttributes: {
      visible: true,
      // `inputView` (the default) or `overlay`. See the shadow node: which one
      // is right is a question about whether the panel is an alternative INPUT
      // or a list of COMMANDS.
      presentation: true,
      // The rectangle an overlay grows out of, in window coordinates. Four
      // numbers rather than an object because a raw prop of a struct type has
      // to be taught to the parser, and this is measured in JS anyway.
      anchorX: true,
      anchorY: true,
      anchorWidth: true,
      anchorHeight: true,
    },
    bubblingEventTypes: {},
    directEventTypes: {
      // The panel dismissed itself — an overlay is closed by tapping outside
      // it, and `visible` is the app's state to correct.
      topClose: {registrationName: 'onClose'},
    },
    uiViewClassName: 'native-keyboardpanel',
  }),
);

/*
 * The host element `<native:menubutton>` renders.
 *
 * A real `UIButton` whose action is a `UIMenu`. Its commands are one prop rather
 * than children, because a `UIMenu` is built from a list and children would only
 * be that list written the long way — `<button>` has `<menu>` children because
 * HTML says so, and this element has no HTML to obey.
 */
registerFrameworkElement('native-menubutton', () =>
  createViewConfig({
    validAttributes: {
      title: true,
      systemImage: true,
      // The title's point size. A prop rather than `font-size`: the title is
      // the button's CONFIGURATION and never becomes a text node, so the style
      // cascade has nothing to reach.
      titleSize: true,
      prominent: true,
      // `[{id, label, disabled, destructive}]`. Diffed by value, so a list that
      // has not changed does not rebuild the menu — a `UIMenu` is immutable, and
      // rebuilding one while it is open closes it.
      commands: true,
    },
    bubblingEventTypes: {},
    directEventTypes: {
      // The chosen command's `id`. Not its index: a list that reorders while the
      // menu is open would otherwise report the wrong one.
      topCommand: {registrationName: 'onCommand'},
    },
    uiViewClassName: 'native-menubutton',
  }),
);

/*
 * `<native:safearea>`, which keeps its children clear of the system's furniture.
 *
 * Plain JavaScript over `env(safe-area-inset-*)`; there is no element behind it.
 * See the component.
 */
defineReactComponent('native', 'safearea', NativeSafeArea);

/*
 * `<native:scroll>`, the scroll view an app should reach for.
 *
 * Registered as a namespaced element rather than a bare tag because it is not an
 * HTML element and should not pretend to be one: there is no `<scroll>` in the
 * DOM, and the namespace says plainly that this is a platform element rather
 * than a web one.
 */
defineReactComponent('native', 'scroll', NativeScroll);

/*
 * `<native:keyboardaccessory>`, the bar that rides the keyboard. One word rather
 * than two because element names have no separator to spare — the namespace has
 * already used the colon.
 */
defineReactComponent('native', 'keyboardaccessory', NativeKeyboardAccessory);

/*
 * `<native:menubutton>`, a button whose action is a menu the SYSTEM presents.
 * One word for the same reason `keyboardaccessory` is one.
 */
defineReactComponent('native', 'menubutton', NativeMenuButton);

/*
 * `<native:chatbubble>`, a chat balloon. One word for the same reason
 * `keyboardaccessory` is one.
 */
defineReactComponent('native', 'chatbubble', NativeChatBubble);

// `<textarea>` joins a form the same way `<input>` does, and for the same
// reason: an uncontrolled one keeps its value in the native view.
registerFrameworkComponent('textarea', TextArea);

// `<button>` is a component so that HTML's default `type="submit"` works: a
// button inside a form submits it with no handler at all. See Button.js.
registerFrameworkComponent('button', Button);

// `<a>` carries HTML's implicit link role when it has an href, which is what
// makes a link inside a sentence reachable by assistive technology.
registerFrameworkComponent('a', Anchor);

// `<form>` is the element that turns a group of controls into a submission,
// which is not layout — so it is a component over a plain block box.
registerBlockElementUnderName('element-form', 'form');
registerFrameworkComponent('form', Form);

// <img> is a component for its attributes, not its box: `src` becomes a source
// list, `alt` becomes an accessibility state, and `object-fit` becomes whichever
// prop the backing image view takes. See Img.js.
registerFrameworkComponent('img', Img);

// <picture> reads its <source> children and hands the chosen one to the <img>
// inside it — the same read-the-children shape as <select>, and for the same
// reason: a <source> is a decision, not a view. See Picture.js.
registerFrameworkComponent('picture', Picture);

// <q> generates its quotation marks, alternating by nesting depth, because
// there is no CSS `content` to put them in. See Quote.js.
registerInlineElementUnderName('element-q', 'q');
registerFrameworkComponent('q', Quote);

// <h1>-<h6> carry HTML's implicit `heading` role. The box is an ordinary block
// registered under `element-h1`...`element-h6`; the component adds the role,
// which is a prop and so cannot live in the stylesheet. See Heading.js.
for (const level of HEADING_LEVELS) {
  registerBlockElementUnderName(`element-${level}`, level);
  registerFrameworkComponent(level, makeHeading(level));
}

// `<progress>` and `<meter>` share a control, because they differ in meaning
// rather than in anything either platform draws differently. `nodeName` is what
// keeps them apart for the DOM and for assistive technology.
//
// Neither is interactive, which is the whole difference from
// `<input type="range">`: a drag starting on one just scrolls.
function registerProgressElement(name: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      validAttributes: {
        nodeName: true,
        value: true,
        min: true,
        max: true,
        disabled: true,
      },
      recordNodeName: true,
      uiViewClassName: 'element-progress',
      uaStyle: {
        // See `<input>`: a control is an inline-level box.
        display: 'inline-block',
        width: 160,
        // The platforms' own progress bars: a `UIProgressView` is a few points
        // tall, an Android `ProgressBar` reserves more.
        height: Platform.OS === 'android' ? 16 : 12,
      },
    }),
  );
}

registerProgressElement('progress');
registerProgressElement('meter');

// <p> is block-level. Aliasing it to <div> is what makes it lay out as a block
// at all: an unregistered tag falls through to the *inline* unknown element,
// so an unaliased <p> flows inline with its siblings.
//
// Its default block margins come from the UA stylesheet (uaStyles.js), merged
// beneath the author's style so `<p style={{marginBlock: 0}}>` still wins.
/**
 * A block element whose *tag* is a component, so the host needs a name of its
 * own.
 *
 * `<form>` is the case: it lays out exactly like a plain block box, but what it
 * adds — gathering its controls and submitting them — is not
 * layout, so the tag resolves to a component and the box is registered under a
 * separate name. The UA style is still looked up by the DOM name, so the
 * element keeps the metrics the sheet gives it, and `recordNodeName` is off
 * because the component states the DOM name itself.
 */
function registerBlockElementUnderName(hostName: string, domName: string) {
  const uaStyle = uaStyleFor(domName);
  if (uaStyle.display == null) {
    uaStyle.display = 'block';
  }
  registerFrameworkElement(hostName, () =>
    createViewConfig({
      // `listStart` is `<ol start>` under a private native name — the HTML
      // attribute collides with Yoga's inline-start inset; see List.js.
      validAttributes: {
        nodeName: true,
        listStart: true,
        // `-apple-visual-effect`, spelled as CSSOM spells a `-apple-`
        // property. Declared here or it is dropped before it reaches the
        // shadow node — an attribute the view config does not list does not
        // survive, which is the same trap `accessibilityRole` hit on <a>.
        appleVisualEffect: true,
        // How far that material fades in from its top edge, in points. A bar
        // wants one; a field wants the default of none.
        appleVisualEffectFade: true,
        // The long-press gate — see `wantsContextMenu` in ElementBoxShadowNode.h.
        // A box with a `contextmenu` listener sets it to take UIKit's own hold,
        // lift and haptic instead of the element's own timer. Without it in the
        // attribute set the flag never reaches the view and the peek silently
        // never installs.
        wantsContextMenu: true,
        // And what that peek PRESENTS, from a `<menu>` child — the same shape
        // `<button>` takes. Empty is the lift alone, which is what a box that
        // only listens for `contextmenu` still gets.
        menuCommands: true,
      },
      bubblingEventTypes: {
        // `contextmenu`, which on a touch platform IS the long press — the
        // event a browser fires when a finger rests on an element. Bubbling, as
        // it is on the web, so a handler on a container hears a hold on
        // anything inside it.
        //
        // DOM-CSS-LIMITATION(ios-only-contextmenu): fired on iOS only, timed
        // from the touches the box already receives. Android has the same seam
        // — `ElementInteractiveBoxView` already tracks a press through the
        // platform's own dispatch — but only for boxes it makes interactive,
        // which a plain `<div>` deliberately is not.
        topContextMenu: {
          phasedRegistrationNames: {
            captured: 'onContextMenuCapture',
            bubbled: 'onContextMenu',
          },
        },
        // A command chosen from that menu. Bubbling like `contextmenu` itself,
        // so a handler on the transcript hears a choice made on any balloon.
        topCommand: {
          phasedRegistrationNames: {
            captured: 'onCommandCapture',
            bubbled: 'onCommand',
          },
        },
      },
      uiViewClassName: 'element-box',
      uaStyle: (props: {[string]: unknown}) =>
        withoutOutrankedBoxEdges(uaStyle, props?.style),
    }),
  );
}

/**
 * A block-level element: aliases <div>'s native component and takes its box
 * metrics from the UA sheet. Adding one is a row in uaStyles.js plus a name
 * here — no shadow node, descriptor, or native code.
 */
function registerBlockElement(name: string) {
  // Block-ness is a DECLARATION, not a component choice: it goes in the user-agent
  // style, where an author style can still beat it, and the generic box then
  // honours it. That is what lets a block element be defined without a C++ class
  // of its own — the whole definition is a tag name and a UA entry.
  const uaStyle = uaStyleFor(name);
  if (uaStyle.display == null) {
    uaStyle.display = 'block';
  }
  registerFrameworkElement(name, () =>
    createViewConfig({
      // `listStyleType`/`listStylePosition` are style properties and `start` an
      // HTML attribute, but all three are declared here because markers are
      // generated in C++ by the list container, which needs them natively.
      validAttributes: {
        nodeName: true,
        listStyleType: true,
        listStylePosition: true,
        start: true,
        // `-apple-visual-effect`, spelled as CSSOM spells a `-apple-`
        // property. Declared here or it is dropped before it reaches the
        // shadow node — an attribute the view config does not list does not
        // survive, which is the same trap `accessibilityRole` hit on <a>.
        appleVisualEffect: true,
        // How far that material fades in from its top edge, in points. A bar
        // wants one; a field wants the default of none.
        appleVisualEffectFade: true,
        // The long-press gate — see `wantsContextMenu` in ElementBoxShadowNode.h.
        // A box with a `contextmenu` listener sets it to take UIKit's own hold,
        // lift and haptic instead of the element's own timer. Without it in the
        // attribute set the flag never reaches the view and the peek silently
        // never installs.
        wantsContextMenu: true,
        // And what that peek PRESENTS, from a `<menu>` child — the same shape
        // `<button>` takes. Empty is the lift alone, which is what a box that
        // only listens for `contextmenu` still gets.
        menuCommands: true,
      },
      recordNodeName: true,
      bubblingEventTypes: {
        // `contextmenu`, which on a touch platform IS the long press — the
        // event a browser fires when a finger rests on an element. Bubbling, as
        // it is on the web, so a handler on a container hears a hold on
        // anything inside it.
        //
        // DOM-CSS-LIMITATION(ios-only-contextmenu): fired on iOS only, timed
        // from the touches the box already receives. Android has the same seam
        // — `ElementInteractiveBoxView` already tracks a press through the
        // platform's own dispatch — but only for boxes it makes interactive,
        // which a plain `<div>` deliberately is not.
        topContextMenu: {
          phasedRegistrationNames: {
            captured: 'onContextMenuCapture',
            bubbled: 'onContextMenu',
          },
        },
        // A command chosen from that menu. Bubbling like `contextmenu` itself,
        // so a handler on the transcript hears a choice made on any balloon.
        topCommand: {
          phasedRegistrationNames: {
            captured: 'onCommandCapture',
            bubbled: 'onCommand',
          },
        },
      },
      uiViewClassName: 'element-box',
      uaStyle: (props: {[string]: unknown}) =>
        withoutOutrankedBoxEdges(uaStyle, props?.style),
    }),
  );
}

// Block containers, headings, lists. All block-level, differing only in the
// metrics the UA sheet gives them.
// <div> is not special: a block element is a tag whose user-agent style says
// `display: block`, backed by the generic box. react-native ships no `div`
// component, no DivShadowNode and no DivProps — which is exactly what makes a
// block element definable from outside it.
for (const name of [
  'div',
  'p',
  'blockquote',
  'figure',
  'figcaption',
  'pre',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'address',
  'hgroup',
  'search',
  'noscript',
  'legend',
  'li',
  'dl',
  'dt',
  'dd',
]) {
  registerBlockElement(name);
}

// <fieldset> is a component so its <legend> can hoist above the bordered box
// — the platforms' group-label convention; see Fieldset.js for the deviation
// note. The box itself is the ordinary block registered under
// `element-fieldset`.
registerBlockElementUnderName('element-fieldset', 'fieldset');
registerFrameworkComponent('fieldset', Fieldset);

// The list containers are components so a nested list can zero its block
// margins the way every browser's sheet does with `ul ul { margin-block: 0 }`
// — nesting is context, and a per-tag stylesheet row cannot see it. The box
// itself is the ordinary block registered under `element-ul`…; see List.js.
for (const tag of LIST_TAGS) {
  registerBlockElementUnderName(`element-${tag}`, tag);
  registerFrameworkComponent(tag, makeList(tag));
}

// Inline presentational elements, styled entirely by the UA sheet.
for (const name of [
  'cite',
  'small',
  'code',
  'kbd',
  'samp',
  's',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'abbr',
  'time',
  'var',
  'dfn',
  'data',
  'output',
]) {
  registerInlineAlias(name, 'inline-text');
}

/**
 * Displays whose box establishes a formatting context, so the element cannot
 * fold into the surrounding inline flow and needs a real box of its own.
 *
 * `inline` is absent on purpose: it is precisely the display that folds.
 */
const BOX_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'block',
  'inline-block',
  'grid',
  'inline-grid',
]);

/**
 * Picks the native component backing an inline element, from its resolved
 * `display`.
 *
 * Box generation follows computed display, not the tag: a `<span>` is the
 * cheap text-backed component while it folds into an inline formatting
 * context, and the box-backed one when its display establishes one. Browsers
 * make the same choice at the same point — `LayoutObject::CreateObject`
 * constructs a different class per computed display.
 *
 * Cheap by construction: a set lookup on an already-flattened style, and only
 * for elements that can be either flavor.
 */
function resolveInlineElementComponent(
  uiViewClassName: string,
  uaStyle?: UAStyle,
  // Which box component this element becomes when its display generates one.
  // Interactive elements name a different one: `<button>` resolves to
  // `element-button`, whose only difference from the generic box is that it
  // carries a press event emitter and installs a native gesture recognizer.
  boxComponentName: string = 'element-box',
): (props: {[string]: unknown}) => string {
  return (props: {[string]: unknown}): string => {
    // The UA display counts too: `<button>`'s inline-block comes from the
    // stylesheet, and box selection has to see it or the element would resolve
    // as text-backed and its padding would have nowhere to apply.
    const style = props?.style;
    if (style == null) {
      const uaDisplay = uaStyle?.display;
      return typeof uaDisplay === 'string' && BOX_DISPLAYS.has(uaDisplay)
        ? boxComponentName
        : uiViewClassName;
    }
    // Required lazily: importing StyleSheet at module scope pulls this module
    // into a require cycle, which re-evaluates it and re-runs the element
    // registrations ("tried to register two views with the same name").
    // $FlowFixMe[unclear-type] a lazily-required module has no static type
    const styleSheetModule: any = require('react-native/Libraries/StyleSheet/StyleSheet');
    const flatten =
      styleSheetModule.default?.flatten ?? styleSheetModule.flatten;
    const flat = flatten(style);

    /*
     * BLOCKIFICATION (css-display-3 §2.7). `position: absolute`, `fixed` and a
     * `float` other than `none` all compute `display: inline` to `block`, and
     * the box leaves flow entirely (CSS2 §9.7) — it contributes nothing to the
     * line it was written in.
     *
     * Done here because this is where the element's display is computed, and
     * because the alternative is worse: an inline element is backed by a text
     * shadow node whose props carry no position at all, so the layout side
     * cannot see the positioning even to ignore it. Resolving to the box
     * backing hands it to the code that already implements the rule —
     * `isInlineLevelBox` excludes absolutely-positioned boxes from inline flow
     * and cites §9.7 for it.
     *
     * The canonical case is the visually-hidden block: `position: absolute` on
     * a 1x1 clipped `<span>`, which is how a component says "assistive
     * technology only". Left text-backed, its screen-reader text lays out in
     * the line as visible words and squeezes the real label until it wraps
     * mid-word.
     */
    const position = flat?.position;
    if (position === 'absolute' || position === 'fixed') {
      return boxComponentName;
    }
    // The float row of the same table. A floated `<span>` that stays
    // text-backed sits in the run instead: it takes no width, so it intrudes on
    // nothing and the next float packs straight over it.
    const float = flat?.float;
    if (typeof float === 'string' && float !== 'none') {
      return boxComponentName;
    }

    const display = flat?.display ?? uaStyle?.display;
    return typeof display === 'string' && BOX_DISPLAYS.has(display)
      ? boxComponentName
      : uiViewClassName;
  };
}

/**
 * Adjusts the user-agent default for a tag — a CSS reset, in other words.
 *
 * Design systems ship one: they zero the UA margins they do not want and then
 * style from scratch. On the web that is a stylesheet at the *author* origin
 * overriding the UA origin. Here the UA sheet is the only global layer, so a
 * reset edits it in place.
 *
 * Mutates the entry rather than replacing it, because a view config captures
 * the style object by reference when it is first built. Call before rendering.
 *
 * **The blast radius is the whole app, forever — treat this as an app-level
 * decision, never a screen-level one.** The mutation outlives the module that
 * made it: a DEMO calling `overrideUAStyle('p', {marginBlock: 0})` at module
 * scope strips every paragraph's margins on every OTHER screen for the rest of
 * the session, and reads exactly like a renderer bug in whichever screen is
 * looked at next. A scoped reset belongs at the point of use — a style on the
 * elements themselves, or a wrapper the design system's own runtime applies, as
 * Astryx's `ASTRYX_RESET` does. No caller of this function remains in the repo;
 * it stays for the genuine design-system case its first paragraph describes.
 */
export function overrideUAStyle(tag: string, style: UAStyle) {
  const existing = uaStyles[tag];
  if (existing != null) {
    // Mutated in place, not replaced: view configs captured this object by
    // reference when the element was registered.
    for (const key of Object.keys(style)) {
      existing[key] = style[key];
    }
  } else {
    uaStyles[tag] = {...style};
  }
}

// HTMLUnknownElement: any unregistered lowercase JSX tag (e.g. <foo>) resolves
// here — inline, unstyled, content renders — mirroring the web. This is the DOM
// *policy*; the resolution *mechanism* is a generic fallback hook, so
// react-native stays agnostic. The element is backed by the native singleton "unknown"
// inline component; because every unknown tag shares one view config, the
// authored tag is otherwise lost, so `recordNodeName` has the reconciler stamp
// the JSX type onto a `nodeName` prop the native side reports through DOM APIs.
const unknownElementViewConfig: ViewConfig = {
  // Points at the generic inline text backing, like any other inline element.
  uiViewClassName: 'inline-text',
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {nodeName: true},
  recordNodeName: true,
};

setFallbackViewConfigResolver(name =>
  typeof name[0] === 'string' && /^[a-z]/.test(name)
    ? unknownElementViewConfig
    : null,
);

// The provider entry point: a library defines namespaced elements — see
// ElementRegistry for the precedence rules.
export {defineReactElement} from './ElementRegistry';
