/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {Platform, useWindowDimensions} from 'react-native';

export type HorizontalSizeClass = 'compact' | 'regular';

/**
 * UIKit's horizontal size class for the window, as near as it can be read
 * from the window's size (the trait collection itself is not exposed to
 * JavaScript): an iPad's window is regular unless multitasking has narrowed
 * it to a third of the screen, a phone's only in landscape at the sizes
 * whose short side is 414pt or more (the Plus and Max classes, and an
 * unfolded iPhone Duo), and every portrait phone is compact. Anything that
 * is not iOS answers by width alone.
 */
export function useHorizontalSizeClass(): HorizontalSizeClass {
  const {width, height} = useWindowDimensions();
  if (Platform.OS !== 'ios' || Platform.isPad) {
    return width >= 600 ? 'regular' : 'compact';
  }
  return width > height && Math.min(width, height) >= 414
    ? 'regular'
    : 'compact';
}
