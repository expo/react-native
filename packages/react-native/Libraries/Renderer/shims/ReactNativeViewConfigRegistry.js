/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noformat
 * @nolint
 * @flow strict-local
 * @generated SignedSource<<260b8a01781c54c31a520f00cb1bde7f>>
 */

'use strict';

import {type ViewConfig} from './ReactNativeTypes';
import invariant from 'invariant';

// Event configs
export const customBubblingEventTypes: {
  [eventName: string]: Readonly<{
    phasedRegistrationNames: Readonly<{
      captured: string,
      bubbled: string,
      skipBubbling?: ?boolean,
    }>,
  }>,
} = {};
export const customDirectEventTypes: {
  [eventName: string]: Readonly<{
    registrationName: string,
  }>,
} = {};

const viewConfigCallbacks = new Map<string, ?() => ViewConfig>();
const viewConfigs = new Map<string, ViewConfig>();

function processEventTypes(viewConfig: ViewConfig): void {
  const {bubblingEventTypes, directEventTypes} = viewConfig;

  if (__DEV__) {
    if (bubblingEventTypes != null && directEventTypes != null) {
      for (const topLevelType in directEventTypes) {
        invariant(
          bubblingEventTypes[topLevelType] == null,
          'Event cannot be both direct and bubbling: %s',
          topLevelType,
        );
      }
    }
  }

  if (bubblingEventTypes != null) {
    for (const topLevelType in bubblingEventTypes) {
      if (customBubblingEventTypes[topLevelType] == null) {
        customBubblingEventTypes[topLevelType] =
          bubblingEventTypes[topLevelType];
      }
    }
  }

  if (directEventTypes != null) {
    for (const topLevelType in directEventTypes) {
      if (customDirectEventTypes[topLevelType] == null) {
        customDirectEventTypes[topLevelType] = directEventTypes[topLevelType];
      }
    }
  }
}

/**
 * Registers a native view/component by name.
 * A callback is provided to load the view config from UIManager.
 * The callback is deferred until the view is actually rendered.
 */
export function register(name: string, callback: () => ViewConfig): string {
  invariant(
    !viewConfigCallbacks.has(name),
    'Tried to register two views with the same name %s',
    name,
  );
  invariant(
    typeof callback === 'function',
    'View config getter callback for component `%s` must be a function (received `%s`)',
    name,
    /* $FlowFixMe[invalid-compare] Error discovered during Constant Condition
     * roll out. See https://fburl.com/workplace/5whu3i34. */
    callback === null ? 'null' : typeof callback,
  );
  viewConfigCallbacks.set(name, callback);
  return name;
}

/**
 * Retrieves a config for the specified view.
 * If this is the first time the view has been used,
 * This configuration will be lazy-loaded from UIManager.
 */
let fallbackViewConfigResolver: ?(name: string) => ?ViewConfig = null;

/**
 * Installs a resolver consulted by `get` when a component name has no registered
 * view config. This is the generic seam an intrinsic-component module (e.g.
 * expo-intrinsics) uses to resolve tags core does not know about — most notably
 * the HTMLUnknownElement fallback for unregistered lowercase tags. Core stays
 * agnostic: it neither names nor knows any intrinsic element, it only offers the
 * hook. Returning `null` from the resolver means "not handled" and falls through
 * to the usual invariant.
 */
export function setFallbackViewConfigResolver(
  resolver: (name: string) => ?ViewConfig,
): void {
  fallbackViewConfigResolver = resolver;
}

/**
 * Installs a resolver consulted by the reconciler when it is about to treat a
 * tag as a host component. Returning a component means "this tag is that
 * component"; returning `null` means "not handled" and the tag stays a host
 * component as before.
 *
 * The sibling of `setFallbackViewConfigResolver`, and for the same reason: some
 * elements are not a native view at all. `<select>` is the clear case — its
 * `<option>` children are a *list handed to a control*, not boxes to lay out,
 * so the element has to read its own children and pass them down as a prop.
 * That is a JavaScript job, and it needs the tag to resolve to a component.
 *
 * This belongs in the reconciler rather than in a JSX transform. A JSX shim
 * would decide an element's identity at *creation*, which means the answer
 * depends on how the element was made — `React.createElement('select')`,
 * `cloneElement`, or a tree built by something other than the JSX runtime would
 * all miss it. The reconciler sees every path. It is also where this project
 * already resolves what a tag means, next to the view-config fallback.
 *
 * Core stays agnostic, as with the fallback resolver: it neither names nor
 * knows any element, it only offers the hook.
 */
let elementComponentResolver: ?(name: string) => unknown = null;

export function setElementComponentResolver(
  resolver: (name: string) => unknown,
): void {
  elementComponentResolver = resolver;
}

export function getElementComponent(name: string): unknown {
  return elementComponentResolver == null ? null : elementComponentResolver(name);
}

export function get(name: string): ViewConfig {
  let viewConfig = viewConfigs.get(name);
  if (viewConfig == null) {
    const callback = viewConfigCallbacks.get(name);
    if (typeof callback !== 'function') {
      const fallbackViewConfig = fallbackViewConfigResolver?.(name);
      if (fallbackViewConfig != null) {
        return fallbackViewConfig;
      }
      invariant(
        false,
        'View config getter callback for component `%s` must be a function (received `%s`).%s',
        name,
        callback === null ? 'null' : typeof callback,
        // $FlowFixMe[recursive-definition]
        typeof name[0] === 'string' && /[a-z]/.test(name[0])
          ? ' Make sure to start component names with a capital letter.'
          : '',
      );
    }
    viewConfig = callback();
    invariant(viewConfig, 'View config not found for component `%s`', name);

    processEventTypes(viewConfig);
    viewConfigs.set(name, viewConfig);

    // Clear the callback after the config is set so that
    // we don't mask any errors during registration.
    viewConfigCallbacks.set(name, null);
  }
  return viewConfig;
}
