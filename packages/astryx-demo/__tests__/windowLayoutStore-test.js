/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {
  WindowLayoutProvider,
  useGalleryDivision,
  useHorizontalSizeClass,
  useSidebarState,
  useWindowLayoutActions,
} from '../src/sizeClass';
import * as React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

test('a report re-renders only the components whose part of it changed', () => {
  const renders = {sizeClass: 0, sidebar: 0, division: 0};
  let actions;
  let division;
  function Actions() {
    actions = useWindowLayoutActions();
    return null;
  }
  function SizeClass() {
    renders.sizeClass++;
    useHorizontalSizeClass();
    return null;
  }
  function Sidebar() {
    renders.sidebar++;
    useSidebarState();
    return null;
  }
  function Division() {
    renders.division++;
    division = useGalleryDivision();
    return null;
  }
  act(() => {
    TestRenderer.create(
      <WindowLayoutProvider>
        <Actions />
        <SizeClass />
        <Sidebar />
        <Division />
      </WindowLayoutProvider>,
    );
  });
  const report = {
    horizontalSizeClass: 'regular',
    canToggleSidebar: true,
    sidebarShown: false,
    galleryFold: false,
    divisionStart: 0,
    divisionWidth: 0,
  };
  act(() => actions.onModeChange({nativeEvent: report}));
  const before = {...renders};

  // A fold: the hinge appears, and nothing else changes
  act(() =>
    actions.onModeChange({
      nativeEvent: {
        ...report,
        galleryFold: true,
        divisionStart: 455.5,
        divisionWidth: 40,
      },
    }),
  );
  expect(division).toEqual({x: 455.5, width: 40});
  expect(renders).toEqual({...before, division: before.division + 1});

  // The same report again re-renders nothing
  act(() =>
    actions.onModeChange({
      nativeEvent: {
        ...report,
        galleryFold: true,
        divisionStart: 455.5,
        divisionWidth: 40,
      },
    }),
  );
  expect(renders).toEqual({...before, division: before.division + 1});
});
