/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';

/**
 * `<q>`'s marks are `q::before { content: open-quote }` in a browser; with no
 * generated content here they are real text children, which renders the same
 * and differs in the tree (`textContent` would count them). `open-quote` means
 * the pair at the current nesting depth of CSS's default
 * `quotes: "\201C" "\201D" "\2018" "\2019"`, so depth travels by context.
 */

/*
 * The pairs, in the order CSS's `quotes` lists them. Deeper nesting than there
 * are pairs re-uses the last, which is what browsers do rather than running out.
 */
const QUOTE_PAIRS: ReadonlyArray<[string, string]> = [
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
];

const QuoteDepthContext: React.Context<number> = React.createContext<number>(0);

type QuoteProps = {
  children?: React.Node,
  ...
};

function Quote({children, ...rest}: QuoteProps): React.Node {
  const depth = React.useContext(QuoteDepthContext);
  const [open, close] = QUOTE_PAIRS[Math.min(depth, QUOTE_PAIRS.length - 1)];

  return (
    <QuoteDepthContext.Provider value={depth + 1}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-q {...rest} nodeName="q">
        {open}
        {children}
        {close}
      </element-q>
    </QuoteDepthContext.Provider>
  );
}

export default Quote;
