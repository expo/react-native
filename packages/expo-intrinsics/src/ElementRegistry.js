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
 * Who registers what — the precedence rules, enforced by API shape.
 *
 *  - THE FRAMEWORK (e.g. Expo) owns the bare tag names: `button`, `img`, `p`.
 *    One framework per app; its catalog is the default vocabulary, and it also
 *    holds the unknown-element fallback.
 *  - A LIBRARY defines elements under its own namespace — `me:button`,
 *    `lexy:avatar` — and cannot produce a bare tag at all: defineReactElement
 *    takes a namespace and a name separately and joins them itself. Collisions
 *    are only possible inside one namespace, where they throw rather than pick
 *    a winner.
 *
 * (An app-level override tier is anticipated but deliberately not built yet.)
 */

import type {ViewConfig} from 'react-native/Libraries/Renderer/shims/ReactNativeTypes';

import createReactNativeComponentClass from 'react-native/Libraries/Renderer/shims/createReactNativeComponentClass';
import {setElementComponentResolver} from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

type Origin = 'framework' | 'library';

type Entry = {
  origin: Origin,
  namespace: string | null,
  makeViewConfig: () => ViewConfig,
};

const entries: Map<string, Entry> = new Map();

/**
 * Tags that are a JavaScript component rather than a native view.
 *
 * Most elements are a box the renderer mounts. A few are not: `<select>` has to
 * read its own `<option>` children and hand them to a control as a list, which
 * is a JavaScript job. Such a tag resolves to a component, and that component
 * renders whatever host element it actually needs.
 *
 * The reconciler asks this map what a tag is, through the seam next to the
 * view-config fallback — see `setElementComponentResolver`. Resolving there
 * rather than in a JSX transform is what makes it hold for every way an element
 * can be created, not only for JSX.
 */
const components: Map<string, unknown> = new Map();

setElementComponentResolver((tag: string) => components.get(tag) ?? null);

/** Tags pushed to the reconciler's registry, which allows each name once. */
const committed: Set<string> = new Set();

function commit(tag: string) {
  if (committed.has(tag)) {
    return;
  }
  committed.add(tag);
  createReactNativeComponentClass(tag, () => {
    const entry = entries.get(tag);
    if (entry == null) {
      throw new Error(`Element <${tag}> lost its registry entry.`);
    }
    return entry.makeViewConfig();
  });
}

/**
 * A bare tag from the framework's catalog. Throws on a duplicate: two
 * framework registrations of one tag is a catalog bug, not a precedence
 * question.
 */
export function registerFrameworkElement(
  tag: string,
  makeViewConfig: () => ViewConfig,
) {
  if (tag.includes(':')) {
    throw new Error(
      `The framework registers bare tags; <${tag}> looks namespaced. ` +
        'Use defineReactElement for namespaced elements.',
    );
  }
  if (entries.has(tag)) {
    throw new Error(`The framework registered <${tag}> twice.`);
  }
  entries.set(tag, {origin: 'framework', namespace: null, makeViewConfig});
  commit(tag);
}

/**
 * A framework tag backed by a JavaScript component instead of a native view.
 *
 * The component is an ordinary one: it receives the element's props and
 * children and renders whatever it needs, usually a host element registered
 * under a different name. `<select>` renders `element-select` after folding its
 * `<option>` children into a prop.
 *
 * Same precedence rule as `registerFrameworkElement`: one framework, and a
 * duplicate registration is a catalog bug rather than a question about who
 * wins.
 */
/*
 * One rule for every component registered here: do NOT read `props.key`.
 *
 * It looks like it should be destructured out, so that a rest-spread cannot
 * carry it into the host element. It cannot: React strips `key` before props
 * are built and leaves a non-enumerable accessor that *warns when read* —
 * "`key` is not a prop. Trying to access it will result in undefined being
 * returned." A spread never copies it, so pulling it out achieves nothing and
 * trips the warning the moment one of these elements appears in a list, which
 * for <img> and <option> is where they mostly appear.
 */
export function registerFrameworkComponent(tag: string, Component: unknown) {
  if (tag.includes(':')) {
    throw new Error(
      `The framework registers bare tags; <${tag}> looks namespaced. ` +
        'Use defineReactElement for namespaced elements.',
    );
  }
  if (entries.has(tag) || components.has(tag)) {
    throw new Error(`The framework registered <${tag}> twice.`);
  }
  components.set(tag, Component);
}

/**
 * Defines a library's element. The tag is always `namespace:name` — this API
 * joins them, so a library cannot define a bare tag no matter what it passes.
 * First definition in a namespace wins; a collision within one namespace
 * throws. Returns the full tag.
 */
export function defineReactElement(
  namespace: string,
  name: string,
  makeViewConfig: () => ViewConfig,
): string {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace) || namespace === 'rn') {
    throw new Error(
      `Invalid element namespace '${namespace}': lowercase, and 'rn' is reserved.`,
    );
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid element name '${name}'.`);
  }
  const tag = `${namespace}:${name}`;
  if (entries.has(tag)) {
    throw new Error(
      `<${tag}> is already registered. Two libraries sharing the ` +
        `'${namespace}' namespace must coordinate; the registry will not pick.`,
    );
  }
  entries.set(tag, {origin: 'library', namespace, makeViewConfig});
  commit(tag);
  return tag;
}
