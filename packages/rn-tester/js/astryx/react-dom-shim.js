/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ElementRecord} from './elementRegistry';

import {recordOf} from './elementRegistry';
import * as React from 'react';
// $FlowFixMe[untyped-import] React's JSX runtime ships no types
import {jsx as reactJsx} from 'react/jsx-runtime';

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
 * Moves `children` into `container` when the container is an element the
 * renderer's style engine draws (its record has an outlet): the element draws
 * them after its own children, where a portal's go in the DOM. That is how
 * Astryx's Stepper puts the current step's label in the row under a collapsed
 * track. React Native has no `createPortal` for host components, so this is a
 * component's, and the moved content reads the React context of the element
 * it lands in rather than of the place it was declared.
 *
 * Anything else comes back where it is: a container that is no such element
 * (a node created imperatively), and content the top layer draws (a popover,
 * a dialog), which needs its context and is lifted out anyway.
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
export function createPortal(
  children: unknown,
  container: unknown,
  key?: ?string,
): unknown {
  const setPortals = recordOf(container)?.setPortals;
  if (setPortals == null || drawnInTheTopLayer(children)) {
    return children;
  }
  return reactJsx(
    PortalSource,
    {setPortals, children: children as $FlowFixMe},
    key ?? undefined,
  );
}

/**
 * Whether a portal's content is a popover or a dialog, which the top layer
 * draws above the page wherever it sits in the tree: it stays where it is,
 * so the React context it reads keeps flowing to it (Astryx's layers find
 * their depth and their dismissal through context)
 */
function drawnInTheTopLayer(children: unknown): boolean {
  if (!React.isValidElement(children)) {
    return false;
  }
  const element = children as $FlowFixMe;
  const popover = element.props?.popover;
  return (popover != null && popover !== false) || element.type === 'dialog';
}

/**
 * Hands its children to the container's element, which draws them after its
 * own (a portal's place in the DOM), and takes them back when it unmounts.
 * It renders nothing where it is.
 */
function PortalSource({
  setPortals,
  children,
}: {
  setPortals: NonNullable<ElementRecord['setPortals']>,
  children?: React.Node,
}): React.Node {
  const id = React.useId();
  React.useLayoutEffect(() => {
    setPortals(previous => {
      const next = new Map(previous ?? []);
      next.set(id, children);
      return next;
    });
  }, [setPortals, id, children]);
  React.useLayoutEffect(
    () => () => {
      setPortals(previous => {
        if (previous == null || !previous.has(id)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    },
    [setPortals, id],
  );
  return null;
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
