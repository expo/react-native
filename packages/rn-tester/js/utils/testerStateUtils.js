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

const byTitle = (a: RNTesterModuleInfo, b: RNTesterModuleInfo): number =>
  a.module.title.localeCompare(b.module.title);

/*
 * The order the fork's own sections appear in, above the stock list. A group
 * named here but empty on this platform is dropped by `filterEmptySections`,
 * and a group an example names but this list forgets would silently vanish —
 * so anything grouped but unlisted is appended rather than lost.
 */
const GROUP_ORDER = [
  'HTML Elements',
  'Text Children',
  'CSS Layout',
  'CSS Styling',
  'Design Systems',
  'Native UI',
  'Benchmarks',
];

const groupedSections = (
  examples: Array<RNTesterModuleInfo>,
): Array<SectionData<RNTesterModuleInfo>> => {
  const byGroup = new Map<string, Array<RNTesterModuleInfo>>();
  for (const example of examples) {
    const group = example.group;
    if (group == null) {
      continue;
    }
    const bucket = byGroup.get(group);
    if (bucket == null) {
      byGroup.set(group, [example]);
    } else {
      bucket.push(example);
    }
  }
  const ordered = [
    ...GROUP_ORDER.filter(group => byGroup.has(group)),
    ...[...byGroup.keys()].filter(group => !GROUP_ORDER.includes(group)),
  ];
  return ordered.map(group => ({
    key: 'GROUP_' + group.toUpperCase().replace(/ /g, '_'),
    data: byGroup.get(group) ?? [],
    title: group,
  }));
};

const ungrouped = (
  examples: Array<RNTesterModuleInfo>,
): Array<RNTesterModuleInfo> => examples.filter(example => example.group == null);

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
      ...groupedSections(components),
      {
        key: 'COMPONENTS',
        data: ungrouped(components).sort(byTitle),
        title: 'Components',
      },
    ],
    [Screens.APIS]: [
      {
        key: 'RECENT_APIS',
        data: recentlyUsedAPIs,
        title: 'Recently viewed',
      },
      ...groupedSections(apis),
      {
        key: 'APIS',
        data: ungrouped(apis).sort(byTitle),
        title: 'APIs',
      },
    ],
  };

  return filterEmptySections(examplesList);
};
