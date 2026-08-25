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
 * The user-agent stylesheet.
 *
 * Browsers all ship one of these — WebKit's `html.css`, Blink's copy, Gecko's
 * `html.css` + `forms.css` — a plain stylesheet applied at the lowest cascade
 * origin. Two properties of that design are worth copying and are why this is
 * a table rather than code:
 *
 *  1. **Defaults are data.** Adding `<article>` is a row here, not a props
 *     class in C++.
 *  2. **The author always wins**, because a UA declaration is simply a lower
 *     origin (CSS Cascade §6.1). Here that is realised by merging these
 *     *beneath* the author's style, so no per-property special-casing exists.
 *
 * Grouped by role in WebKit's order, because that grouping is the
 * documentation.
 *
 * Divergences from the web, stated rather than discovered:
 *  - DOM-CSS-LIMITATION(no-em-units): browsers express these in `em`; we have
 *    no font-relative units, so values are points, computed once against the
 *    root size below. They do not track the user's font size the way the web
 *    does.
 *
 *    Computing them here does not mean computing them all against the root.
 *    `em` resolves against the element's OWN font-size, so a rule on an element
 *    that resizes itself — every heading — has to be multiplied by that size and
 *    not by the root's. See the headings below, where getting this wrong put h1
 *    at half its margin and h6 at half again too much, in the same table.
 *  - DOM-CSS-DEVIATION(root-font-size-is-native-not-16px): the root is the
 *    platform's body text size rather than the web's 16px. See `ROOT_FONT_SIZE`.
 *  - DOM-CSS-LIMITATION(no-quirks-mode): no `quirks.css` equivalent, since
 *    there is no quirks mode to be compatible with.
 *  - DOM-CSS-DEVIATION(native-form-widgets): form controls are platform-drawn
 *    on purpose — `<button>`'s surface is a real `UIButton` configuration on
 *    iOS and the Material construction on Android, drawn by the platform views
 *    rather than described here. This sheet carries only what the renderer
 *    itself draws: label typography and colour, content insets, touch-target
 *    minimums.
 *  - DOM-CSS-LIMITATION(no-visited-links): `<a href>` gets the unvisited link
 *    colour and underline (`a:link`), but `:visited` is not evaluated — that
 *    needs history state we do not have, so a followed link never changes
 *    colour. An anchor with no `href` is correctly left unstyled, as in a
 *    browser.
 */

import type {ColorValue} from 'react-native';

import {systemColor} from './systemColors';
import {Platform, PlatformColor} from 'react-native';

/**
 * The surface a text-entry control sits on — `<input>`'s textual types,
 * `<textarea>`, and `<select>` on Android.
 *
 * Without it the controls were TRANSPARENT: a bare rounded-rect border on the
 * grouped gray page on iOS, an underline floating in space on Android — both
 * read as body text, not as things to type into. Each platform's own forms
 * answer differently and the table says so:
 *
 *  - iOS fields sit on the system background (white in light, elevated in
 *    dark) — the look of a field in any grouped Settings-style page. The
 *    radius matches `UITextField`'s rounded-rect border so the host's fill
 *    stays inside the control's own outline. The colour is CSS's own `Field`
 *    keyword resolved to the platform (see systemColors.js).
 *  - Android fields are Material 3 FILLED text fields: a tonal container
 *    with the top corners rounded (extra-small, 4dp) and the active
 *    indicator underline the theme already draws at the bottom edge; 16dp
 *    inline padding is the spec's content inset. The container tone is the
 *    component role M3 names for filled fields, theme-derived so Material
 *    You recolours it. The bare underline-only `EditText` is the Material 2
 *    idiom, and reading it next to real M3 apps is what prompted this.
 *
 * An author's `backgroundColor`/`borderRadius`/`padding` still wins — this
 * merges below author styles like every other UA declaration.
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
 * The monospace face, by a name each platform actually has.
 *
 * CSS's generic families (`monospace`, `serif`, `sans-serif`) are not font
 * names, and React Native resolves `fontFamily` against real faces. Android
 * happens to accept `'monospace'` as an alias, so `<code>` looked right there
 * and silently fell back to the system font on iOS — the same declaration
 * working on one platform and doing nothing on the other, which is the hardest
 * kind of gap to notice.
 *
 * DOM-CSS-LIMITATION(no-generic-font-families): the other generics are not
 * mapped, so `font-family: serif` still resolves to nothing.
 */
const MONOSPACE: string = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export type UAStyle = {[string]: unknown};

/**
 * The root font size, in points — what `1em` means in this stylesheet.
 *
 * A browser's root is 16px. This one is the platform's own body text size, and
 * that choice is the deliberate one: iOS sets body copy at 17pt
 * (`UIFont.systemFontSize`) and Material's `bodyLarge` is 16sp, so a document
 * built from these elements reads at the size everything else on the phone
 * does. React Native's own default of 14 is neither the web's figure nor either
 * platform's, and prose left at it came out noticeably small next to any native
 * app.
 *
 * DOM-CSS-DEVIATION(root-font-size-is-native-not-16px): documents here are not
 * 16px-rooted, so a length quoted in `em` resolves to a different number of
 * points than the same stylesheet would produce in a browser — and to a
 * different number on each platform. Proportions are preserved, absolute sizes
 * are not.
 *
 * This must stay in step with `kDefaultFontSize` in `TextAttributes.cpp`, which
 * is where text with no `font-size` of its own gets the same platform size
 * from. The two are one metric written on each side of the bridge: this one is
 * the base for the `em`-derived values in this sheet — the heading sizes and
 * the margins computed from them — and that one is the initial value every
 * element, bare string and `<Text>` starts at.
 *
 * It is ONE default in ONE place over there on purpose, and the comment beside
 * it says why: seeding only the element cascade gave a bare string the native
 * size while a plain `<Text>` kept React Native's 14, which breaks the
 * invariant that `<View>{'hi'}</View>` measures the same as
 * `<View><Text>hi</Text></View>`.
 */
const ROOT_FONT_SIZE: number = Platform.select({
  ios: 17,
  android: 16,
  default: 16,
});
/*
 * The colour text is drawn in when nothing else decides it.
 *
 * CSS calls this `CanvasText`, and a browser resolves it against the page's
 * colour scheme. Naming each platform's own label colour does the same job and
 * does it better: a native app themes without being asked, so an element that
 * stays black on a dark surface looks imported. This is one of the few places
 * worth departing from the web, whose initial value is a fixed colour.
 *
 * A platform colour rather than a light/dark pair, so the value is the
 * platform's own and follows any appearance it grows later. The Android
 * spelling only began resolving once `ColorPropConverter.resolveThemeAttribute`
 * was fixed — it returned a ColorStateList's resource ID as though it were
 * ARGB, which drew as fully transparent text. See `ColorPropConverterTest`.
 */

const EM = ROOT_FONT_SIZE;

/*
 * `<button>`'s platform chrome, hoisted and typed.
 *
 * Two Flow problems live in this one call, and they pull in opposite
 * directions. Unannotated, `Platform.select` infers NUMBER LITERAL types from
 * the branches — `8`, `4`, `6` — and reports them as mutually incompatible,
 * though differing is the entire point. Annotated as `UAStyle`, the indexer
 * makes the result unspreadable, because Flow cannot tell whether an indexed
 * key will overwrite an explicit one.
 *
 * Naming the three properties satisfies both: concrete enough to spread,
 * general enough that the branches may differ. `default` has no platform
 * colours to offer, so the colour fields are optional rather than invented.
 */
/*
 * The padding here was Safari's, and it is now each platform's own.
 *
 * It used to be `2` and `8`, derived from Safari's user-agent style for
 * `<button>` (`padding: 0 6px 1px`, `border: 2px outset` — content inset 8 and
 * 2). That was a real measurement of the wrong thing: this element carries the
 * *platform's* chrome rather than the browser's, which is a choice made and
 * documented long before, and a browser's padding under a platform's fill is
 * neither. The visible result was a button noticeably tighter and smaller than
 * anything else on the device.
 *
 * Native takes precedence over the web where the two disagree about a control's
 * appearance, so the numbers below come from UIKit and from the Android
 * framework directly. The web's own values are recorded above for the record.
 *
 * A note that still applies: a switch track and a radio indicator are
 * `element-checkbox` and `element-radio`, separate components taking
 * `uaStyleFor('input')`, so this entry does not reach them. The two fixtures in
 * `ButtonContentCentring-itest` that still model a control out of `<button>`
 * state their own geometry, which is what a control that owns its layout does.
 */
type ButtonChrome = {
  fontSize?: number,
  fontWeight?: string,
  letterSpacing?: number,
  paddingBlock: number,
  paddingInline: number,
  minHeight: number,
};

/*
 * `<button>`'s SURFACE is no longer described here at all.
 *
 * The platform views draw it with the platform's own machinery — a real
 * `UIButton` with a real `UIButtonConfiguration` hosted behind the children on
 * iOS, the Material button construction (inset pill + ripple) on Android — so
 * the fills, shapes, dark-mode adaptations and disabled states are UIKit's and
 * Material's own rather than this sheet's description of them. The first
 * CSS-described chrome drifted precisely the way a description does: its
 * gray-button label was UIKit's pre-26 blue, its Android shape was the
 * Material-2-era 4dp rectangle. What remains here is what the *renderer*
 * needs: the label's typography and colours, the content inset, and the
 * minimum touch target.
 *
 * MEASURED, still. iOS: a gray `UIButtonConfiguration` reports content insets
 * 7/12 and — rendered, not just queried — draws its label in the LABEL colour
 * on iOS 26 (`titleColorForState:` still answers `systemBlue`, and the actual
 * pixels disagree; trust the pixels). A filled one draws white on `systemBlue`.
 * Android: Material 3's `Widget.Material3.Button` styles resolve
 * label-large typography (14sp, weight 500, 0.1 letter spacing), 24dp inline
 * padding, and the two prominences' colour roles — filled is
 * `colorPrimary`/`colorOnPrimary`, tonal is
 * `colorSecondaryContainer`/`colorOnSecondaryContainer` — read from the
 * material library's own resources, not the docs.
 *
 * `minHeight` is the accessible touch target (HIG 44, Material 48): a
 * `<button>`'s box IS its touch target here, so the visual-height question and
 * the touch-target question collapse into one number and it is the larger.
 *
 * `textAllCaps` is deliberately not adopted. It would change the element's
 * text rather than its presentation, and Chrome on Android does not uppercase
 * `<button>` either.
 */
/**
 * `<input type="checkbox">`'s box, stated as the size of the control that
 * backs it — a UISwitch on iOS, a CheckBox on Android.
 *
 * The iOS numbers are the CURRENT OS's, not the famous ones: UISwitch has
 * been 63x28 since iOS 26 (measured: `intrinsicContentSize`), after a decade
 * at 51x31 — and a UISwitch IGNORES assigned sizes, so a sheet stating the
 * old footprint got a control that overflowed its own layout box by 12pt and
 * swallowed exactly this margin plus the label's space.
 * `EXPElementCheckboxGeometryTests` (ObjC) and `checkableMetrics-test.js`
 * pin the control's real intrinsic size to these literals so the next silent
 * resize fails a test instead of a screenshot.
 *
 * The inline-end margin is the platform's own label spacing, and the two run
 * in OPPOSITE directions from the same markup.
 * `<label><input/> Subscribe</label>` contributes one space character: on iOS
 * that puts the label almost flush against the switch — no HIG form does
 * that; system apps sit labels ~8pt off a control, so the margin adds it. On
 * Android the 48dp touch box already carries 12dp of visual inset past the
 * 24dp drawable, and Material's spec places the label 12dp from the ICON —
 * i.e. at the touch target's edge — so the space character pushes the label
 * PAST the platform's position; the negative margin gives that overshoot
 * back. DOM-CSS-DEVIATION(checkable-label-gap): a browser adds no spacing
 * here at all; the platforms' own form conventions take precedence.
 * Informational, not a warning.
 *
 * DOM-CSS-DEVIATION(checkable-line-centering): `vertical-align: middle`
 * rather than CSS's initial `baseline`. A browser's checkable is a ~13px
 * glyph whose bottom sits ON the baseline and looks right there; these are
 * the platform's own controls in the platform's own boxes — a 48dp Material
 * touch target with the 24dp drawable centred in it, a 28pt switch — and
 * baseline-aligning the BOX drops the visible control well below (iOS) or
 * rides it high above (Android) the words it labels. Material rows and iOS
 * Settings rows both centre the control against the label line, so the sheet
 * says so. `middle` here is CSS's own middle (baseline + half x-height), the
 * same maths all three engines implement for atomic inlines.
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
  ios: {width: 63, height: 28, marginInlineEnd: 12, verticalAlign: 'middle'},
  android: {
    width: 48,
    height: 48,
    marginInlineEnd: -4,
    verticalAlign: 'middle',
  },
};

/**
 * `<input type="radio">`'s box.
 *
 * A checkmark's box on iOS, not a ring's. UIKit has no radio control —
 * `PickerStyle.radioGroup` is macOS-only — and what the platform offers for
 * "one of several" is a list whose chosen row carries a checkmark. A run of
 * radios is presented as exactly that, so the checkmark IS the indicator and a
 * ring beside it would state the same thing twice in two different symbols.
 *
 * ZERO WIDTH, because the element has nothing to draw. The checkmark is the
 * LIST'S — a real `UICellAccessoryCheckmark`, so its glyph, its tint, its
 * placement and its side are the platform's, trailing in a left-to-right layout
 * and leading in a right-to-left one. Drawing one here as well produced exactly
 * what it sounds like: two checkmarks on the chosen row.
 *
 * The space the accessory needs is reserved instead as the ROW's user-agent
 * padding, which is where it belongs — the row is the box the platform insets,
 * and a row's contents are positioned by Yoga across its width and cannot be
 * re-flowed afterwards. See `radioRowPadding()`.
 *
 * The HEIGHT is not zero, and it is the one number here that does work. Yoga
 * measures the row and UIKit draws the cell behind it, and if they disagree the
 * disagreement is visible: a row measured at its label's 20pt got a section
 * 20pt tall, UIKit drew its cell taller, and each group showed its first row
 * with the rest clipped off square.
 *
 * 52 is the platform's STANDARD ROW HEIGHT, not the HIG's 44pt minimum tappable
 * target. Those are different numbers and using the minimum for the standard is
 * how a list ends up looking cramped: measured against Settings on the same
 * device, its rows are 52pt and a 44pt row is visibly tighter. UIKit says so
 * itself — a list cell with nothing to measure falls back on 52, which is not a
 * guess but the height its appearance uses.
 *
 * It is a FLOOR, not a fixed height. A row whose own content is taller keeps
 * its height, so a two-line row is a two-line row; and the 44pt target is still
 * met with room to spare.
 *
 * The element is still there and still carries `name`, `value` and `checked`: a
 * form reads it and the run asks it which row is chosen. It simply has no ink,
 * and a zero-WIDTH box is how an element says that without disturbing the row
 * its author laid out around it.
 *
 * Its HEIGHT is not zero, and that is the one number here that does work.
 * Yoga lays the row out and UIKit draws the cell, and the two have to agree or
 * the disagreement is visible: a row measured at its label's 20pt gets a list
 * frame 20pt tall, UIKit draws its cell at the standard 44, and the run shows
 * its first row with the rest clipped off — which is exactly what it did.
 *
 * 44 is the platform's, not ours: it is `UITableViewCell`'s standard height and
 * the HIG's minimum tappable target, the size UIKit will use whatever we ask
 * for. Stating it on the control means any row containing a radio reserves the
 * height its cell is going to take, and a row whose own content is TALLER than
 * that still wins — the cell is given the height Yoga measured, so an author
 * who builds a two-line row gets a two-line row.
 *
 * It sits beside Android's 48dp target below, which is the same kind of number
 * for the same kind of reason: the platform's metric, written where the
 * platform's other metrics are.
 *
 * Android keeps its own `RadioButton`, drawn in the platform's 48dp target,
 * because Android HAS the control. The element is the semantic and the control
 * is each platform's answer to it — which is the same reasoning that makes a
 * checkbox a switch on one and a checkbox on the other.
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
  ios: {width: 0, height: 52, marginInlineEnd: 0, verticalAlign: 'middle'},
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
    paddingBlock: 7,
    paddingInline: 12,
    minHeight: 44,
  },
  android: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.1,
    paddingBlock: 4,
    paddingInline: 24,
    minHeight: 48,
  },
  default: {
    paddingBlock: 4,
    paddingInline: 12,
    minHeight: 44,
  },
};

/*
 * Exported above rather than passed straight to `Platform.select`, so both
 * branches can be asserted from one test. Each runner only ever sees one of
 * them — jest is `ios`, Fantom is `android` — so a table that collapses before
 * anything can read it leaves whichever platform the runner is not to drift
 * unchecked. `buttonMetrics-test.js` checks both against the measurements.
 */
const BUTTON_CHROME: ButtonChrome = Platform.select<ButtonChrome>({
  // Spelled out rather than spread: `PlatformSelectSpec`'s properties are
  // optional and invariantly typed, so the table — whose properties are
  // deliberately required, that being what the test asserts — is not directly
  // one.
  ios: BUTTON_CHROME_BY_PLATFORM.ios,
  android: BUTTON_CHROME_BY_PLATFORM.android,
  default: BUTTON_CHROME_BY_PLATFORM.default,
});

/**
 * The label colour for a prominence, spoken in CSS system colors.
 *
 * `ButtonText` and `AccentColorText` are CSS Color 4's own names for exactly
 * these two roles, and `systemColors.js` resolves each to the OS's adaptive
 * token (`UIColor.label` / `?attr/colorOnSecondaryContainer`, white /
 * `?attr/colorOnPrimary`). The surface colours never pass through here at
 * all — the platform views draw the surfaces natively. The label is drawn by
 * the renderer, so its colour has to come through the sheet.
 */
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
    paddingBlock: BUTTON_CHROME.paddingBlock,
    paddingInline: BUTTON_CHROME.paddingInline,
    minHeight: BUTTON_CHROME.minHeight,
    // On the web a flex item's implied `min-width: auto` (its min-content)
    // stops a shrunk button collapsing below its label. Yoga has no
    // automatic minimum, so the flex-shrink:1 initial the elements state
    // let a tight row wrap "Submit" onto two lines. Not shrinking is the
    // Yoga-expressible half of CSS's floor for a control whose whole width
    // IS its label; an author flexShrink still wins.
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
  // Block-level containers. `display` comes from the element's registration
  // (they alias <div>), so only the box metrics belong here.
  /*
   * `<p>` uses the SHORTHAND, like every other block element here, and a
   * previous attempt to write it as longhands was reverted. Both halves of that
   * are load-bearing.
   *
   * The bug it was working around is real: with `marginBlock: EM` a paragraph
   * gets no vertical margin on either DEVICE, so two adjacent `<p>`s sit one
   * line apart and the space *between* paragraphs equals the line spacing
   * *inside* one — on the most common block element in HTML.
   * `DOM-CSS-LIMITATION(paragraph-margin-shorthand-dropped)` tracks it. Ruled
   * out already, so nobody repeats it: not the value, the container, the
   * position in the tree, margin support, or margin collapsing; not the style's
   * shape (`<dl>` has the byte-identical `{marginBlock: EM}` and works, as do
   * `<figure>`, `<blockquote>` and `<h1>`–`<h6>`); not the sheet failing to
   * reach the element (a throwaway tag with a view config verified identical to
   * `<p>`'s gets its margin). It is specific to this tag and below JavaScript.
   *
   * Writing longhands here DID restore the gap on both devices — and broke
   * something worse, which is why it is gone.
   *
   * `applyAliasedProps` treats `marginBlock` as an alias WITH precedence: it
   * sets `Edge::Vertical` unconditionally. The longhands are aliases WITHOUT
   * precedence: they fill `Edge::Top`/`Bottom` only when those are still
   * undefined. So a UA longhand BEATS an author shorthand — `<p style={{
   * marginBlock: 0 }}>` sets Vertical to 0, leaves Top/Bottom undefined, and
   * the user-agent's 16pt then fills them in. The cascade runs backwards, on
   * the one element authors most often restyle.
   *
   * Two tests in `DomElementsCatalog-itest` say exactly that, and both failed:
   * "<p> is block-level" (40 expected, 104 measured — four 16pt margins that
   * should not have been there) and, on the nose, "an author style beats the UA
   * default". A user-agent default that cannot be overridden is a worse defect
   * than a missing default, so the gap goes back to being a known bug rather
   * than being bought at that price.
   *
   * Fantom does not reproduce the device bug — it measures the correct gap
   * either way — so no Fantom test can guard a fix for it. It DID catch the
   * regression above, which is the part that matters here.
   */
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
  /*
   * `<hr>` — html.css says `border: 1px inset`, a 3D border that renders as a
   * dark line on the web (there is no system colour behind it to soften it).
   * A thematic break drawn by the platform is a SEPARATOR, and both platforms
   * name a token for exactly that — iOS `separator`, Material's
   * `colorOutlineVariant` — so the sheet delegates to them, which also keeps
   * the rule adaptive in dark mode. DOM-CSS-DEVIATION(hr-separator-color):
   * deliberately lighter than the web's inset line; the platform's own
   * divider idiom takes precedence. The hex fallback approximates both.
   */
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

  /*
   * Headings: bold, with sizes and margins that shrink together down the scale.
   * h1 is 2em down to h6 at 0.67em, and the margins move the other way.
   *
   * The margins are written as two factors on purpose. `html.css` gives them in
   * `em`, and `em` in a margin resolves against **the element's own font-size**
   * — which for a heading is not the root size. Multiplying the spec's figure
   * by a fixed root EM gets h4 right by luck (h4 is 1em) and everything else
   * wrong in both directions at once: h1 and h2 come out at roughly half the
   * margin they should have, while h6 comes out about 50% too large. On screen
   * that reads as an h1 sitting too close to what precedes it and the small
   * headings drifting apart, which looks like a margin-collapsing fault and is
   * not one.
   *
   * Left as `spec figure × own font-size` rather than folded into a single
   * constant so the derivation stays checkable against the spec.
   */
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

  // Lists. The 40pt inline-start padding is the gutter an `outside` marker
  // hangs in, which is where the list container generates them (css-lists-3
  // §3); `<li>` needs no rule of its own here.
  // Form containers. <form> is block-level with no box metrics of its own in
  // standards mode (the 1em block-end margin is a quirks-mode rule, and there
  // is no quirks mode here — DOM-CSS-LIMITATION(no-quirks-mode)).
  form: {},
  /*
   * <fieldset> is drawn as the platform's GROUP SURFACE, not as html.css's
   * box. The web's `border: groove 2px ThreeDFace` has no analogue here
   * (DOM-CSS-LIMITATION(no-groove-border)), and its `0.35em/0.625em` block
   * padding — tuned around 13px web controls — reads cramped wrapped around
   * a 44pt switch or a 56dp field. What a native form puts around a group of
   * related controls is a rounded outlined surface with real breathing room:
   * an inset-grouped section on iOS (10pt radius; hairline in `separator`),
   * an outlined card on Material (12dp radius; `colorOutlineVariant`, 16dp
   * padding). DOM-CSS-DEVIATION(fieldset-native-surface): the platform's
   * group idiom takes precedence over html.css's metrics; the legend sits
   * above the surface (see `legend`).
   */
  fieldset: {
    marginInline: 2,
    /*
     * The GROUPED page colour, which is what makes the surface readable.
     *
     * A run of radios inside a fieldset draws as the platform's inset-grouped
     * list, and that list's card is `secondarySystemGroupedBackground` —
     * white in light mode. With no fill here the card sat on the page's own
     * white and the rows had nothing to sit on: an outline around some text.
     * The platforms answer this with the PAGE, not with more edges, so the
     * fieldset takes the page colour and the list card contrasts against it,
     * exactly as a grouped section does in Settings.
     */
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
  // The legend renders ABOVE the fieldset's box (Fieldset.js hoists it —
  // DOM-CSS-DEVIATION(fieldset-legend-position)); the block-end margin is the
  // platforms' label-to-surface gap, the role html.css's border-notch layout
  // plays on the web.
  legend: {paddingInline: 2, marginBlockEnd: 6},

  // <address> is block-level AND italic; both come from html.css.
  address: {fontStyle: 'italic'},
  // <menu> is a list: the HTML Standard groups it with dir/ol/ul for margins
  // and with dir/ul for the disc marker.
  menu: {marginBlock: EM, paddingInlineStart: 40, listStyleType: 'disc'},
  // Scripting is always enabled here, so <noscript> content never renders —
  // `@media (scripting) { noscript { display: none !important } }`. There is no
  // no-scripting mode to fall back to, so this is unconditional.
  noscript: {display: 'none'},
  ul: {marginBlock: EM, paddingInlineStart: 40},
  ol: {marginBlock: EM, paddingInlineStart: 40},
  dl: {marginBlock: EM},
  dd: {marginInlineStart: 40},

  // Form controls. Browsers give <button> `display: inline-block`, which is
  // what makes it a box that takes padding while still sitting in a line of
  // text. Without it a <button> is a span-like inline element and its padding
  // has nowhere to apply.
  //
  // Browsers centre a button's content on BOTH axes — which is why a radio's
  // dot and a checkbox's tick sit in the middle of their box on the web
  // without the markup saying anything about alignment. `text-align` does the
  // inline axis; `align-content` does the block one (css-align-3 §5.3 applies
  // it to block containers, where a block container's contents are a single
  // alignment subject).
  //
  // Neither reaches for `justify-content`, and that matters: a button whose
  // author made it a flex container keeps its own alignment. Centring with
  // `justify-content` here is what once centred the sliding thumb inside a
  // switch track — an `inline-flex` button whose thumb's whole job is to sit
  // at one end.
  /*
   * `<button>` — a real platform button's chrome, not a browser's.
   *
   * It carried layout only, so it drew as bare text: indistinguishable from a
   * label, with nothing for the press state to change. The press tracking was
   * already live — the component reports `:active` continuously and RNTester
   * enables `enableNativeGestureRecognizers` natively on both platforms — so
   * the missing feedback was only ever a missing surface to paint.
   *
   * Native takes precedence over the web here. A browser draws
   * `background: ButtonFace; border: 2px outset; padding: 1px 6px`, which looks
   * like nothing on either platform. These are the platforms' own: the
   * bordered/tinted button on iOS, the same construction `<select>` uses, and a
   * filled button on Android.
   *
   * `color` belongs here and is NOT the inheritance bug: verified in Chrome,
   * `<div style="color:red"><button>` computes BLACK — a form control states its
   * own text colour while a presentational inline inherits. `backgroundColor`
   * is not an inherited property at all. See [[ua-colour-broke-inheritance]].
   *
   * Padding IS declared, via `BUTTON_INSET` — see the measurement there. It was
   * absent for a long time under
   * `DOM-CSS-LIMITATION(button-padding-unresolved)`, which is now closed.
   *
   * Only the SURFACE is platform chrome — fill, radius, tint. Geometry is left
   * exactly as it was, because `<button>` is also the box a switch track and a
   * radio indicator are built from, and padding moved their contents. Measured
   * in Chrome, a browser's own `padding: 1px 6px` puts a switch thumb at
   * left 8 (ours: 8 with padding, 2 without) and a 16pt indicator's dot at
   * left 7 (ours: 3 either way) — so the two cases do not agree about what
   * following the browser would even mean here.
   *
   * The geometry note below is kept because it is the evidence, and because it
   * still bounds what "follow the browser" can mean here: measured in Chrome, a
   * browser's `padding: 1px 6px` puts a switch thumb at left 8 and a 16pt
   * indicator's dot at left 7, so the two constructions never agreed about what
   * following the browser would produce. The resolution was to stop treating
   * them as the same question — the controls are their own components now.
   */
  button: buttonSheetEntry(),

  // <img> is an inline REPLACED element: inline-level on the outside, with
  // contents the layout never lays out. `inline-block` is how that outer box
  // type is spelled here, the same as <button> above.
  //
  // Stating it in the UA sheet matters rather than leaning on the shadow node's
  // `InlineReplaced` trait, because only *some* backings declare that trait.
  // The framework's own image shadow node does; an autolinked one — expo-image,
  // which `<img>` resolves to whenever the Expo runtime is present — does not,
  // and a plain view shadow node has no way to say "I am replaced". So an
  // <img> silently became a block-level flex child and took a line of its own,
  // breaking the sentence it was meant to sit inside. A UA declaration is the
  // one place that reaches every backing, which is where the box type belongs.
  img: {display: 'inline-block'},

  // Inline presentational. <b>/<i>/<u> are here rather than baked into their
  // C++ props classes, so a default lives in exactly one place.
  b: {fontWeight: 'bold'},
  i: {fontStyle: 'italic'},
  u: {textDecorationLine: 'underline'},
  strong: {fontWeight: 'bold'},
  em: {fontStyle: 'italic'},
  cite: {fontStyle: 'italic'},
  dfn: {fontStyle: 'italic'},
  // `<var>` is italic in every browser's user-agent sheet and was the one
  // member of the italic set we had missed — found by measuring Chrome rather
  // than by reading, because upright text next to <code> and <samp> looks
  // deliberate.
  var: {fontStyle: 'italic'},
  /*
   * `<abbr>` gets the dotted underline browsers give it — the affordance that
   * says "this is an abbreviation with an expansion", read off Safari's
   * computed style (`text-decoration: underline dotted`) rather than assumed.
   *
   * It is drawn by each platform's own text stack, not by a border: CoreText's
   * `NSUnderlineStyleSingle | NSUnderlinePatternDot` on iOS and Android's
   * dotted decoration path, both of which already exist here for
   * `text-decoration-style` and both of which follow the text through wrapping.
   * A border cannot do that — it would box the element rather than underline
   * its lines.
   *
   * Browsers scope this to `abbr[title]`, on the reasoning that the affordance
   * promises an expansion. There is no attribute selector here, and `title`
   * does not reach the native side yet (see *Not built yet*), so it is
   * unconditional: an `<abbr>` is an abbreviation whether or not the expansion
   * is currently carried, and the alternative is drawing nothing at all.
   */
  abbr: {textDecorationLine: 'underline', textDecorationStyle: 'dotted'},
  small: {fontSizeEm: 0.8333},
  /*
   * Monospace text is also SMALLER — `13px` against a 16px root, which every
   * browser applies and which measuring Chrome is the only way to discover.
   * The reason is optical rather than arbitrary: a monospace face at the same
   * nominal size reads noticeably larger than the surrounding proportional
   * text, so `<code>` in a sentence looked oversized next to it.
   */
  code: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  kbd: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  samp: {fontFamily: MONOSPACE, fontSizeEm: 0.8125},
  s: {textDecorationLine: 'line-through'},
  del: {textDecorationLine: 'line-through'},
  ins: {textDecorationLine: 'underline'},
  mark: {backgroundColor: '#ffff00', color: '#000000'},
  /*
   * `<sup>` and `<sub>` — verified against Chrome, which computes
   * `vertical-align: super`/`sub` at `font-size: 13.3333px` on a 16px root.
   * That is `smaller`, the same 0.83 ratio `<small>` uses.
   *
   * They had NO user-agent style at all, so both rendered as ordinary text and
   * the elements did nothing visible — registered, inherited from, and inert.
   */
  sup: {fontSizeEm: 0.8333, verticalAlign: 'super'},
  sub: {fontSizeEm: 0.8333, verticalAlign: 'sub'},
};

/**
 * CSS initial values that differ from React Native's defaults.
 *
 * The web applies these to every element before any stylesheet runs, so they
 * belong to the elements rather than to the components backing them — which is
 * exactly why they live here and not in `View`. A react-native `<View>` or
 * `<ScrollView>` keeps RN's own defaults; only registered HTML intrinsics get
 * these.
 */
const INITIAL_VALUES: {[string]: unknown} = {
  /*
   * `color` is NOT here, and must not be.
   *
   * It was, and it broke inheritance everywhere. `INITIAL_VALUES` is applied to
   * every element, so stating `color` here gave each element its OWN colour
   * declaration — which outranks the value it should have inherited. A
   * `<div style={{color:'red'}}>` then drew its `<b>` and `<small>` children in
   * the canvas colour instead of red.
   *
   * The comment that used to sit here claimed an inherited author value beats
   * the user-agent origin in this engine. It does not. That was generalised
   * from a single case that happened to work, and it justified the bug for as
   * long as it stood.
   *
   * Browsers do not state `color` per element either — they state it once on
   * the root and let the cascade carry it, which is what the inherited origin
   * is for. An element here can be mounted anywhere, so there is no such root
   * to write it on, and the platform-themed default therefore belongs in the
   * renderer's choice of default foreground colour rather than in a
   * declaration that participates in the cascade.
   *
   * DOM-CSS-LIMITATION(themed-default-colour-needs-a-root): tracked separately;
   * inheritance correctness comes first, because a broken cascade is a much
   * worse failure than an unthemed default.
   */
  // `flex-direction`'s initial value is `row` (css-flexbox-1 §5.1); React
  // Native defaults to `column`. On the web this only takes effect on a flex
  // container, and the same holds here: a block container lays out through
  // Yoga's block display, which ignores it.
  flexDirection: 'row',
  // `flex-shrink`'s initial value is 1 (css-flexbox-1 §7.3); React Native
  // defaults to 0. On the web a flex item yields when the row runs out of
  // room; an RN item overflows instead — which is how a `<label>` beside a
  // checkbox in a flex row CLIPPED its text at the row's edge where a
  // browser wraps it. Like flexDirection above, it only means anything when
  // the element is actually a flex item.
  flexShrink: 1,
};

/**
 * The UA style for `tag`, including the initial values above.
 *
 * Returns the SAME object each time and seeds it in place rather than building
 * a merged copy, because view configs capture this object by reference when
 * the element is registered — `overrideUAStyle` depends on that, and a fresh
 * object here would silently stop later overrides from being seen.
 *
 * A per-tag declaration wins: the table below is a more specific origin than
 * an initial value, so `in` rather than a blind assignment.
 */
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
