/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {
  ComponentList,
  ExamplesList,
  RNTesterModuleInfo,
  RNTesterNavigationState,
  SectionData,
} from '../types/RNTesterTypes';

import RNTesterList from './RNTesterList';

export const Screens = {
  COMPONENTS: 'components',
  APIS: 'apis',
  PLAYGROUNDS: 'playgrounds',
} as const;

export const initialNavigationState: RNTesterNavigationState = {
  activeModuleKey: null,
  activeModuleTitle: null,
  activeModuleExampleKey: null,
  screen: Screens.COMPONENTS,
  recentlyUsed: {components: [], apis: []},
  hadDeepLink: false,
};

const filterEmptySections = (examplesList: ExamplesList): any => {
  const filteredSections: {
    ['apis' | 'components']: Array<SectionData<RNTesterModuleInfo>>,
  } = {};
  const sectionKeys = Object.keys(examplesList);

  sectionKeys.forEach(key => {
    filteredSections[key] = examplesList[key].filter(
      section => section.data.length > 0,
    );
  });

  return filteredSections;
};

// Pinned examples lead the list (see RNTesterModuleInfo.pinned); the rest stay
// alphabetical. Array.prototype.sort is stable, so pinned entries keep the
// order they are declared in.
const byPinnedThenTitle = (
  a: RNTesterModuleInfo,
  b: RNTesterModuleInfo,
): number => {
  if (a.pinned !== b.pinned) {
    return a.pinned === true ? -1 : 1;
  }
  return a.module.title.localeCompare(b.module.title);
};

export const getExamplesListWithRecentlyUsed = ({
  recentlyUsed,
  testList,
}: {
  recentlyUsed: ComponentList,
  testList?: {
    components?: Array<RNTesterModuleInfo>,
    apis?: Array<RNTesterModuleInfo>,
  },
}): ExamplesList | null => {
  // Return early if state has not been initialized from storage
  if (!recentlyUsed) {
    return null;
  }

  const componentList = testList?.components ?? RNTesterList.Components;
  const components = componentList.map(
    (componentExample): RNTesterModuleInfo => ({
      ...componentExample,
      exampleType: Screens.COMPONENTS,
    }),
  );

  const recentlyUsedComponents = recentlyUsed.components
    .map(recentComponentKey =>
      components.find(component => component.key === recentComponentKey),
    )
    .filter(Boolean);

  const apisList = testList?.apis ?? RNTesterList.APIs;
  const apis = apisList.map((apiExample): RNTesterModuleInfo => ({
    ...apiExample,
    exampleType: Screens.APIS,
  }));

  const recentlyUsedAPIs = recentlyUsed.apis
    .map(recentAPIKey =>
      apis.find(apiExample => apiExample.key === recentAPIKey),
    )
    .filter(Boolean);

  const examplesList: ExamplesList = {
    [Screens.COMPONENTS]: [
      {
        key: 'RECENT_COMPONENTS',
        data: recentlyUsedComponents,
        title: 'Recently Viewed',
      },
      {
        key: 'COMPONENTS',
        data: components.sort(byPinnedThenTitle),
        title: 'Components',
      },
    ],
    [Screens.APIS]: [
      {
        key: 'RECENT_APIS',
        data: recentlyUsedAPIs,
        title: 'Recently viewed',
      },
      {
        key: 'APIS',
        data: apis.sort(byPinnedThenTitle),
        title: 'APIs',
      },
    ],
  };

  return filterEmptySections(examplesList);
};
