/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import {parseStylesheet} from '../parse';
// The `.css` import IS the raw text (cssFileTransformer in jest, the Metro
// css-transformer in the app) — this pins the loader contract the demo
// screens and the shadcn pipeline rely on.
// $FlowFixMe[cannot-resolve-module] .css resolves via the jest transform
import fixtureCss from './__fixtures__/fixture.css';

test('a .css import is its text, and parses', () => {
  expect(typeof fixtureCss).toBe('string');
  expect(fixtureCss).toContain('--fixture-pad');
  const sheet = parseStylesheet(fixtureCss);
  expect(sheet.rules).toHaveLength(2);
  expect(sheet.rules[1].declarations.padding).toBe('var(--fixture-pad)');
});
