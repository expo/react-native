/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * Drops the user-agent box declarations an author has entirely reset. The two
 * layers merge by key, and Yoga resolves a more specific edge such as
 * `paddingInlineStart` ahead of `padding` whatever order they were merged in,
 * so a sheet's `paddingInlineStart: 40` would survive an author's `padding: 0`.
 * On the web the shorthand cancels the longhand outright. A partial claim is
 * left alone: an author's `paddingLeft` must not cancel the sheet's
 * `paddingBlock`.
 */

type Edge =
  | 'blockStart'
  | 'blockEnd'
  | 'inlineStart'
  | 'inlineEnd'
  | 'left'
  | 'right'
  // A physical corner and a flow-relative one stay apart until a direction is
  // resolved
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'topStart'
  | 'topEnd'
  | 'bottomStart'
  | 'bottomEnd'
  | 'startStart'
  | 'startEnd'
  | 'endStart'
  | 'endEnd';

const BLOCK_AXIS: ReadonlyArray<Edge> = ['blockStart', 'blockEnd'];
// This runs before a direction is resolved, so `left` and `inlineStart` are
// different edges and a claim on one is not a claim on the other
const INLINE_AXIS: ReadonlyArray<Edge> = [
  'inlineStart',
  'inlineEnd',
  'left',
  'right',
];

function edgesForBox(prefix: string): Map<string, ReadonlyArray<Edge>> {
  return new Map<string, ReadonlyArray<Edge>>([
    [prefix, [...BLOCK_AXIS, ...INLINE_AXIS]],
    [`${prefix}Vertical`, BLOCK_AXIS],
    [`${prefix}Block`, BLOCK_AXIS],
    [`${prefix}Horizontal`, INLINE_AXIS],
    [`${prefix}Inline`, INLINE_AXIS],
    [`${prefix}Top`, ['blockStart']],
    [`${prefix}BlockStart`, ['blockStart']],
    [`${prefix}Bottom`, ['blockEnd']],
    [`${prefix}BlockEnd`, ['blockEnd']],
    [`${prefix}Left`, ['left']],
    [`${prefix}Right`, ['right']],
    [`${prefix}Start`, ['inlineStart']],
    [`${prefix}InlineStart`, ['inlineStart']],
    [`${prefix}End`, ['inlineEnd']],
    [`${prefix}InlineEnd`, ['inlineEnd']],
  ]);
}

// The `border` shorthand is absent: it spans three of these families, and
// removing a sheet's `border` for an author's width would drop its colour too
function edgesForBorder(suffix: string): Map<string, ReadonlyArray<Edge>> {
  const all = [...BLOCK_AXIS, ...INLINE_AXIS];
  return new Map<string, ReadonlyArray<Edge>>([
    [`border${suffix}`, all],
    [`borderBlock${suffix}`, BLOCK_AXIS],
    [`borderInline${suffix}`, INLINE_AXIS],
    [`borderTop${suffix}`, ['blockStart']],
    [`borderBlockStart${suffix}`, ['blockStart']],
    [`borderBottom${suffix}`, ['blockEnd']],
    [`borderBlockEnd${suffix}`, ['blockEnd']],
    [`borderLeft${suffix}`, ['left']],
    [`borderRight${suffix}`, ['right']],
    [`borderStart${suffix}`, ['inlineStart']],
    [`borderInlineStart${suffix}`, ['inlineStart']],
    [`borderEnd${suffix}`, ['inlineEnd']],
    [`borderInlineEnd${suffix}`, ['inlineEnd']],
  ]);
}

const RADIUS_CORNERS: Map<string, ReadonlyArray<Edge>> = new Map([
  [
    'borderRadius',
    [
      'topLeft',
      'topRight',
      'bottomLeft',
      'bottomRight',
      'topStart',
      'topEnd',
      'bottomStart',
      'bottomEnd',
      'startStart',
      'startEnd',
      'endStart',
      'endEnd',
    ],
  ],
  ['borderTopLeftRadius', ['topLeft']],
  ['borderTopRightRadius', ['topRight']],
  ['borderBottomLeftRadius', ['bottomLeft']],
  ['borderBottomRightRadius', ['bottomRight']],
  ['borderTopStartRadius', ['topStart']],
  ['borderTopEndRadius', ['topEnd']],
  ['borderBottomStartRadius', ['bottomStart']],
  ['borderBottomEndRadius', ['bottomEnd']],
  ['borderStartStartRadius', ['startStart']],
  ['borderStartEndRadius', ['startEnd']],
  ['borderEndStartRadius', ['endStart']],
  ['borderEndEndRadius', ['endEnd']],
]);

const BOX_FAMILIES: ReadonlyArray<Map<string, ReadonlyArray<Edge>>> = [
  edgesForBox('padding'),
  edgesForBox('margin'),
  edgesForBorder('Width'),
  edgesForBorder('Color'),
  edgesForBorder('Style'),
  RADIUS_CORNERS,
];

function statesABox(style: {[string]: unknown}): boolean {
  for (const key of Object.keys(style)) {
    for (const family of BOX_FAMILIES) {
      if (family.has(key)) {
        return true;
      }
    }
  }
  return false;
}

// Returns `uaStyle` itself when there is nothing to mask, allocating nothing
export function withoutOutrankedBoxEdges(
  uaStyle: {[string]: unknown},
  authorStyle: unknown,
): {[string]: unknown} {
  if (authorStyle == null || !statesABox(uaStyle)) {
    return uaStyle;
  }

  // Collect the stated keys without flattening values; the style may be an
  // object, an array, nested arrays or holes
  const claimedKeys = new Set<string>();
  const collect = (value: unknown): void => {
    if (value == null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        collect(entry);
      }
      return;
    }
    for (const key of Object.keys(value)) {
      // An undefined value is not a declaration
      if ((value as $FlowFixMe)[key] !== undefined) {
        claimedKeys.add(key);
      }
    }
  };
  collect(authorStyle);
  if (claimedKeys.size === 0) {
    return uaStyle;
  }

  let masked: {[string]: unknown} | null = null;
  for (const family of BOX_FAMILIES) {
    const claimed = new Set<Edge>();
    for (const key of claimedKeys) {
      const edges = family.get(key);
      if (edges != null) {
        for (const edge of edges) {
          claimed.add(edge);
        }
      }
    }
    if (claimed.size === 0) {
      continue;
    }
    for (const key of Object.keys(uaStyle)) {
      const edges = family.get(key);
      if (edges == null) {
        continue;
      }
      // Only an entirely claimed declaration is dropped; the key merge already
      // handles the parts the author replaced
      if (edges.every(edge => claimed.has(edge))) {
        if (masked == null) {
          masked = {...uaStyle};
        }
        delete masked[key];
      }
    }
  }
  return masked ?? uaStyle;
}
