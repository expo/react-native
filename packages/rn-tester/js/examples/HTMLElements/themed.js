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
 * The demo screens' own chrome colours, named from the platform.
 *
 * These screens hardcoded light-mode hex — `color: '#1c1c1e'` for body text and
 * greys for the labels — so in dark mode the prose was black on black and the
 * elements looked like they were not rendering at all. That is an **author**
 * colour, so it wins over anything the user-agent stylesheet does: no amount of
 * theming underneath could have saved it, and it looked exactly like an engine
 * bug from a screenshot.
 *
 * Naming the platform's own colours instead means the demos follow light and
 * dark the way a native app does — which matters more here than on an ordinary
 * screen, because these are what someone judges the elements by.
 *
 * ## What is deliberately NOT in here
 *
 * The *demonstration* colours — the purple `<span>`, the red `<em>`, the
 * highlight yellow. Those are the subject of the demo rather than its chrome: a
 * case showing that an author's colour reaches an inline element has to use a
 * literal colour, and swapping it for a semantic one would quietly change what
 * the case is demonstrating.
 */

import {Platform, PlatformColor} from 'react-native';

const pick = (ios: string, android: string) =>
  Platform.select({
    ios: PlatformColor(ios),
    android: PlatformColor(android),
    default: undefined,
  });

// Body text. The one that made whole screens look empty in dark mode.
export const LABEL_COLOR: mixed = pick(
  'label',
  '?android:attr/textColorPrimary',
);

// Captions and the small print under a case title.
export const SECONDARY_COLOR: mixed = pick(
  'secondaryLabel',
  '?android:attr/textColorSecondary',
);

// The quietest text on the screen — element names, hints.
export const TERTIARY_COLOR: mixed = pick(
  'tertiaryLabel',
  '?android:attr/textColorTertiary',
);

/*
 * Hairlines and rules.
 *
 * Android takes a literal, not a theme attribute. The obvious spelling —
 * `?android:attr/listDivider` — is a **drawable**, not a colour: it is the
 * nine-patch a ListView draws between rows, and asking the platform to resolve
 * it as a colour fails with *"None of the paths in the `resource_paths` array
 * resolved to a color resource"* and takes the whole screen down with a red
 * error box. There is no framework-level *colour* attribute for a divider
 * (`dividerHorizontal` is a drawable too), so the honest answer on Android is
 * the same translucent hairline the user-agent sheet already uses for `<hr>`
 * and `<fieldset>` rather than a theme attribute that happens to parse.
 */
export const SEPARATOR_COLOR: mixed = Platform.select({
  ios: PlatformColor('separator'),
  android: '#0000001f',
  default: '#0000001f',
});

// The card a case sits on.
export const CARD_COLOR: mixed = pick(
  'secondarySystemBackground',
  '?android:attr/colorBackgroundFloating',
);

/*
 * The page a GROUPED LIST needs behind it.
 *
 * iOS makes a grouped card legible by putting it on a grouped page, not by
 * drawing an edge around it — Settings is the whole argument. The card itself is
 * `secondarySystemGroupedBackground`, which is white in light mode; so is the
 * white block a demo sits on, and a white card on a white block shows its rows
 * and separators with nothing around them.
 *
 * This is the other half of that pair, and it is the page's colour rather than
 * the card's. Only cases that draw a platform list need it.
 */
export const GROUPED_PAGE_COLOR: mixed = pick(
  'systemGroupedBackground',
  '?android:attr/colorBackground',
);
