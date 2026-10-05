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
 * List containers that know when they are nested: html.css's `ul ul, ol ul,
 * ul ol, ol ol { margin-block: 0 }` needs a descendant selector the sheet
 * does not have, so depth travels by context and the reset merges below the
 * author's style.
 */

const ListDepthContext: React.Context<number> = createContext(0);

// Only the block margins; the indent is the list's own padding. The marker
// sequence is computed natively from nesting depth (`nestedBulletForDepth`)
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
