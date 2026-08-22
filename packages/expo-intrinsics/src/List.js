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
import {createContext, useContext} from 'react';

/**
 * `<ul>`, `<ol>` and `<menu>` — list containers that know when they are
 * NESTED, which is the one thing a per-tag stylesheet row cannot know.
 *
 * Every browser's user-agent sheet zeroes the block margins of a list inside
 * a list — html.css spells it `ul ul, ol ul, ul ol, ol ol { margin-block:
 * 0 }` — because the outer list's rhythm already separates the group, and a
 * nested list with its own 1em margins floats away from the item that
 * introduces it. Our sheet has no descendant selectors; these are components
 * so the nesting can travel the way everything contextual travels in React: a
 * context. The provider is unconditional (a list inside a list inside a list
 * is still nested), and the reset is merged BELOW the author's style, so an
 * author who wants the browser-defying margins back can simply state them.
 */

const ListDepthContext: React.Context<number> = createContext(0);

/*
 * The exact html.css nesting rules: a nested list zeroes only its block
 * margins (the indent is its own padding and stays), and an unordered
 * marker walks the browser ladder — disc, then circle, then square — so a
 * second-level bullet reads as second-level. `<ol>` keeps its numbering at
 * every depth, exactly as browsers do.
 */
const NESTED_LIST_MARGIN_RESET = {marginBlockStart: 0, marginBlockEnd: 0};
const UNORDERED_MARKER_BY_DEPTH = ['disc', 'circle', 'square'];

type ListProps = {
  children?: React.Node,
  style?: unknown,
  ...
};

/**
 * Builds the component for one list tag. The host element is registered
 * separately under `element-ul`/`element-ol`/`element-menu` with the tag's
 * user-agent style; this states the DOM name and the nesting.
 */
export function makeList(tag: string): React.ComponentType<ListProps> {
  const Host: $FlowFixMe = `element-${tag}`;

  function List({style, ...rest}: ListProps): React.Node {
    const depth = useContext(ListDepthContext);
    const nestedDefaults =
      depth > 0
        ? [
            NESTED_LIST_MARGIN_RESET,
            tag === 'ol'
              ? null
              : {
                  listStyleType:
                    UNORDERED_MARKER_BY_DEPTH[
                      Math.min(depth, UNORDERED_MARKER_BY_DEPTH.length - 1)
                    ],
                },
          ]
        : null;
    return (
      <ListDepthContext.Provider value={depth + 1}>
        <Host
          {...rest}
          nodeName={tag}
          style={nestedDefaults != null ? [...nestedDefaults, style] : style}
        />
      </ListDepthContext.Provider>
    );
  }
  List.displayName = `<${tag}>`;
  return List;
}

export const LIST_TAGS: Array<string> = ['ul', 'ol', 'menu'];
