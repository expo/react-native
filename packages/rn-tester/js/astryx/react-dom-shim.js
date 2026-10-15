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
 * `createPortal` for host components, so the children come back as they are,
 * which is what `useLayer` renders on its own side of the null check.
 *
 * Since Astryx 0.7.0 the target is not always null: `Layer/layerHost.ts`
 * walks `parentElement` and `tagName`, both of which this platform's
 * elements have, and asks for a portal above the outermost `<p>`, `<a>`,
 * `<button>` or other host that must not contain a layer.
 * DOM-CSS-LIMITATION(layer-portal-stays-inline): that move does not happen;
 * the layer stays where the sentinel is. On the web the move prevents the
 * HTML parser's reparenting and a wrapping control capturing the layer's
 * interactions; here there is no parser, and a layer inside a control keeps
 * its own hit-testing, so the visible cost is typography inherited from an
 * inline formatting ancestor. The mechanism that escapes an ancestor on this
 * platform is `overlay/TopLayer.js`.
 */
export function createPortal(children: unknown, container: unknown): unknown {
  return children;
}

/**
 * What `react-dom/client` resolves to. Astryx's `Toast/useToast` imports
 * `createRoot` to mount its toaster into a DOM container; there is no DOM
 * container here, so the branch is unreachable, and a call that reaches it
 * anyway gets a root that renders nothing and says so once.
 */
let warnedAboutRoot = false;

export function createRoot(container: unknown): {
  render(children: unknown): void,
  unmount(): void,
} {
  if (__DEV__ && !warnedAboutRoot) {
    warnedAboutRoot = true;
    console.warn(
      'astryx: createRoot was called, which this platform has no equivalent ' +
        'for — nothing is rendered into the container. Use overlay/TopLayer.js ' +
        'to mount above the app on React Native.',
    );
  }
  return {render() {}, unmount() {}};
}

export default {createPortal, createRoot};
