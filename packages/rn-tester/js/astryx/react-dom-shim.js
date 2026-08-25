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
 * What `react-dom` resolves to here. Astryx's `Layer/useLayer` imports
 * `createPortal` to mount a layer into a portal target when it has one;
 * react-dom is not used in this repository, so Metro resolves the specifier
 * here, as it resolves `@stylexjs/stylex` to `stylex-rn.js`, and the vendored
 * sources stay unmodified. The branch that calls this is unreachable under
 * React Native: `portalTarget` comes from `parentElement` and
 * `getComputedStyle`, which no host instance has, so `useLayer` renders the
 * layer inline; the import still has to resolve for the module to load.
 */

/**
 * Renders `children` where they are: React Native has no DOM and no
 * `createPortal` for host components, so a null target gets the children
 * themselves, as `useLayer` does on its own side of the null check. A non-null
 * target is a path this shim has not modelled and says so; the mechanism that
 * escapes a parent on this platform is `overlay/TopLayer.js`.
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
