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
 * The exact html.css margin rule: a nested list zeroes only its block
 * margins — the indent is its own padding and stays. The MARKER half of
 * nesting (disc → circle → square) deliberately does not live here: the
 * layout engine computes it natively from real nesting depth
 * (`nestedBulletForDepth` in YogaLayoutableShadowNode::prepareListContext),
 * and a second copy in JavaScript would be a divergence waiting to happen —
 * it briefly was one, masking that `<menu>` was not recognised as a list
 * container at all.
 */
const NESTED_LIST_MARGIN_RESET = {marginBlockStart: 0, marginBlockEnd: 0};

type ListProps = {
  children?: React.Node,
  style?: unknown,
  /** `<ol start>` — where the counter begins (HTML §4.4.5). */
  start?: ?number,
  ...
};

/**
 * Builds the component for one list tag. The host element is registered
 * separately under `element-ul`/`element-ol`/`element-menu` with the tag's
 * user-agent style; this states the DOM name and the nesting.
 */
export function makeList(tag: string): React.ComponentType<ListProps> {
  const Host: $FlowFixMe = `element-${tag}`;

  function List({style, start, ...rest}: ListProps): React.Node {
    const depth = useContext(ListDepthContext);
    return (
      <ListDepthContext.Provider value={depth + 1}>
        <Host
          {...rest}
          nodeName={tag}
          // The HTML attribute under a private native name: `start` is ALSO
          // Yoga's inline-start inset, and forwarding it verbatim shifted the
          // whole list `start` pixels while it seeded the counter.
          listStart={start}
          style={depth > 0 ? [NESTED_LIST_MARGIN_RESET, style] : style}
        />
      </ListDepthContext.Provider>
    );
  }
  List.displayName = `<${tag}>`;
  return List;
}

export const LIST_TAGS: Array<string> = ['ul', 'ol', 'menu'];
