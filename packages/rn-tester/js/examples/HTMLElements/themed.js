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
 * The demo screens' chrome colours, named from the platform so the screens
 * follow light and dark; an author hex colour would win over the user-agent
 * sheet's theming. The demonstration colours (the purple `<span>`, the red
 * `<em>`) stay literal, since they are the subject of their cases.
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

// Hairlines. Android takes a literal: `?android:attr/listDivider` and
// `dividerHorizontal` are drawables, not colours, and resolving one as a colour
// throws
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

// The grouped page a platform list's card contrasts against, as in Settings;
// only cases that draw a platform list need it
export const GROUPED_PAGE_COLOR: mixed = pick(
  'systemGroupedBackground',
  '?android:attr/colorBackground',
);
