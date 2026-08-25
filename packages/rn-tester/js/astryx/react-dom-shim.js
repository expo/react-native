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
 * What `react-dom` means here, which is: not react-dom.
 *
 * Astryx 0.5.0's `Layer/useLayer` imports `createPortal` to mount a layer into
 * a portal target when it has one. react-dom is banned in this repository —
 * the whole point of the exercise is that these components run on the
 * renderer, not on the web — so Metro resolves the specifier here instead, the
 * same way it already resolves `@stylexjs/stylex` to the runtime in
 * `stylex-rn.js`. The vendored sources stay UNMODIFIED, which is what keeps
 * "upgrade" a copy rather than a merge.
 *
 * The branch that calls this is unreachable under React Native, and that is a
 * fact about the source rather than a hope: `portalTarget` is typed
 * `HTMLElement | null` and resolved from `sentinelRef.current?.parentElement`
 * and `view.getComputedStyle`. None of those exist on a host instance here, so
 * it resolves to null and `useLayer` renders the layer inline. The import
 * still has to resolve for the module to load, which is the only reason this
 * file exists.
 *
 * It is written to be correct rather than merely present, because "unreachable
 * today" is a property of today's source.
 */

/**
 * Render `children` where they are.
 *
 * A portal's contract is "render this subtree into that container", and there
 * is no container here to render into: React Native has no DOM and no
 * `createPortal` for host components. The honest answer for a null target is
 * therefore the children themselves — which is exactly what `useLayer` does on
 * the other side of its own null check.
 *
 * A NON-null target means a code path this shim has not modelled, so it says
 * so once rather than pretending. The overlay machinery that actually escapes
 * its parent on this platform is `overlay/TopLayer.js`: a root-mounted host
 * with an ordered registry, light dismissal and a modal backdrop, which is the
 * mechanism a layer should be reaching for here.
 */
let warnedAboutTarget = false;

export function createPortal(children: unknown, container: unknown): unknown {
  if (__DEV__ && container != null && !warnedAboutTarget) {
    warnedAboutTarget = true;
    console.warn(
      'astryx: createPortal was called with a target, which this platform ' +
        'has no equivalent for — the subtree is rendered in place instead. ' +
        'Use overlay/TopLayer.js to escape an ancestor on React Native.',
    );
  }
  return children;
}

export default {createPortal};
