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
 * The user-agent stylesheet, a table like WebKit's `html.css` and grouped in
 * its order. Defaults are data, and the author always wins because the table
 * merges beneath the author's style (CSS Cascade §6.1).
 *
 * Divergences from the web:
 *  - DOM-CSS-LIMITATION(no-em-units): values are points computed against the
 *    root size below, so they do not track the user's font size. `em`
 *    resolves against the element's own font-size, so a rule on an element
 *    that resizes itself (every heading) multiplies by that size, not the root's.
 *  - DOM-CSS-DEVIATION(root-font-size-is-native-not-16px): the root is the
 *    platform's body text size rather than the web's 16px. See `ROOT_FONT_SIZE`.
 *  - DOM-CSS-LIMITATION(no-quirks-mode): no `quirks.css` equivalent.
 *  - DOM-CSS-DEVIATION(native-form-widgets): the platform views draw the
 *    controls' surfaces; this sheet carries only what the renderer draws:
 *    label typography and colour, content insets, touch-target minimums.
 *  - DOM-CSS-DEVIATION(no-visited-links): `:visited` is not evaluated. It
 *    would need history state, and the web's purple is what no native app
 *    does; a link keeps the system tint (`LinkText` in `systemColors.js`).
 */

import type {ColorValue} from 'react-native';

import {systemColor} from './systemColors';
import {Platform, PlatformColor} from 'react-native';

/**
 * The surface a text-entry control sits on: `<input>`'s textual types,
 * `<textarea>`, and `<select>` on Android. iOS fields sit on the system
 * background (CSS's `Field`, see systemColors.js) with `UITextField`'s corner
 * radius. Android fields are Material 3 filled text fields: a tonal container
 * with 4dp top corners and 16dp inline padding, over the active indicator the
 * theme draws at the bottom edge.
 */
export const FIELD_SURFACE: {
  backgroundColor?: unknown,
  borderRadius?: number,
  borderTopLeftRadius?: number,
  borderTopRightRadius?: number,
  paddingInline?: number,
} = Platform.select({
  ios: {
    backgroundColor: systemColor('Field'),
    borderRadius: 5,
  },
  android: {
    backgroundColor: PlatformColor(
      '?attr/colorSurfaceContainerHighest',
      '?attr/colorSurfaceVariant',
    ),
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingInline: 16,
  },
  default: {
    backgroundColor: systemColor('Field'),
  },
});

/*
 * React Native resolves `fontFamily` against real faces, and only Android
 * accepts `'monospace'` as an alias.
 *
 * DOM-CSS-LIMITATION(no-generic-font-families): the other generics are not
 * mapped, so `font-family: serif` resolves to nothing.
 */
const MONOSPACE: string = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export type UAStyle = {[string]: unknown};

/**
 * What `1em` means in this sheet: the platform's body text size (iOS 17pt,
 * Material `bodyLarge` 16sp) rather than the web's 16px, so a document reads
 * at the size everything else on the phone does.
 *
 * DOM-CSS-DEVIATION(root-font-size-is-native-not-16px): proportions are
 * preserved, absolute sizes are not, and differ per platform. Must stay in
 * step with `kRootFontSize` in `YogaLayoutableShadowNode.cpp`.
 */
const ROOT_FONT_SIZE: number = Platform.select({
  ios: 17,
  android: 16,
  default: 16,
});
// CSS's `CanvasText`, as each platform's own label colour so it follows the
// appearance without a light/dark pair

const EM = ROOT_FONT_SIZE;

// Typed by name because an unannotated `Platform.select` infers number
// literal types per branch and reports them incompatible, while `UAStyle`'s
// indexer makes the result unspreadable. No padding: ElementButtonShadowNode
// folds the control's own content insets onto the style
type ButtonChrome = {
  fontSize?: number,
  fontWeight?: string,
  letterSpacing?: number,
  minHeight: number,
};

/*
 * The platform views draw `<button>`'s surface (a `UIButtonConfiguration` on
 * iOS, Material's inset pill and ripple on Android); the sheet carries what
 * the renderer draws: label typography and the minimum touch target.
 * Measured: a gray `UIButtonConfiguration` draws its label in the label
 * colour on iOS 26 although `titleColorForState:` answers `systemBlue`;
 * `Widget.Material3.Button` resolves label-large (14sp, weight 500, 0.1
 * letter spacing). `minHeight` is the touch target (HIG 44, Material 48),
 * since the box is the touch target. `textAllCaps` is not adopted: it changes
 * the text, and Chrome on Android does not uppercase `<button>` either.
 */
/**
 * `<input type="checkbox">`'s box is the backing control's intrinsic size: a
 * UISwitch (63x28 on iOS 26, which ignores assigned sizes) and a CheckBox's
 * 48dp touch target. `EXPElementCheckboxGeometryTests` and
 * `checkableMetrics-test.js` pin these literals to the controls.
 *
 * The inline-end margin is the platform's label spacing. The space in
 * `<label><input/> Subscribe</label>` leaves an iOS label almost flush
 * against the switch, where system apps sit it about 8pt off; on Android the
 * touch box already carries 12dp of inset past the drawable, so the negative
 * margin gives the space back. DOM-CSS-DEVIATION(checkable-label-gap): a
 * browser adds no spacing here.
 *
 * DOM-CSS-DEVIATION(checkable-line-centering): `vertical-align: middle`
 * rather than `baseline`. Baseline-aligning a 48dp touch target or a 28pt
 * switch drops or lifts the visible control against the words it labels;
 * Material rows and iOS Settings rows centre the control on the label line.
 */
export const CHECKABLE_FOOTPRINT_BY_PLATFORM: {
  ios: {
    width: number,
    height: number,
    marginInlineEnd: number,
    verticalAlign: 'middle',
  },
  android: {
    width: number,
    height: number,
    marginInlineEnd: number,
    verticalAlign: 'middle',
  },
} = {
  ios: {width: 63, height: 28, marginInlineEnd: 8, verticalAlign: 'middle'},
  android: {
    width: 48,
    height: 48,
    marginInlineEnd: -4,
    verticalAlign: 'middle',
  },
};

/**
 * `<input type="radio">`'s box is the touch target (HIG 44pt, Material 48dp),
 * with the circle centred in it at its design diameter
 * (`kEXPRadioIndicatorDiameter` in `EXPElementRadioComponentView`). Not
 * hitSlop: iOS clips it to the ancestor's bounds, and a form row is only as
 * tall as its text. The inline-end margins state the label's distance from
 * the circle rather than from the box: iOS insets the ink by 11pt, so -3
 * leaves the 8pt a system form puts between a control and its label.
 */
export const RADIO_FOOTPRINT_BY_PLATFORM: {
  ios: {
    width: number,
    height: number,
    marginInlineEnd: number,
    verticalAlign: 'middle',
  },
  android: {
    width: number,
    height: number,
    marginInlineEnd: number,
    verticalAlign: 'middle',
  },
} = {
  ios: {width: 44, height: 44, marginInlineEnd: -3, verticalAlign: 'middle'},
  android: {
    width: 48,
    height: 48,
    marginInlineEnd: -4,
    verticalAlign: 'middle',
  },
};

export const BUTTON_CHROME_BY_PLATFORM: {
  ios: ButtonChrome,
  android: ButtonChrome,
  default: ButtonChrome,
} = {
  ios: {
    minHeight: 44,
  },
  android: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.1,
    minHeight: 48,
  },
  default: {
    minHeight: 44,
  },
};

// Exported above so `buttonMetrics-test.js` can assert both branches; each
// runner sees only one of them
const BUTTON_CHROME: ButtonChrome = Platform.select<ButtonChrome>({
  // Spelled out rather than spread: `PlatformSelectSpec`'s properties are
  // optional and invariantly typed, and the table's are required
  ios: BUTTON_CHROME_BY_PLATFORM.ios,
  android: BUTTON_CHROME_BY_PLATFORM.android,
  default: BUTTON_CHROME_BY_PLATFORM.default,
});

// CSS Color 4's names for the two roles; `systemColors.js` resolves them to
// the OS tokens. The renderer draws the label, so its colour comes through
// the sheet; the platform views draw the surfaces
export function buttonLabelColor(prominent: boolean): ColorValue | void {
  return systemColor(prominent ? 'AccentColorText' : 'ButtonText');
}

/**
 * `<button>`'s sheet entry, built imperatively because Flow's spread analysis
 * cannot afford three conditional spreads in one literal (exponential-spread).
 * The label side of the table only — `prominentColor` is not a style property;
 * `buttonUAStyle` swaps it in for the prominent variant.
 */
function buttonSheetEntry(): UAStyle {
  const entry: {[string]: unknown} = {
    display: 'inline-block',
    textAlign: 'center',
    alignContent: 'center',
    color: buttonLabelColor(false),
    // No padding: ElementButtonShadowNode writes the control's content insets
    // onto the node, since a button laid out around its children cannot carry
    // a measure function. `minHeight` is the published touch-target minimum,
    // which no control reports
    minHeight: BUTTON_CHROME.minHeight,
    // Yoga has no `min-width: auto`, so not shrinking is what keeps a tight
    // row from wrapping the label; an author flexShrink still wins
    flexShrink: 0,
  };
  if (BUTTON_CHROME.fontSize != null) {
    entry.fontSize = BUTTON_CHROME.fontSize;
  }
  if (BUTTON_CHROME.fontWeight != null) {
    entry.fontWeight = BUTTON_CHROME.fontWeight;
  }
  if (BUTTON_CHROME.letterSpacing != null) {
    entry.letterSpacing = BUTTON_CHROME.letterSpacing;
  }
  return entry;
}

const uaStyles: {[string]: UAStyle} = {
  // Block-level containers; `display` comes from the registration, so only
  // the box metrics belong here.
  //
  // DOM-CSS-LIMITATION(paragraph-margin-shorthand-dropped): on device a
  // `<p>` with `marginBlock: EM` gets no vertical margin, specific to this
  // tag and below JavaScript; Fantom measures the correct gap. Writing the
  // longhands instead restores the gap and inverts the cascade, because
  // `applyAliasedProps` fills `Edge::Top`/`Bottom` only when undefined, so a
  // UA longhand beats an author `marginBlock: 0`. The shorthand stays
  p: {marginBlock: EM},
  blockquote: {marginBlock: EM, marginInline: 40},
  figure: {marginBlock: EM, marginInline: 40},
  // `white-space: pre` is the whole point of <pre>: browsers set it in
  // html.css, and it is what preserves the newlines and space runs an author
  // wrote — in the rendering and on the clipboard alike.
  pre: {
    marginBlock: EM,
    fontFamily: MONOSPACE,
    fontSizeEm: 0.8125,
    whiteSpace: 'pre',
  },
  // DOM-CSS-DEVIATION(hr-separator-color): the platforms' separator tokens
  // (iOS `separator`, Material `colorOutlineVariant`) rather than html.css's
  // `border: 1px inset`; lighter than the web's line and adaptive
  hr: {
    marginBlock: 8,
    borderTopWidth: 1,
    borderColor: Platform.select<ColorValue>({
      ios: PlatformColor('separator'),
      android: PlatformColor(
        '?attr/colorOutlineVariant',
        '?attr/colorSurfaceVariant',
      ),
      default: '#0000001f',
    }),
  },

  // Headings, as html.css gives them. The margins are `spec figure × own
  // font-size` because `em` in a margin resolves against the element's own
  // font-size, not the root's
  h1: {fontSize: 2 * EM, fontWeight: 'bold', marginBlock: 0.67 * (2 * EM)},
  h2: {fontSize: 1.5 * EM, fontWeight: 'bold', marginBlock: 0.83 * (1.5 * EM)},
  h3: {fontSize: 1.17 * EM, fontWeight: 'bold', marginBlock: 1.0 * (1.17 * EM)},
  h4: {fontSize: EM, fontWeight: 'bold', marginBlock: 1.33 * EM},
  h5: {
    fontSize: 0.83 * EM,
    fontWeight: 'bold',
    marginBlock: 1.67 * (0.83 * EM),
  },
  h6: {
    fontSize: 0.67 * EM,
    fontWeight: 'bold',
    marginBlock: 2.33 * (0.67 * EM),
  },

  // The 40pt inline-start padding is the gutter an `outside` marker hangs in
  // (css-lists-3 §3). <form>'s 1em block-end margin is a quirks-mode rule,
  // DOM-CSS-LIMITATION(no-quirks-mode)
  form: {},
  /*
   * <fieldset> is the platform's group surface: an inset-grouped section on
   * iOS, an outlined card on Material. DOM-CSS-LIMITATION(no-groove-border):
   * the web's `border: groove 2px ThreeDFace` has no analogue.
   * DOM-CSS-DEVIATION(fieldset-native-surface): the platform's metrics rather
   * than html.css's, which are tuned around 13px controls.
   */
  fieldset: {
    marginInline: 2,
    // The grouped page colour, so a radio list's card
    // (`secondarySystemGroupedBackground`) contrasts against it as in Settings
    backgroundColor: Platform.select<ColorValue>({
      ios: PlatformColor('systemGroupedBackground'),
      android: PlatformColor(
        '?attr/colorSurfaceContainerLow',
        '?attr/colorSurfaceVariant',
      ),
      default: '#f2f2f7',
    }),
    borderWidth: 1,
    borderColor: Platform.select<ColorValue>({
      ios: PlatformColor('separator'),
      android: PlatformColor(
        '?attr/colorOutlineVariant',
        '?attr/colorSurfaceVariant',
      ),
      default: '#0000001f',
    }),
    borderRadius: Platform.select<number>({ios: 10, android: 12, default: 8}),
    paddingBlock: Platform.select<number>({ios: 12, android: 16, default: 12}),
    paddingInline: 16,
  },
  // Fieldset.js hoists the legend above the box,
  // DOM-CSS-DEVIATION(fieldset-legend-position); the block-end margin is the
  // platforms' label-to-surface gap
  legend: {paddingInline: 2, marginBlockEnd: 6},

  // <address> is block-level AND italic; both come from html.css.
  address: {fontStyle: 'italic'},
  // <menu> is a list: the HTML Standard groups it with dir/ol/ul for margins
  // and with dir/ul for the disc marker.
  menu: {marginBlock: EM, paddingInlineStart: 40, listStyleType: 'disc'},
  // Scripting is always enabled, so `@media (scripting) { noscript { display:
  // none } }` is unconditional
  noscript: {display: 'none'},
  ul: {marginBlock: EM, paddingInlineStart: 40},
  ol: {marginBlock: EM, paddingInlineStart: 40},
  dl: {marginBlock: EM},
  dd: {marginInlineStart: 40},

  // Form controls are `display: inline-block`, a box that takes padding while
  // sitting in a line of text. Browsers centre a button's content on both
  // axes: `text-align` for the inline axis, `align-content` for the block
  // (css-align-3 §5.3). Not `justify-content`, so a button an author made a
  // flex container keeps its own alignment.
  //
  // `<button>` states `color`: in Chrome `<div style="color:red"><button>`
  // computes black, since a form control states its own text colour
  button: buttonSheetEntry(),

  // <img> is an inline replaced element. Stated here rather than through the
  // shadow node's `InlineReplaced` trait because only some backings declare
  // the trait; expo-image's does not
  img: {display: 'inline-block'},

  // Inline presentational
  b: {fontWeight: 'bold'},
  i: {fontStyle: 'italic'},
  u: {textDecorationLine: 'underline'},
  strong: {fontWeight: 'bold'},
  em: {fontStyle: 'italic'},
  cite: {fontStyle: 'italic'},
  dfn: {fontStyle: 'italic'},
  var: {fontStyle: 'italic'},
  // Safari's computed `text-decoration: underline dotted`, drawn by the text
  // stack so it follows the text through wrapping. Browsers scope it to
  // `abbr[title]`; there is no attribute selector here, so it is unconditional
  abbr: {textDecorationLine: 'underline', textDecorationStyle: 'dotted'},
  small: {fontSizeEm: 0.8333},
  // Every browser renders monospace at 13px on a 16px root, since a monospace
  // face reads larger than proportional text at the same nominal size
  code: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  kbd: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  samp: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  s: {textDecorationLine: 'line-through'},
  del: {textDecorationLine: 'line-through'},
  ins: {textDecorationLine: 'underline'},
  mark: {backgroundColor: '#ffff00', color: '#000000'},
  // Chrome computes `font-size: 13.3333px` on a 16px root, the same `smaller`
  // ratio `<small>` uses
  sup: {fontSizeEm: 0.8333, verticalAlign: 'super'},
  sub: {fontSizeEm: 0.8333, verticalAlign: 'sub'},
};

// CSS initial values that differ from React Native's defaults, applied to
// registered elements only; a `<View>` keeps RN's own
const INITIAL_VALUES: {[string]: unknown} = {
  // No `color`: a declaration on every element would outrank the inherited
  // value, so `<div style={{color: 'red'}}>` would draw its `<b>` in the canvas
  // colour. The renderer's initial colour is CanvasText instead.
  // `flex-direction`'s initial value is `row` (css-flexbox-1 §5.1); a block
  // container ignores it
  flexDirection: 'row',
  // `flex-shrink`'s initial value is 1 (css-flexbox-1 §7.3), so a flex item
  // yields and wraps where React Native's 0 would clip it at the row's edge
  flexShrink: 1,
};

// Returns the same object each time and seeds it in place: view configs
// capture it by reference and `overrideUAStyle` mutates it
export function uaStyleFor(tag: string): UAStyle {
  let style: UAStyle = uaStyles[tag];
  if (style == null) {
    const created: UAStyle = {};
    uaStyles[tag] = created;
    style = created;
  }
  for (const key of Object.keys(INITIAL_VALUES)) {
    if (!(key in style)) {
      style[key] = INITIAL_VALUES[key];
    }
  }
  return style;
}

export default uaStyles;
