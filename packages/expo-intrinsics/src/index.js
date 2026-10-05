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
 * The HTML element catalog, a side-effect import. Lowercase JSX types resolve
 * by name through ReactNativeViewConfigRegistry, so registering a view config
 * under a tag is what makes a literal <span>, <p> or <h1> render.
 *
 * An element is a tag name (the registration key and what `nodeName` reports),
 * a user-agent style (merged beneath the author's so an author declaration
 * wins) and a backing component, one of the two react-native offers:
 * `inline-text` for an element that folds into a line of text and
 * `element-box` for one that generates a box, chosen from the computed
 * `display` rather than from the tag.
 */

import type {UAStyle} from './uaStyles';

import Anchor from './Anchor';
import {withoutOutrankedBoxEdges} from './boxEdges';
import Button from './Button';
import {
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

/*
 * The field surface widened to the sheet's indexer type FIRST: Flow will not
 * mix an exact-object spread with an indexer spread in one literal, and the
 * annotated intermediate is the sanctioned widening.
 */
const TEXTAREA_SURFACE: UAStyle = {...FIELD_SURFACE};

// Declared on both platforms: the inline element's semantics are decided once
// in the shared `InlineAccessibilityContent`, and a prop the view config does
// not list never reaches it, while each platform's base config lists only its
// own half
const inlineTagViewConfig = {
  validAttributes: {
    isHighlighted: true,
    isPressable: true,
    maxFontSizeMultiplier: true,
    accessibilityElementsHidden: true,
    accessibilityLanguage: true,
    accessibilityLiveRegion: true,
    importantForAccessibility: true,
  },
} as const;

// The sheet sees the author's style to get out of its way: the layers merge by
// key, and a more specific edge spelling in the sheet would beat the author's
// shorthand in Yoga. See `boxEdges.js`
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

// <img> is an inline replaced element: an inline attachment positioned by the
// owning View's attachment-layout pass. expo-image backs it when the Expo
// runtime is present, the framework's Image machinery otherwise; the choice is
// made lazily at first render, when the native runtime is up. The tag is a
// component (Img.js) that translates `src`, `srcset`, `alt` and `object-fit`,
// so the box is registered under its own host name
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
      // `<img src>` is one source; both platforms' image views take a list of
      // candidates, and Android's `RCTImageView.setSource` draws nothing for a
      // bare object
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

// The inline box for an element whose tag is a component. No `recordNodeName`:
// the JSX type here is the host name (`element-q`), so the component states
// the DOM name and the UA style is looked up under it
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
 * An element rendered by an already-registered intrinsic's native component.
 * A view config is per-component, not per-tag, so `recordNodeName` has the
 * reconciler stamp the JSX type onto `nodeName`; without it an aliased
 * <strong> would identify as <b>.
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

// Bold and italic come from the UA sheet, so these alias the unstyled <span>
// `BaseTextShadowNode` emits the break as a newline that survives white-space
// collapsing (css-text-3 §3)
registerInlineAlias('br', 'inline-text');
registerInlineAlias('strong', 'inline-text');
registerInlineAlias('em', 'inline-text');
// Click events already dispatch to inline elements, so <a> needs no gesture
// handler. Its user-agent style is a function of its props because `a:link`
// matches only an anchor with an href; `:visited` is not attempted (see the
// limitations note)
const anchorLinkUAStyle: UAStyle = {
  ...uaStyleFor('a'),
  /*
   * The platform's link colour rather than the browser's fixed `#0000EE`:
   * `LinkText` resolves to `UIColor.linkColor` and `?android:attr/textColorLink`,
   * which follow dark mode and contrast settings. Android's `colorPrimary` is
   * the brand accent, follows the wallpaper under Material You and would
   * collide with a nearby filled button, so the link attribute is the one asked.
   */
  color: systemColor('LinkText'),
  /*
   * Underlined where the platform underlines: `UITextView`'s default
   * `linkTextAttributes` carry no underline (pinned in
   * `EXPLinkTextAttributesTests`), while Android's `URLSpan` underlines and
   * Material asks for it in body text.
   *
   * DOM-CSS-DEVIATION(ios-links-are-not-underlined): `html.css` underlines
   * every `a:link` and iOS does not. Colour alone then distinguishes the link
   * (WCAG 1.4.1); an author can state `textDecorationLine` and win.
   */
  textDecorationLine: Platform.OS === 'ios' ? 'none' : 'underline',
};
// The tag is a component (Anchor.js): an anchor with an href carries the link
// role, which is a prop rather than a style
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

// <button>'s box is `element-button`: a box that carries a press event emitter
// and, with `enableNativeGestureRecognizers` on, a platform gesture recognizer.
// The recognizer reports press state only; the pointer handler already
// dispatches `click` and suppresses it when an enclosing scroll view scrolled,
// so a second dispatch would fire every handler twice
// The box `<button>` renders. Registered under its own name because the tag is
// a component — see Button.js for why HTML's default `type="submit"` makes that
// necessary.
// A disabled control's text colour: CSS's `GrayText`, resolved to each
// platform's inert label colour in `systemColors.js`. A colour rather than an
// `opacity` on the box, since opacity would double-dim the controls that grey
// themselves from `isEnabled` and fade an author's background with the label
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

// Shared with `<input type=submit|reset|button>`, which HTML gives the same
// appearance
function buttonUAStyle(props: {[string]: unknown}): {[string]: unknown} {
  let style: {[string]: unknown} = uaStyleFor('button');
  /*
   * The platter, its insets, the minimum touch height and the label typography
   * are one design, so when the author claims the surface (`hasAuthorChrome`,
   * computed in Button.js/Input.js and read by the platform views to hide the
   * platter) the metrics that fit the platter withdraw with it.
   *
   * DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit): on the web an
   * author background keeps the UA padding and ButtonText colour. Here the
   * insets are platform chrome metrics, and keeping them under an author's
   * surface would look like neither platform nor web.
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
 * The user-agent padding withdraws when the author states any padding: styles
 * flatten by key and Yoga resolves by edge specificity, so a user-agent
 * `paddingInline: 8` would beat an author's `padding: 0` and invert the
 * cascade.
 *
 * DOM-CSS-LIMITATION(no-cascade-origins): every element masks the sheet's
 * padding, margin and border width, colour, style and radius where the author
 * states them (`withoutOutrankedBoxEdges`). Other properties with shorthands,
 * like `border`, `flex` or `gap`, still let a more specific spelling in the
 * sheet outrank the author's shorthand.
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
 * The user-agent `minHeight` is the platform's touch target and `min-height`
 * beats `height`, so it withdraws when the author states a height: a radio's
 * 16pt indicator and a switch's 24pt track are built from `<button>` and a
 * 44pt floor would make each a 44pt box.
 */
const HEIGHT_KEYS = ['height', 'minHeight', 'maxHeight'];

// What fits the platform platter; `display`, `textAlign`, `alignContent` and
// `flexShrink` describe the box itself and stay
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

// <label> names the control it is for — see Label.js. The box is the same
// inline run it always was; what the component adds is the association, which
// is the difference between a control that announces "switch, off" and one that
// announces what it switches.
registerInlineElementUnderName('element-label', 'label');
registerFrameworkComponent('label', Label);

// <input>'s backing is chosen per instance from `type` through
// `resolveUIViewClassName`; a type without a backing falls through to the
// inline unknown element like an unregistered tag
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

// Derived from the backing map so the two cannot drift
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
      // The table entry first, so the initial values every element gets,
      // `color` among them, are kept
      ...uaStyleFor('input'),
      // `<input type=submit|reset|button>` takes `<button>`'s appearance, as
      // HTML gives it; the tag's own entry is the text field's
      ...(BUTTON_INPUT_TYPES.has(
        typeof props?.type === 'string' ? props.type : 'text',
      )
        ? buttonUAStyle(props)
        : null),
      // Size hints next, so the box type below cannot be displaced by them.
      ...inputSizeUAStyle(props),
      // A control sits in a line of text, which is how
      // `<label><input> Subscribe</label>` is written
      display: 'inline-block',
    }),
  }),
);

// Each platform's own footprint for the widget behind an input type
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
      // The button shrink-to-fits a label that changes with the picked file;
      // ElementFileInputShadowNode reports its intrinsic size
      return {};
    case 'color':
      // The platform's colour well is its own size
      return {};
    case 'datetime-local':
    case 'date':
    case 'time':
      // A compact `UIDatePicker` is as wide as the value it shows, so the
      // picker reports its own size
      return {};
    case 'radio':
      // The box is the touch target; the circle is drawn at its design size
      // inside it, see RADIO_FOOTPRINT_BY_PLATFORM
      return {
        ...RADIO_FOOTPRINT_BY_PLATFORM[
          Platform.OS === 'android' ? 'android' : 'ios'
        ],
      };
    default:
      const inputType = typeof props?.type === 'string' ? props.type : 'text';
      if (TEXTUAL_INPUT_TYPES.has(inputType)) {
        // The control reports its own size, so a column flex container can
        // stretch it as a browser does; the field surface belongs to text
        // entry only, not to checkables, buttons or pickers
        return {...FIELD_SURFACE};
      }
      // No intrinsic size for this type; the element keeps whatever the
      // backing control gives it.
      return {};
  }
}

// A separate element from `<input>` because iOS draws the two with unrelated
// classes. No `onSubmit`: Return inserts a newline in a textarea
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
    // No height: `rows` is a count of lines and only the control knows a
    // line's height, so `ElementTextAreaShadowNode::measureContent` asks it
    uaStyle: {
      ...uaStyleFor('textarea'),
      ...TEXTAREA_SURFACE,
      // See `<input>`: a control is an inline-level box.
      display: 'inline-block',
      width: 240,
    },
  }),
);

// `select` is a component (Select.js) that reads its `<option>` children, so
// the host element is registered under its own name and the component states
// the DOM name
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
      // No width or height: ElementSelectShadowNode shrink-to-fits the widest
      // option, floored at the touch-target width, and reports the control's
      // own height. An inline-level control never fills its container on the
      // web, so the flex default of stretching is turned off; an author
      // `alignSelf` or `width` still wins
      alignSelf: 'flex-start',
      // Material 3's dropdown is the exposed-dropdown field, the same filled
      // container the text fields wear; iOS's pull-down button takes no chrome
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

// `<progress>` and `<meter>` share a control and differ by `nodeName`. Neither
// is interactive, so a drag starting on one scrolls
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

// A block element whose tag is a component, so the host needs its own name.
// The UA style is still looked up by the DOM name, which the component states
function registerBlockElementUnderName(hostName: string, domName: string) {
  const uaStyle = uaStyleFor(domName);
  if (uaStyle.display == null) {
    uaStyle.display = 'block';
  }
  registerFrameworkElement(hostName, () =>
    createViewConfig({
      // `listStart` is `<ol start>` under a private native name — the HTML
      // attribute collides with Yoga's inline-start inset; see List.js.
      validAttributes: {nodeName: true, listStart: true},
      uiViewClassName: 'element-box',
      uaStyle: (props: {[string]: unknown}) =>
        withoutOutrankedBoxEdges(uaStyle, props?.style),
    }),
  );
}

// A block element is a tag name plus a UA entry: `display: block` is a
// declaration an author style can still beat, and the generic box honours it
function registerBlockElement(name: string) {
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
      uaStyle: (props: {[string]: unknown}) =>
        withoutOutrankedBoxEdges(uaStyle, props?.style),
    }),
  );
}

// Block containers, headings and lists, differing only in the metrics the UA
// sheet gives them
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

// <fieldset> is a component so its <legend> can hoist above the bordered box,
// the platforms' group-label convention; see Fieldset.js
registerBlockElementUnderName('element-fieldset', 'fieldset');
registerFrameworkComponent('fieldset', Fieldset);

// The list containers are components so a nested list can zero its block
// margins as `ul ul { margin-block: 0 }` does; a per-tag row cannot see nesting
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

// Displays whose box establishes a formatting context; `inline` folds into the
// surrounding flow and is absent
const BOX_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'block',
  'inline-block',
  'grid',
  'inline-grid',
]);

/**
 * Box generation follows computed display, not the tag: a `<span>` is the
 * text-backed component while it folds into an inline formatting context and
 * the box-backed one when its display establishes one, as Blink's
 * `LayoutObject::CreateObject` picks a class per computed display.
 */
function resolveInlineElementComponent(
  uiViewClassName: string,
  uaStyle?: UAStyle,
  // Interactive elements name their own box: `<button>` resolves to
  // `element-button`, which adds a press event emitter and gesture recognizer
  boxComponentName: string = 'element-box',
): (props: {[string]: unknown}) => string {
  return (props: {[string]: unknown}): string => {
    // The UA display counts too: `<button>`'s inline-block comes from the sheet
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
 * Adjusts a tag's user-agent default, the way a design system's CSS reset does.
 * The mutation is app-wide and outlives the module that made it, so it is an
 * app-level decision; a screen-level reset belongs on the elements themselves.
 * Call before rendering: a view config captures the style object by reference.
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

// HTMLUnknownElement: an unregistered lowercase tag renders inline and
// unstyled, as on the web. Every unknown tag shares this view config, so
// `recordNodeName` keeps the authored tag for the DOM APIs
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
