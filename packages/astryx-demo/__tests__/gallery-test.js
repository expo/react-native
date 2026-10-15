/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {galleryPreviewSize} from '../src/galleryLayout';
import {WindowLayoutProvider, useWindowLayout} from '../src/sizeClass';
import * as React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

let mockTileMounts = 0;
jest.mock('../../rn-tester/js/astryx/overlay/TopLayerElement', () => ({
  PageViewportContext: require('react').createContext({
    width: 1100,
    height: 800,
  }),
}));
jest.mock(
  '../src/AppPage',
  () =>
    ({children}) =>
      children,
);
jest.mock(
  '../src/AstryxHost',
  () =>
    ({children}) =>
      children,
);
jest.mock('../src/templates', () => ({
  templates: [
    {slug: 'blank', name: 'Blank', category: 'Shell'},
    {slug: 'centered-hero', name: 'Centered Hero', category: 'Hero'},
  ],
  modifications: [],
}));
jest.mock('../src/thumbnails', () => ({}));
jest.mock(
  '@astryxdesign/core/Card',
  () => {
    const NativeReact = require('react');
    return {
      Card: ({children}) => {
        NativeReact.useEffect(() => {
          mockTileMounts++;
        }, []);
        return NativeReact.createElement('Tile', null, children);
      },
    };
  },
  {virtual: true},
);
jest.mock('@astryxdesign/core/Grid', () => ({Grid: 'Grid'}), {virtual: true});
jest.mock('@astryxdesign/core/Layout', () => ({VStack: 'VStack'}), {
  virtual: true,
});
jest.mock('@astryxdesign/core/Text', () => ({Text: 'Text'}), {virtual: true});
jest.mock('@astryxdesign/core/EmptyState', () => ({EmptyState: 'EmptyState'}), {
  virtual: true,
});
jest.mock(
  'expo-router',
  () => {
    const Link = ({children}) => children;
    Link.Trigger = ({children}) => children;
    Link.Preview = () => null;
    return {Link};
  },
  {virtual: true},
);
jest.mock('react-native', () => ({
  useWindowDimensions: () => ({width: 1100, height: 800}),
  useColorScheme: () => 'light',
}));

it('launches into the gallery and retains its tiles while native panes change', () => {
  const Home = require('../app/(main)/index').default;
  let onModeChange;
  function Screen() {
    onModeChange = useWindowLayout().onModeChange;
    return <Home />;
  }
  let root;
  act(() => {
    root = TestRenderer.create(
      <WindowLayoutProvider>
        <Screen />
      </WindowLayoutProvider>,
    );
  });
  expect(root.root.findAllByType('Tile')).toHaveLength(2);
  expect(root.root.findAllByType('EmptyState')).toHaveLength(0);
  const preview = root.root.findAllByType(
    require('expo-router').Link.Preview,
  )[0];
  expect(preview.props.style.height).toBeGreaterThan(preview.props.style.width);
  for (const sidebarShown of [false, true, false]) {
    act(() =>
      onModeChange({
        nativeEvent: {horizontalSizeClass: 'regular', sidebarShown},
      }),
    );
    expect(root.root.findAllByType('Tile')).toHaveLength(2);
    expect(root.root.findAllByType('EmptyState')).toHaveLength(0);
  }
  expect(mockTileMounts).toBe(2);
  act(() =>
    onModeChange({
      nativeEvent: {
        horizontalSizeClass: 'regular',
        galleryFold: true,
        divisionStart: 550,
        divisionWidth: 24,
      },
    }),
  );
  expect(
    root.root.findByType('Grid').props.style.gridTemplateColumns,
  ).toBeDefined();
  expect(root.root.findAllByType('Tile')).toHaveLength(2);
  act(() =>
    onModeChange({
      nativeEvent: {horizontalSizeClass: 'regular', galleryFold: false},
    }),
  );
  expect(root.root.findByType('Grid').props.style).toBeUndefined();
  expect(mockTileMounts).toBe(2);
  act(() => root.unmount());
});

it.each([
  [466, 678],
  [669, 951],
  [951, 669],
  [1100, 800],
  [1376, 1032],
])(
  'keeps the %sx%s peek portrait-shaped and within its available height',
  (width, height) => {
    const peek = galleryPreviewSize(width, height);
    expect(peek.width).toBeLessThanOrEqual(width - 32);
    expect(peek.height).toBeLessThanOrEqual(Math.round(height * 0.8));
    expect(peek.width / peek.height).toBeCloseTo(3 / 4, 2);
    expect(peek.height).toBeGreaterThan(peek.width);
  },
);
