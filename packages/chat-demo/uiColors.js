/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * UIKit's semantic colour names, on both platforms.
 *
 * `PlatformColor('label')` is an iOS name and only an iOS name. On Android it
 * resolves nothing and throws at the first view it is applied to — *None of the
 * paths in the `resource_paths` array resolved to a color resource* — which
 * takes the whole surface down rather than falling back to anything. So a demo
 * written in UIKit names is an iOS-only demo until each name has an Android
 * answer, and this is that table.
 *
 * The Android side is Material 3's roles, which describe the same relationships
 * under different names: a surface and what goes on it, a container and its
 * outline. Each entry passes a fallback as well, because the roles arrived in
 * different Material versions and an app on an older theme should get the
 * nearest older colour rather than the same failure.
 *
 * Why not the CSS system palette (`systemColor` in expo-intrinsics)? Because it
 * is missing the distinctions this app is made of. `Canvas` and `Field` are
 * both white in light mode, so a card drawn from them is invisible against its
 * page — which is the same reason the grouped-list colours here are UIKit's.
 */

import {Platform, PlatformColor} from 'react-native';

const ANDROID = {
  label: ['?attr/colorOnSurface', '?android:attr/textColorPrimary'],
  secondaryLabel: [
    '?attr/colorOnSurfaceVariant',
    '?android:attr/textColorSecondary',
  ],
  systemBlue: ['?attr/colorPrimary'],
  systemRed: ['?attr/colorError'],
  systemGray: ['?attr/colorOutline', '?attr/colorOnSurfaceVariant'],
  // The chip and bubble greys, light to dark. Material's container roles are
  // the same ladder: each step is a surface that sits above the one before.
  //
  // `systemGray3` is the exception, and the avatar is why: it is a shape drawn
  // ON the page rather than a surface the page sits on, so it has to differ
  // from the page. Material's surface roles do not — in this theme
  // `colorSurfaceVariant` is a tinted near-white, and the disc disappeared into
  // the transcript with its white initials on top. `colorOutlineVariant` is the
  // tone Material uses for exactly that job, and it lands next to iOS's
  // `#C7C7CC`.
  systemGray3: ['?attr/colorOutlineVariant', '?attr/colorSurfaceVariant'],
  systemGray5: [
    '?attr/colorSurfaceContainerHighest',
    '?attr/colorSurfaceVariant',
  ],
  // A translucent fill on iOS; Android has no translucent role, so this lands on
  // the same container as `systemGray5` — which is what the fill resolves to
  // over a plain page anyway.
  secondarySystemFill: [
    '?attr/colorSurfaceContainerHighest',
    '?attr/colorSurfaceVariant',
  ],
  systemBackground: ['?attr/colorSurface', '?android:attr/colorBackground'],
  systemGroupedBackground: [
    '?attr/colorSurfaceContainer',
    '?attr/colorSurfaceVariant',
  ],
  secondarySystemGroupedBackground: [
    '?attr/colorSurface',
    '?android:attr/colorBackground',
  ],
  separator: ['?attr/colorOutlineVariant', '?attr/colorOutline'],
};

/**
 * @param name a UIKit semantic colour name, e.g. `label` or `systemGray5`.
 */
export function uiColor(name) {
  if (Platform.OS === 'ios') {
    return PlatformColor(name);
  }
  const paths = ANDROID[name];
  if (paths == null) {
    /*
     * A WARNING, not a throw. A bad value used to red-box the whole screen,
     * and one misspelled accent took the chat down with it — where a browser
     * handed an unsupported attribute value simply ignores the declaration
     * and says so in the console. "Instead of a red box, I wish we'd just do
     * what a browser does when receiving unsupported attribute values.
     * Maybe a warning is OK." So: the console still names the mistake, and
     * the colour is dropped instead of the screen.
     */
    console.warn(
      `uiColor: no Android answer for '${name}'. Add one to uiColors.js.`,
    );
    return undefined;
  }
  return PlatformColor(...paths);
}

/*
 * Apple's accent values, for a PALETTE rather than a role.
 *
 * `uiColor` answers "what colour does this platform use for this job", and
 * refuses when a platform has no answer. A row of differently coloured tiles is
 * not that question: the colours distinguish commands from one another, they do
 * not mean anything on their own, and the native chat keeps the same ones in dark
 * mode
 * for exactly that reason.
 *
 * So iOS gets the real dynamic colour, and Android gets Apple's light-mode value
 * as a literal — the same hue on both platforms, which is the point, rather than
 * a Material role that would be a different colour with a similar name. Material
 * offers three accents and an error; this needs seven.
 */
const ACCENTS = {
  systemRed: '#ff3b30',
  systemOrange: '#ff9500',
  systemYellow: '#ffcc00',
  systemGreen: '#34c759',
  systemTeal: '#30b0c7',
  systemBlue: '#007aff',
  systemIndigo: '#5856d6',
  systemPurple: '#af52de',
  systemPink: '#ff2d55',
  systemBrown: '#a2845e',
  systemGray: '#8e8e93',
};

/**
 * One of the accents above, dynamic on iOS and literal on Android.
 *
 * @param name an accent name, e.g. `systemIndigo`.
 */
export function accentColor(name) {
  const literal = ACCENTS[name];
  if (literal == null) {
    // A warning and a dropped colour, browser-style — see `uiColor` above for
    // the report that retired the throw.
    console.warn(`accentColor: '${name}' is not one of the accents.`);
    return undefined;
  }
  return Platform.OS === 'ios' ? PlatformColor(name) : literal;
}
