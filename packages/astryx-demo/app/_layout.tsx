/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {WindowLayoutProvider} from '../src/sizeClass';
import TemplateSidebar from '../src/TemplateSidebar';
import TemplatePanes from '../src/TemplatePanes';
import {DarkTheme, DefaultTheme, Slot, ThemeProvider} from 'expo-router';
import * as React from 'react';
import {useColorScheme} from 'react-native';

/** Keep the native stack mounted while the catalog and detail adapt to a fold. */
export default function RootLayout(): React.Node {
  return (
    <WindowLayoutProvider>
      <AppLayout />
    </WindowLayoutProvider>
  );
}

function AppLayout(): React.Node {
  const scheme = useColorScheme();
  // Match the system canvas behind the gallery and template surfaces.
  const theme = React.useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: scheme === 'dark' ? '#000000' : '#ffffff',
      },
    };
  }, [scheme]);
  return (
    <ThemeProvider value={theme}>
      <TemplatePanes
        sidebar={<TemplateSidebar />}
        backgroundColor={theme.colors.card}>
        <Slot />
      </TemplatePanes>
    </ThemeProvider>
  );
}
