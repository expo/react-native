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
 * The framework owns the bare tag names and the unknown-element fallback; a
 * library defines elements under its own namespace and cannot produce a bare
 * tag, because defineReactElement joins the namespace and name itself.
 * Collisions are only possible inside one namespace, where they throw.
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

// The reconciler's registry allows each name once
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

// Returns the full `namespace:name` tag
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
