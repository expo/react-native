/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {useHorizontalSizeClass} from '../../src/sizeClass';
import {Stack} from 'expo-router';
import * as React from 'react';

/**
 * The stack every screen lives in. In a compact width it is the whole app:
 * the grid under a large title, templates pushed on top. In a regular width
 * it is the split view's main column, with the template list in the sidebar
 * beside it (see app/_layout.tsx), so the grid screen stands in as the
 * column's empty state and keeps a plain title.
 */
export default function MainLayout(): React.Node {
  const sizeClass = useHorizontalSizeClass();
  return (
    // The back control is the chevron alone: the previous screen is always
    // the grid, and its title beside the chevron said so twice. The bar is
    // the platform's own (Liquid Glass on iOS 26 and later), which
    // react-native-screens gives only for `systemDefault`, a value the app's
    // patch of it adds; the content scrolls under the bar with the soft edge
    // its scroll views ask for.
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerTransparent: true,
        headerBlurEffect: 'systemDefault',
      }}>
      <Stack.Screen
        name="index"
        options={{title: 'Astryx', headerLargeTitle: sizeClass === 'compact'}}
      />
      <Stack.Screen name="modifications" options={{title: 'Modifications'}} />
      <Stack.Screen
        name="web/[slug]"
        options={{presentation: 'modal', headerTransparent: false}}
      />
    </Stack>
  );
}
