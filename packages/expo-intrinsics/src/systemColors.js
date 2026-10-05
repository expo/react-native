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
 * CSS system colors (CSS Color 4 §6.1) resolved to each OS's adaptive tokens,
 * never literal RGB, so dark mode, Material You and high contrast arrive
 * without this code knowing. The mapping follows how WebKit binds the names
 * (`AccentColor` to the platform accent, `CanvasText`/`ButtonText` to label
 * colours), with Material's roles for the corresponding component. Only what
 * the renderer draws is here; the platform views draw the control surfaces.
 */

import type {ColorValue} from 'react-native';

import {Platform, PlatformColor, processColor} from 'react-native';

/*
 * Literal colours must be PROCESSED before they enter the sheet. The
 * user-agent style is merged beneath the author's in the RENDERER, past the
 * JavaScript layer where view configs run `processColor` — so a `PlatformColor`
 * object survives (the renderer speaks that dialect) while a raw CSS string
 * does not: it fails colour conversion silently and the text draws
 * transparent.
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
  // `textColorLink` rather than `colorPrimary`: every theme defines it against
  // its text background and `URLSpan` uses it, whereas a brand `colorPrimary`
  // picked for a light app bar is near black on a dark surface
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
