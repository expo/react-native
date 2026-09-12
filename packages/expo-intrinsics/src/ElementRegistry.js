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
 * Precedence by API shape: the framework owns the bare tag names and the
 * unknown-element fallback; a library defines `namespace:name` elements and
 * cannot produce a bare tag, since `defineReactElement` joins the two itself.
 * A collision within a namespace throws.
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

// Tags that are a JavaScript component rather than a native view. The
// reconciler asks through `setElementComponentResolver`, so it holds for every
// way an element can be created, not only JSX
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
 * A framework tag backed by a component, which renders the host element it
 * needs under a different name. A duplicate throws, as in
 * `registerFrameworkElement`. Components must not read `props.key`: React
 * leaves a non-enumerable accessor that warns when read, and a spread never
 * copies it.
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
 * Defines a library's element backed by a React component, which an element
 * needs when its job is to give an existing component better defaults rather
 * than mount a new native view (`<native:scroll>`). Same namespace rules as
 * `defineReactElement`, and the same refusal to pick a winner when two
 * libraries collide.
 */
export function defineReactComponent(
  namespace: string,
  name: string,
  Component: unknown,
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
  if (entries.has(tag) || components.has(tag)) {
    throw new Error(
      `<${tag}> is already registered. Two libraries sharing the ` +
        `'${namespace}' namespace must coordinate; the registry will not pick.`,
    );
  }
  components.set(tag, Component);
  return tag;
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
