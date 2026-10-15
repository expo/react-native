/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import * as React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

let mockMounts = 0;
let mockPathname = '/';
jest.mock(
  'expo-modules-core',
  () => ({requireNativeViewManager: () => 'SplitPolicy'}),
  {virtual: true},
);
jest.mock('../src/TemplateSidebar', () => () => 'Sidebar');
jest.mock(
  'react-native-screens/experimental',
  () => ({Split: {Host: 'SplitHost', Column: 'SplitColumn'}}),
  {virtual: true},
);
jest.mock(
  'expo-router',
  () => {
    const NativeReact = require('react');
    const theme = {
      colors: {background: 'white', border: 'gray', card: 'white'},
    };
    return {
      DefaultTheme: theme,
      DarkTheme: theme,
      ThemeProvider: ({children}) => children,
      usePathname: () => mockPathname,
      Slot: () => {
        NativeReact.useEffect(() => {
          mockMounts++;
        }, []);
        const {useHorizontalSizeClass} = require('../src/sizeClass');
        return NativeReact.createElement('Detail', {
          sizeClass: useHorizontalSizeClass(),
        });
      },
    };
  },
  {virtual: true},
);
jest.mock('react-native', () => ({
  Platform: {OS: 'ios'},
  View: 'View',
  StyleSheet: {create: value => value, absoluteFill: {}, hairlineWidth: 1},
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({width: 1000, height: 800}),
}));

it('keeps both native columns and the detail mounted through native collapse and expansion', () => {
  const RootLayout = require('../app/_layout').default;
  let root;
  act(() => {
    root = TestRenderer.create(<RootLayout />);
  });
  const emit = (horizontalSizeClass, sidebarShown) =>
    act(() => {
      root.root
        .findByType('SplitPolicy')
        .props.onModeChange({nativeEvent: {horizontalSizeClass, sidebarShown}});
    });
  for (const [sizeClass, tiled] of [
    ['regular', false],
    ['regular', true],
    ['compact', false],
  ]) {
    emit(sizeClass, tiled);
    expect(root.root.findAllByType('SplitColumn')).toHaveLength(2);
    expect(root.root.findByType('Detail').props.sizeClass).toBe(sizeClass);
    expect(root.root.findByType('SplitHost').props.topColumnForCollapsing).toBe(
      'secondary',
    );
    expect(root.root.findByType('SplitHost').props.preferredDisplayMode).toBe(
      'secondaryOnly',
    );
  }
  // Native display-mode callbacks update the sidebar without changing traits.
  act(() => {
    root.root.findByType('SplitHost').props.onDisplayModeWillChange({
      nativeEvent: {nextDisplayMode: 'oneBesideSecondary'},
    });
  });
  expect(root.root.findByType('Detail').props.sizeClass).toBe('compact');
  expect(mockMounts).toBe(1);
  mockPathname = '/template/blank';
  act(() => root.update(<RootLayout />));
  expect(mockMounts).toBe(1);
  act(() => root.unmount());
});
