/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import type {ElementDescriptor, InteractionStates} from '../css/match';

import {
  installStylesheet,
  resetStylesheets,
  resolveCssForElement,
} from '../css';

/**
 * `order` from a stylesheet reaches the renderer as a number, which the
 * renderer lays flex and grid items out by. Login Split moves its photo above
 * its form this way, in a container query.
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
  return resolveCssForElement(element, NO_INTERACTION).style ?? {};
}

describe('order through the CSS layer', () => {
  afterEach(() => {
    resetStylesheets();
  });

  it('is a number, negative included', () => {
    expect(styleFor('.i { order: -1; }', ['i'])).toEqual({order: -1});
    expect(styleFor('.i { order: 2; }', ['i'])).toEqual({order: 2});
  });
});
