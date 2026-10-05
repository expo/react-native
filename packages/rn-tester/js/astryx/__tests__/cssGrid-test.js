/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ElementDescriptor, InteractionStates} from '../css/match';

import {
  installStylesheet,
  resetStylesheets,
  resolveCssForElement,
} from '../css';

/**
 * `display: grid` through the CSS layer: the renderer implements css-grid-2
 * natively and `stylex.props()` passes the grid longhands through, so this
 * layer must pass `display: grid` through too rather than rewrite it to flex,
 * which would leave track lists on a box that is not a grid.
 */
const NO_INTERACTION: InteractionStates = {
  hovered: false,
  pressed: false,
  focused: false,
  focusVisible: false,
  disabled: false,
};

function styleFor(css: string, classes: Array<string>): {[string]: unknown} {
  resetStylesheets();
  installStylesheet(css);
  const element: ElementDescriptor = {
    tag: 'div',
    classes,
    attributes: {},
    states: NO_INTERACTION,
    parent: null,
  };
  // `style` is null when nothing matched; every case here matches
  return resolveCssForElement(element, NO_INTERACTION).style ?? {};
}

describe('display: grid through the CSS layer', () => {
  afterEach(() => {
    resetStylesheets();
  });

  it('stays a grid, with its track lists', () => {
    const style = styleFor(
      '.g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }',
      ['g'],
    );
    expect(style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
    });
    // No invented `flexDirection` standing in for a grid's row auto-flow
    expect(style.flexDirection).toBeUndefined();
  });

  it('leaves an author flex-direction alone on a real flex box', () => {
    const style = styleFor('.f { display: flex; flex-direction: row; }', ['f']);
    expect(style).toMatchObject({display: 'flex', flexDirection: 'row'});
  });
});
