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
 * UIKit semantic colour names that also work on Android. On Android,
 * `PlatformColor` with a UIKit name such as `label` throws at the first view
 * it is applied to ("None of the paths in the `resource_paths` array resolved
 * to a color resource"). `ANDROID` maps each name to Material 3 theme
 * attributes, each with a fallback attribute from an older Material version.
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
  // An outline colour, not a surface colour like `systemGray5`: it fills the
  // avatar (`styles.avatar` in ChatScreen.js), and `colorSurfaceVariant` is too
  // close to the transcript's background for the avatar to show.
  systemGray3: ['?attr/colorOutlineVariant', '?attr/colorSurfaceVariant'],
  systemGray5: [
    '?attr/colorSurfaceContainerHighest',
    '?attr/colorSurfaceVariant',
  ],
  // Translucent on iOS. Android has no translucent role, so this uses
  // `systemGray5`'s colours, which match the iOS fill over a plain background.
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
 * @param name a UIKit semantic colour name, e.g. `label`. On Android it must
 *   be a key of `ANDROID`.
 */
/*
 * Sent balloon gradient stops, sampled from native Messages. The composer's
 * send button and caret take the `bottom` stops. See ui-metrics.md, "Balloon
 * colours" and "Send blue and caret".
 */
export const BALLOON_BLUE = {
  light: {top: '#5AC8FA', bottom: '#0088FF'},
  dark: {top: '#409CFF', bottom: '#0091FF'},
};

export function uiColor(name) {
  if (Platform.OS === 'ios') {
    return PlatformColor(name);
  }
  const paths = ANDROID[name];
  if (paths == null) {
    // Warn instead of throwing, so a misspelled name loses one colour instead
    // of red-boxing the screen.
    console.warn(
      `uiColor: no Android answer for '${name}'. Add one to uiColors.js.`,
    );
    return undefined;
  }
  return PlatformColor(...paths);
}

/*
 * Apple's accent colours, for things that only need distinct colours, such as
 * the composer's action tiles (`accentColor(action.tint)` in Composer.js). iOS
 * uses the dynamic system colour; Android uses Apple's light-mode value in
 * both modes, so the hue matches. Material 3 has no equivalent set of colours.
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
 * @param name a key of `ACCENTS`, e.g. `systemIndigo`.
 */
export function accentColor(name) {
  const literal = ACCENTS[name];
  if (literal == null) {
    console.warn(`accentColor: '${name}' is not one of the accents.`);
    return undefined;
  }
  return Platform.OS === 'ios' ? PlatformColor(name) : literal;
}
