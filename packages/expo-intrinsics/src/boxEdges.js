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
 * Keeps the user-agent sheet from outranking an author who reset a box.
 *
 * The two layers are merged by KEY — the renderer hands the element
 * `[uaStyle, authorStyle]` and React Native flattens them — and that IS the
 * cascade for as long as both layers spell an edge the same way. When they do
 * not, the result inverts: Yoga resolves `paddingInlineStart` ahead of
 * `padding` whatever order they were merged in, because a more specific EDGE
 * wins there regardless of which layer stated it.
 *
 * So `<ol>`'s user-agent `paddingInlineStart: 40` survived an author's
 * `padding: 0`, and the reset every ported design system writes — Tailwind's
 * preflight, Astryx's vendored Stepper, shadcn's — did nothing. On the web
 * `padding: 0` cancels `padding-inline-start` outright: it is a shorthand, it
 * sets all four longhands, and it came later.
 *
 * The fix is to make the merge behave like the cascade before Yoga ever sees
 * it: any user-agent declaration whose edges the author has ENTIRELY claimed
 * is dropped, so only the author's spelling reaches the node. A partial claim
 * is left alone — an author's `paddingLeft` must not silently cancel the
 * sheet's `paddingBlock`.
 */

type Edge = 'blockStart' | 'blockEnd' | 'inlineStart' | 'inlineEnd' | 'left' | 'right';

const BLOCK_AXIS: ReadonlyArray<Edge> = ['blockStart', 'blockEnd'];
// `left`/`right` and `inlineStart`/`inlineEnd` are different edges until a
// direction is resolved, and this runs before that — so a claim on one is not
// a claim on the other, and both are tracked.
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

const BOX_FAMILIES: ReadonlyArray<Map<string, ReadonlyArray<Edge>>> = [
  edgesForBox('padding'),
  edgesForBox('margin'),
];

/** Whether any key in the style names a box edge, so the walk is worth doing. */
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

/**
 * `uaStyle`, with every box declaration the author has entirely claimed
 * removed. Returns `uaStyle` itself when there is nothing to mask, which is
 * the overwhelmingly common case and allocates nothing.
 */
export function withoutOutrankedBoxEdges(
  uaStyle: {[string]: unknown},
  authorStyle: unknown,
): {[string]: unknown} {
  if (authorStyle == null || !statesABox(uaStyle)) {
    return uaStyle;
  }

  // The author's style is whatever React Native accepts: an object, an array,
  // nested arrays, or holes. Collect the keys it states without flattening
  // values, which is all this needs and much cheaper.
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
      // A key spread in without ever being stated is not a declaration, and
      // dropping the layer beneath it would let nothing through at all.
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
      // Entirely claimed, or nothing happens: a `paddingLeft` from the author
      // does not cancel the sheet's `paddingBlock`, only the parts of it the
      // author actually replaced — and those the key merge already handles.
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
