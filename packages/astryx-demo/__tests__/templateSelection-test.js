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

const mockRouter = {
  navigate: jest.fn(),
  replace: jest.fn(),
  setParams: jest.fn(),
};
let mockPathname = '/template/blank';
jest.mock(
  '../src/AstryxHost',
  () =>
    ({children}) =>
      children,
);
jest.mock('../../expo-intrinsics/src/NativePageScroll', () => ({
  __esModule: true,
  default: ({children}) => children,
  usePageViewport: () => [null, () => {}],
}));
jest.mock('../src/templates', () => ({
  templates: [
    {slug: 'blank', name: 'Blank', category: 'Shell'},
    {slug: 'centered-hero', name: 'Centered Hero', category: 'Hero'},
  ],
}));
jest.mock(
  '@astryxdesign/core/List',
  () => ({List: ({children}) => children, ListItem: 'ListItem'}),
  {virtual: true},
);
jest.mock(
  '@astryxdesign/core/Text',
  () => ({Heading: ({children}) => children}),
  {virtual: true},
);
jest.mock(
  '@astryxdesign/core/Layout',
  () => ({VStack: ({children}) => children}),
  {virtual: true},
);
jest.mock(
  'expo-router',
  () => ({
    useGlobalSearchParams: () => ({slug: 'blank'}),
    usePathname: () => mockPathname,
    useRouter: () => mockRouter,
  }),
  {virtual: true},
);

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/template/blank';
});

it('changes only the slug when selecting another demo in the current detail', () => {
  const Sidebar = require('../src/TemplateSidebar').default;
  let root;
  act(() => {
    root = TestRenderer.create(<Sidebar />);
  });
  act(() => root.root.findAllByType('ListItem')[1].props.onClick());
  expect(mockRouter.setParams).toHaveBeenCalledWith({slug: 'centered-hero'});
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  act(() => root.unmount());
});

it('leaves the selected demo untouched when tapped again', () => {
  const Sidebar = require('../src/TemplateSidebar').default;
  let root;
  act(() => {
    root = TestRenderer.create(<Sidebar />);
  });
  act(() => root.root.findAllByType('ListItem')[0].props.onClick());
  expect(mockRouter.setParams).not.toHaveBeenCalled();
  expect(mockRouter.navigate).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  act(() => root.unmount());
});

it('highlights the current route after switching demos, even with stale global parameters', () => {
  const Sidebar = require('../src/TemplateSidebar').default;
  let root;
  act(() => {
    root = TestRenderer.create(<Sidebar />);
  });
  expect(
    root.root.findAllByType('ListItem').map(item => item.props.isSelected),
  ).toEqual([true, false, false]);
  mockPathname = '/template/centered-hero';
  act(() => root.update(<Sidebar />));
  expect(
    root.root.findAllByType('ListItem').map(item => item.props.isSelected),
  ).toEqual([false, true, false]);
  expect(root.root.findAllByType('ListItem')[1].props['aria-current']).toBe(
    'page',
  );
  expect(root.root.findAllByType('ListItem')[1].props.style).toEqual({
    backgroundColor: 'var(--color-overlay-pressed)',
  });
  expect(root.root.findAllByType('ListItem')[0].props.style).toBeUndefined();
  expect(
    root.root.findAllByType('ListItem')[1].props.endContent,
  ).toBeUndefined();
  act(() => root.unmount());
});
