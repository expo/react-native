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

type Origin = 'framework' | 'library';

type Entry = {
  origin: Origin,
  namespace: string | null,
  makeViewConfig: () => ViewConfig,
};

const entries: Map<string, Entry> = new Map();

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
