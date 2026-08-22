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
 * `<q>` — an inline quotation, with the marks a browser would generate.
 *
 * In CSS the marks are not content. They come from the user-agent sheet as
 * `q::before { content: open-quote }` and `q::after { content: close-quote }`,
 * drawing from the `quotes` property. There is no `content` property here and no
 * generated-content box to hang it on, so the marks are produced as real text
 * children instead.
 *
 * That substitution is honest about one thing and wrong about another, and both
 * are worth stating. It is right about *rendering*: the marks inherit the
 * element's font and colour, wrap with the sentence, and sit inside the
 * quotation exactly as `::before` and `::after` would. It is wrong about the
 * *tree*: a browser's generated content is not in the DOM, so `textContent` on a
 * `<q>` excludes the marks, while here they are ordinary children and would be
 * counted. Nothing in the DOM APIs this package exposes reads that yet, and the
 * alternative — no quotation marks at all — is a visible bug on every quotation.
 *
 * ## Nesting
 *
 * The reason this needs a component rather than two string literals is that the
 * marks *alternate*. CSS's default is
 *
 *     quotes: "\201C" "\201D" "\2018" "\2019"
 *
 * — curly doubles at the outer level, curly singles inside them — and `open-quote`
 * means "the pair at the current nesting depth", not "a double quote". A quotation
 * inside a quotation takes the second pair, which is typographically the whole
 * point and is why English writes ‘a quote “inside” a quote’ this way.
 *
 * Depth is tracked through context because that is what nesting is: a `<q>` has
 * no way to know how many `<q>` elements it is inside except by being told.
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
