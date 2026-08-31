/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {
  RNTesterModule,
  RNTesterModuleExample,
  RNTesterModuleInfo,
} from '../../types/RNTesterTypes';

import {Screens, getExamplesListWithRecentlyUsed} from '../testerStateUtils';

// Every case here passes its own `testList`, so the real one is only ever a
// side effect: requiring it loads all ~108 example modules, and the ones that
// register an element warn on a second import — which this preset makes fatal.
// The call is hoisted above the imports, so mocking still happens first.
jest.mock('../RNTesterList', () => ({
  Components: [],
  APIs: [],
  Playgrounds: [],
  Modules: {},
}));

/*
 * The demos this fork adds are grouped into named sections above the stock
 * alphabetical list. Two things are easy to get wrong and neither shows up as
 * a crash: an example can be dropped on the way into a section, and a section
 * can end up below the list it is meant to sit above.
 */
const moduleFor = (title: string): RNTesterModule => ({
  title,
  description: title,
  examples: [] as Array<RNTesterModuleExample>,
});

const example = (
  key: string,
  title: string,
  group?: string,
): RNTesterModuleInfo => ({
  key,
  module: moduleFor(title),
  ...(group != null ? {group} : {}),
});

const COMPONENTS: Array<RNTesterModuleInfo> = [
  example('zebra', 'Zebra'),
  example('alpha', 'Alpha'),
  example('grid', 'Grid', 'CSS Layout'),
  example('block', 'Block', 'CSS Layout'),
  example('anchor', 'Anchor', 'HTML Elements'),
];

const listFor = (components: Array<RNTesterModuleInfo>) => {
  const list = getExamplesListWithRecentlyUsed({
    recentlyUsed: {components: [], apis: []},
    testList: {components, apis: []},
  });
  if (list == null) {
    throw new Error('no examples list was built');
  }
  return list[Screens.COMPONENTS];
};

describe('example sections', () => {
  it('puts each grouped example under its own section', () => {
    const sections = listFor(COMPONENTS);
    const byTitle = Object.fromEntries(
      sections.map(section => [
        section.title,
        section.data.map(entry => entry.key),
      ]),
    );
    expect(byTitle['CSS Layout']).toEqual(['grid', 'block']);
    expect(byTitle['HTML Elements']).toEqual(['anchor']);
  });

  it('orders sections ahead of the stock list, and by declared order', () => {
    const titles = listFor(COMPONENTS).map(section => section.title);
    expect(titles.indexOf('HTML Elements')).toBeLessThan(
      titles.indexOf('CSS Layout'),
    );
    expect(titles.indexOf('CSS Layout')).toBeLessThan(
      titles.indexOf('Components'),
    );
  });

  it('leaves ungrouped examples in the stock list, alphabetically', () => {
    const stock = listFor(COMPONENTS).find(
      section => section.title === 'Components',
    );
    expect(stock?.data.map(entry => entry.key)).toEqual(['alpha', 'zebra']);
  });

  it('shows every example exactly once across all sections', () => {
    const seen = listFor(COMPONENTS).flatMap(section =>
      section.data.map(entry => entry.key),
    );
    expect(seen.sort()).toEqual(
      COMPONENTS.map(entry => entry.key).sort(),
    );
  });

  it('keeps a group that is not in the declared order rather than dropping it', () => {
    const sections = listFor([...COMPONENTS, example('x', 'X', 'Unlisted')]);
    const unlisted = sections.find(section => section.title === 'Unlisted');
    expect(unlisted?.data.map(entry => entry.key)).toEqual(['x']);
  });
});
