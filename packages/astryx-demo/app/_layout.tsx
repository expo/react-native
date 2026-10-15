/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {useHorizontalSizeClass} from '../src/sizeClass';
import TemplateSidebar from '../src/TemplateSidebar';
import {DarkTheme, DefaultTheme, Slot, ThemeProvider} from 'expo-router';
import * as React from 'react';
import {StyleSheet, View, useColorScheme} from 'react-native';

/**
 * The app follows UIKit's horizontal size class (src/sizeClass.js). Compact
 * — a phone, an iPad in a narrow multitasking window — is the stack alone:
 * the grid under a large title, a template pushed over it, with peek and
 * pop. Regular — an iPad, a phone in landscape at the Plus and Max sizes, an
 * unfolded iPhone Duo in landscape — is two panes: the template list in a
 * sidebar, the stack beside it, so a template designed for a desktop width,
 * such as File Explorer, gets one.
 *
 * The panes are plain views rather than Expo Router's SplitView
 * (UISplitViewController through React Native Screens' experimental Split
 * host): with react-native-screens 4.30 on iOS 27 the split's main column is
 * laid out at the window's width, so a template centred itself on the window
 * and ran under the sidebar. The view hierarchy showed the column's
 * UINavigationController view at the full width while the controller reported
 * `oneBesideSecondary` and `tile`; the Podfile needs `RNS_GAMMA_ENABLED=1` for
 * the split components to exist at all. Worth another look at the next
 * react-native-screens.
 *
 * The navigation theme follows the appearance, so the header and its
 * background are dark when the templates are.
 */
export default function RootLayout(): React.Node {
  const scheme = useColorScheme();
  const sizeClass = useHorizontalSizeClass();
  // The system's own white and black behind the stack, not the navigation
  // theme's greys: the grid and a template's surface sit on it
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
  if (sizeClass === 'compact') {
    return (
      <ThemeProvider value={theme}>
        <Slot />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider value={theme}>
      <View style={styles.panes}>
        <View
          style={[
            styles.sidebar,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
          ]}>
          <TemplateSidebar />
        </View>
        <View style={styles.main}>
          <Slot />
        </View>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  panes: {flex: 1, flexDirection: 'row'},
  sidebar: {width: 300, borderRightWidth: StyleSheet.hairlineWidth},
  main: {flex: 1},
});
