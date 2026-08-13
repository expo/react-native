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
 * Keeping a lower-priority layer from outranking a higher one when the two
 * spell the same box edge differently.
 *
 * Two style layers of KNOWN priority — a matched stylesheet rule under an
 * inline or stylex style — are merged into one flat object, and a flat object
 * resolves by KEY. That is the cascade only while both layers name an edge the
 * same way. When they do not, the merge keeps both, and Yoga then resolves them
 * by EDGE SPECIFICITY, which has nothing to do with which layer was more
 * authoritative:
 *
 *     button { padding: 0 }              →  paddingTop/Right/Bottom/Left: 0
 *     <button style={{paddingBlock: 12}}> →  paddingBlock: 12
 *
 * Both survive the merge, and `padding-top` is a more specific edge than the
 * vertical axis, so the STYLESHEET wins and the element has no padding. That is
 * a real reset colliding with real markup: shadcn's `globals.css` carries
 * Tailwind preflight's `button { padding: 0 }`, and every Astryx control that
 * states `paddingBlock`/`paddingInline` came out flush against its label.
 *
 * So the lower layer gives up the edges the higher layer has claimed, before
 * they are merged — which is what the cascade would have done, and what
 * `buttonUAStyle` already does by hand for the user-agent sheet.
 *
 * Only WHOLLY covered declarations are dropped. `padding: 0` under an author's
 * `paddingLeft: 4` keeps three sides of the reset and loses one, exactly as a
 * browser resolves it.
 *
 * Direction is handled by not assuming one. The tokens below separate the
 * physical inline edges (`left`/`right`) from the flow-relative ones
 * (`inlineStart`/`inlineEnd`), because which is which depends on a direction
 * this layer cannot see. A one-sided flow-relative declaration therefore never
 * masks a physical one — and it does not need to: Yoga already ranks
 * `Edge::Start` above `Edge::Left`, so the author's wins there on its own. What
 * this fixes is the case Yoga cannot, where the higher layer's spelling names a
 * whole AXIS and the lower one names an edge.
 */

type Edge =
  'blockStart' | 'blockEnd' | 'left' | 'right' | 'inlineStart' | 'inlineEnd';

const BLOCK_AXIS: ReadonlyArray<Edge> = ['blockStart', 'blockEnd'];
// A declaration naming the whole inline axis covers it under EITHER naming,
// which is what makes it safe to mask a physical edge with a logical spelling.
const INLINE_AXIS: ReadonlyArray<Edge> = [
  'left',
  'right',
  'inlineStart',
  'inlineEnd',
];

/**
 * Every spelling of one box property, and the edges it covers.
 *
 * `prefix` is the property name React Native uses for the whole box —
 * `padding` or `margin`. `inset` names its physical edges with no prefix at all
 * (`top`, `left`), which is why it is written out separately below rather than
 * built from this.
 */
function edgesForBox(prefix: string): Map<string, ReadonlyArray<Edge>> {
  return new Map([
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

const INSET_EDGES: Map<string, ReadonlyArray<Edge>> = new Map([
  ['inset', [...BLOCK_AXIS, ...INLINE_AXIS]],
  ['insetBlock', BLOCK_AXIS],
  ['insetInline', INLINE_AXIS],
  ['top', ['blockStart']],
  ['insetBlockStart', ['blockStart']],
  ['bottom', ['blockEnd']],
  ['insetBlockEnd', ['blockEnd']],
  ['left', ['left']],
  ['right', ['right']],
  ['start', ['inlineStart']],
  ['insetInlineStart', ['inlineStart']],
  ['end', ['inlineEnd']],
  ['insetInlineEnd', ['inlineEnd']],
]);

const BOX_FAMILIES: ReadonlyArray<Map<string, ReadonlyArray<Edge>>> = [
  edgesForBox('padding'),
  edgesForBox('margin'),
  INSET_EDGES,
];

/**
 * `lower`, with every box declaration the `higher` layer has entirely claimed
 * removed. Returns `lower` itself when there is nothing to mask, so the common
 * case — no stylesheet, or no box properties in either layer — allocates
 * nothing.
 */
export function withoutOutrankedBoxEdges(
  // Read-only dictionaries: this reads both layers and writes to neither, and
  // an invariant `{[string]: unknown}` cannot accept a concrete style object at
  // all — every caller's `{paddingTop: 0}` fails because `number` is not
  // exactly `unknown`.
  lower: {readonly [string]: unknown},
  higher: ?{readonly [string]: unknown},
): {readonly [string]: unknown} {
  if (higher == null) {
    return lower;
  }
  let masked: {[string]: unknown} | null = null;
  for (const family of BOX_FAMILIES) {
    const claimed = new Set<Edge>();
    for (const key of Object.keys(higher)) {
      const edges = family.get(key);
      // `undefined` is not a declaration: a style object built by spreading can
      // carry a key whose value was never stated, and dropping the layer below
      // it would let nothing through at all.
      if (edges != null && higher[key] !== undefined) {
        for (const edge of edges) {
          claimed.add(edge);
        }
      }
    }
    if (claimed.size === 0) {
      continue;
    }
    for (const key of Object.keys(lower)) {
      const edges = family.get(key);
      if (edges == null) {
        continue;
      }
      if (edges.every(edge => claimed.has(edge))) {
        if (masked == null) {
          masked = {...lower};
        }
        delete masked[key];
      }
    }
  }
  return masked ?? lower;
}
