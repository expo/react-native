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
import Button from './Button';
import {
  registerFrameworkComponent,
  registerFrameworkElement,
} from './ElementRegistry';
import Form from './Form';
import {LEVELS as HEADING_LEVELS, makeHeading} from './Heading';
import Img from './Img';
import Input from './Input';
import Label from './Label';
import {LIST_TAGS, makeList} from './List';
import Picture from './Picture';
import Quote from './Quote';
import Select from './Select';
import {systemColor} from './systemColors';
import TextArea from './TextArea';
import uaStyles, {
  CHECKABLE_FOOTPRINT_BY_PLATFORM,
  FIELD_SURFACE,
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
      uaStyle: uaStyleFor(name),
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
      // takes a `ReadableArray` outright, so a bare object reached it as the
      // wrong shape and drew nothing — which is half of why `<img>` used to be
      // mapped to a plain View there.
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
      uaStyle: uaStyleFor(domName),
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
      uaStyle: uaStyleFor(name),
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
  // Chrome and Safari's `-webkit-link`.
  color: '#0000EE',
  textDecorationLine: 'underline',
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
 * `PlatformColor` on Android was returning an invisible colour until the fix in
 * `ColorPropConverter.resolveThemeAttribute` — it trusted `TypedValue.data` to
 * hold a colour, which is only true when the attribute is a literal one, and
 * the platform's text colours are ColorStateLists. See
 * `ColorPropConverterTest`.
 */
// `GrayText` is CSS's own name for disabled text, resolved per platform in
// `systemColors.js` — the same adaptive tokens the ternary used to pick here.
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
    },
    directEventTypes: {
      topElementPressChange: {registrationName: 'onPressChange'},
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
 * That is the same inversion that made `<p>`'s longhand margin workaround
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

// <label> names the control it is for — see Label.js. The box is the same
// inline run it always was; what the component adds is the association, which
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
       * ended up the one piece of text that did not theme.
       */
      ...uaStyleFor('input'),
      /*
       * `<input type=submit|reset|button>` IS a button, and looks like one.
       *
       * It already resolved to `element-button` — the same native view
       * `<button>` mounts, with the same press tracking — but appearance is
       * keyed off the TAG, and `<input>`'s entry is the text field's. So these
       * three had a button's every behaviour and none of its chrome, and drew
       * as bare text: `<input type="submit">` was indistinguishable from the
       * word "Submit" sitting in the paragraph. HTML and every browser give
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
       * text falls beneath its checkbox — the same failure `<img>` had, and the
       * same fix, because the box type belongs in the user-agent sheet.
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
      // Square, unlike the checkbox: a radio is a circle on both
      // platforms, and iOS draws its own into whatever box it is given.
      // Label spacing and line-centering as for the checkbox above, same
      // reasoning per platform — see the footprint table's deviations.
      return Platform.OS === 'android'
        ? {width: 48, height: 48, marginInlineEnd: -4, verticalAlign: 'middle'}
        : {width: 22, height: 22, marginInlineEnd: 8, verticalAlign: 'middle'};
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
        return Platform.OS === 'android'
          ? {width: 200, height: 48, ...FIELD_SURFACE}
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
      rows: true,
      name: true,
      mostRecentEventCount: true,
    },
    directEventTypes: {
      topElementInput: {registrationName: 'onInput'},
      topElementChange: {registrationName: 'onChange'},
      topElementFocus: {registrationName: 'onFocus'},
      topElementBlur: {registrationName: 'onBlur'},
      topElementSelectionChange: {registrationName: 'onSelect'},
      // Dispatched synchronously, before the control applies the edit.
      topElementBeforeInput: {registrationName: 'onBeforeInput'},
    },
    // No `recordNodeName`: the host is `element-textarea` and the DOM name is
    // `textarea`, which the component states.
    uiViewClassName: 'element-textarea',
    // Sized from `rows`, at each platform's own line height, defaulting to
    // HTML's two.
    //
    // This has to be computed here rather than left to the native side. `rows`
    // reaches the shadow node, but neither platform's control reads it to size
    // itself — so before this, `rows={2}` and `rows={8}` drew boxes of exactly
    // the same height and the attribute did nothing at all. A browser derives
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
      width: 200,
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
// so <p> previously flowed inline with its siblings.
//
// Its default block margins come from the UA stylesheet (uaStyles.js), merged
// beneath the author's style so `<p style={{marginBlock: 0}}>` still wins.
/**
 * A block element whose *tag* is a component, so the host needs a name of its
 * own.
 *
 * `<form>` is the case: it lays out exactly like the block box it always was,
 * but what it adds — gathering its controls and submitting them — is not
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
      validAttributes: {nodeName: true},
      uiViewClassName: 'element-box',
      uaStyle,
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
      },
      recordNodeName: true,
      uiViewClassName: 'element-box',
      uaStyle,
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
  'fieldset',
  'legend',
  'li',
  'dl',
  'dt',
  'dd',
]) {
  registerBlockElement(name);
}

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
    const display = flatten(style)?.display ?? uaStyle?.display;
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
 * scope stripped every paragraph's margins on every OTHER screen for the rest
 * of the session, and read exactly like a renderer bug in whichever screen was
 * looked at next (it burned an afternoon before being traced here). A scoped
 * reset belongs at the point of use — a style on the elements themselves, or a
 * wrapper the design system's own runtime applies, as Astryx's `ASTRYX_RESET`
 * now does. No caller of this function remains in the repo; it stays for the
 * genuine design-system case its first paragraph describes.
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
