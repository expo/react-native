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
 * CSS system colors (CSS Color 4 §6.1), resolved to each OS's own symbolic
 * colours.
 *
 * This is the web's mechanism for "use the platform instead of copying it": a
 * page that says `AccentColor` gets whatever the OS considers its accent,
 * in the current scheme, at the current contrast. The same division of labour
 * applies here — the user-agent sheet speaks these NAMES, and this module is
 * the only place they become platform colours:
 *
 *  - **The endpoints are the OS's adaptive tokens**, never literal RGB.
 *    `UIColor.label` and `?attr/colorOnPrimary` re-resolve per trait
 *    collection and per configuration, so dark mode, Material You dynamic
 *    colour, and the platforms' high-contrast modes all arrive without this
 *    code knowing they exist. A literal here would be the moment one of those
 *    stops working.
 *  - **Control surfaces are not colours at all** where the platform will draw
 *    them: `<button>`'s chrome is a real `UIButtonConfiguration` on iOS and
 *    the Material construction (theme-attr-tinted) on Android, both drawn
 *    natively. This table covers what the *renderer* draws — text, mostly.
 *
 * The name → role mapping follows how browsers bind these to native platforms
 * (WebKit binds `AccentColor` to the platform accent, `CanvasText`/`ButtonText`
 * to label colours), with the Material bindings chosen from the roles Material
 * gives the corresponding component.
 *
 * Author-facing theming — `var(--accent)`-style overrides that fall back to
 * these — is the CSS-variables half of this design and needs inherited custom
 * properties in the renderer; tracked as a roadmap item, not attempted here.
 */

import type {ColorValue} from 'react-native';

import {Platform, PlatformColor, processColor} from 'react-native';

/*
 * Literal colours must be PROCESSED before they enter the sheet. The
 * user-agent style is merged beneath the author's in the RENDERER, past the
 * JavaScript layer where view configs run `processColor` — so a `PlatformColor`
 * object survives (the renderer speaks that dialect) while a raw CSS string
 * does not: it fails colour conversion silently and the text draws
 * TRANSPARENT. Found exactly that way — the filled button's white label was
 * invisible on iOS while Android's (`PlatformColor`) label rendered.
 */
function literal(color: string): ColorValue {
  // `?? color` only for the type: every string in these tables processes.
  return processColor(color) ?? color;
}

const IOS: {[string]: ColorValue} = {
  // The page.
  Canvas: PlatformColor('systemBackground'),
  CanvasText: PlatformColor('label'),
  // The accent and what sits on it. `systemBlue` is the resolved default
  // accent (UIKit's default tintColor); text on a filled accent surface is
  // white in every scheme UIKit ships.
  AccentColor: PlatformColor('systemBlue'),
  AccentColorText: literal('white'),
  // Buttons. The face is what a gray `UIButtonConfiguration` draws; the text
  // is the label colour — measured on iOS 26, where a gray button's title is
  // label-coloured (not blue; that was the pre-26 look).
  ButtonFace: PlatformColor('secondarySystemFill'),
  ButtonText: PlatformColor('label'),
  // Fields.
  Field: PlatformColor('systemBackground'),
  FieldText: PlatformColor('label'),
  // Links and disabled text.
  LinkText: PlatformColor('link'),
  GrayText: PlatformColor('tertiaryLabel'),
};

const ANDROID: {[string]: ColorValue} = {
  Canvas: PlatformColor('?android:attr/colorBackground'),
  CanvasText: PlatformColor('?android:attr/textColorPrimary'),
  // Material's accent pair: the filled component roles.
  AccentColor: PlatformColor('?attr/colorPrimary'),
  AccentColorText: PlatformColor('?attr/colorOnPrimary'),
  // Material's neutral component roles — what a tonal button wears.
  ButtonFace: PlatformColor('?attr/colorSecondaryContainer'),
  ButtonText: PlatformColor('?attr/colorOnSecondaryContainer'),
  Field: PlatformColor('?attr/colorSurface'),
  FieldText: PlatformColor('?attr/colorOnSurface'),
  /*
   * `textColorLink`, the FRAMEWORK's own link colour, not `colorPrimary`.
   *
   * Material's guidance for links in body text does say `primary`, and that is
   * right in a Material 3 theme where `primary` is chosen against the surface.
   * It is not a safe default: `colorPrimary` is a BRAND colour, and an app on
   * an AppCompat or Material 2 theme has one picked for a light app bar. In
   * dark mode that rendered links very nearly black on a near-black surface —
   * legible only if you knew where to look. Measured on the emulator.
   *
   * `?android:attr/textColorLink` is defined by every theme, is what `URLSpan`
   * itself uses, and is specified against the theme's text background — so it
   * has the contrast this needs by construction rather than by luck.
   */
  LinkText: PlatformColor('?android:attr/textColorLink'),
  GrayText: PlatformColor('?android:attr/textColorTertiary'),
};

/*
 * The web's own fallbacks, for a platform that is neither (out-of-tree
 * platforms, tests): the values CSS suggests for a light scheme.
 */
const DEFAULT: {[string]: ColorValue} = {
  Canvas: literal('white'),
  CanvasText: literal('black'),
  AccentColor: literal('#0000ee'),
  AccentColorText: literal('white'),
  ButtonFace: literal('#dddddd'),
  ButtonText: literal('black'),
  Field: literal('white'),
  FieldText: literal('black'),
  LinkText: literal('#0000ee'),
  GrayText: literal('#808080'),
};

export const SYSTEM_COLORS_BY_PLATFORM: {
  ios: {[string]: ColorValue},
  android: {[string]: ColorValue},
  default: {[string]: ColorValue},
} = {ios: IOS, android: ANDROID, default: DEFAULT};

const TABLE: {[string]: ColorValue} = Platform.select({
  ios: IOS,
  android: ANDROID,
  default: DEFAULT,
});

/**
 * A CSS system color, resolved for this platform. Throws on an unknown name
 * rather than falling back: a typo that silently became `undefined` would
 * un-colour an element and read as a theming bug.
 */
export function systemColor(name: string): ColorValue {
  const value = TABLE[name];
  if (value == null) {
    throw new Error(`not a CSS system color: ${name}`);
  }
  return value;
}
