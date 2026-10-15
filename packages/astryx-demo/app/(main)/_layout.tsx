/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {useHorizontalSizeClass, useSidebarItems} from '../../src/sizeClass';
import {Stack} from 'expo-router';
import * as React from 'react';

export const unstable_settings = {initialRouteName: 'index'};

/** Keep the gallery and detail stack mounted across sidebar and fold transitions. */
export default function MainLayout(): React.Node {
  const sizeClass = useHorizontalSizeClass();
  const sidebarItems = useSidebarItems();
  return (
    // Use a chevron-only back button and the native glass navigation bar.
    // The Screens patch adds the systemDefault material; scroll views provide
    // the soft edge beneath it.
    <Stack
      screenOptions={{
        unstable_headerRightItems: () => sidebarItems,
        headerBackButtonDisplayMode: 'minimal',
        headerTransparent: true,
        headerBlurEffect: 'systemDefault',
      }}>
      <Stack.Screen
        name="index"
        options={{title: 'Astryx', headerLargeTitle: sizeClass === 'compact'}}
      />
      <Stack.Screen
        name="template/[slug]"
        dangerouslySingular={() => 'template'}
      />
      <Stack.Screen name="modifications" options={{title: 'Modifications'}} />
      <Stack.Screen
        name="web/[slug]"
        options={{presentation: 'modal', headerTransparent: false}}
      />
    </Stack>
  );
}
