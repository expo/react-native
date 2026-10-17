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

import type {RNTesterModuleExample} from '../../types/RNTesterTypes';

import {installStylesheet} from '../../astryx/css';
import resetCss from '../../astryx/vendor/reset.css';
import * as React from 'react';

/*
 * Astryx's reset, which an Astryx app imports for its whole document, scoped
 * to the surfaces the Astryx examples render in: RNTester's other screens
 * style HTML elements with the same engine, and keep the user agent's borders
 * and list markers that the reset takes away
 */
installStylesheet(`@scope ([data-astryx-surface]) {\n${resetCss}\n}`);

/** The element an Astryx example renders in, under Astryx's reset. */
export default function AstryxSurface({
  children,
}: {
  children: React.Node,
}): React.Node {
  return <div data-astryx-surface="">{children}</div>;
}

/** Examples that render in an Astryx surface. */
export function inAstryxSurface(
  examples: ReadonlyArray<RNTesterModuleExample>,
): Array<RNTesterModuleExample> {
  return examples.map(example => {
    const Example = example.render;
    return {
      ...example,
      render: (): React.Node => (
        <AstryxSurface>
          <Example />
        </AstryxSurface>
      ),
    };
  });
}
