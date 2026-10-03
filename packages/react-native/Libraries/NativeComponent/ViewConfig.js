/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {
  PartialViewConfig,
  ViewConfig,
} from '../Renderer/shims/ReactNativeTypes';

import PlatformBaseViewConfig from './PlatformBaseViewConfig';

/**
 * Creates a complete `ViewConfig` from a `PartialViewConfig`.
 */
export function createViewConfig(
  partialViewConfig: PartialViewConfig,
): ViewConfig {
  return {
    uiViewClassName: partialViewConfig.uiViewClassName,
    Commands: {},
    bubblingEventTypes: composeIndexers(
      PlatformBaseViewConfig.bubblingEventTypes,
      partialViewConfig.bubblingEventTypes,
    ),
    directEventTypes: composeIndexers(
      PlatformBaseViewConfig.directEventTypes,
      partialViewConfig.directEventTypes,
    ),
    // $FlowFixMe[incompatible-type]
    validAttributes: composeIndexers(
      // $FlowFixMe[incompatible-call] `style` property confuses Flow.
      PlatformBaseViewConfig.validAttributes,
      // $FlowFixMe[incompatible-call] `style` property confuses Flow.
      partialViewConfig.validAttributes,
    ),
    // This function rebuilds the config from a fixed set of keys rather than
    // spreading, so anything not listed here is silently dropped. Opt-in flags
    // have to be carried through explicitly.
    recordNodeName: partialViewConfig.recordNodeName,
    resolveUIViewClassName: partialViewConfig.resolveUIViewClassName,
    uaStyle: partialViewConfig.uaStyle,
  };
}

function composeIndexers<T>(
  maybeA: ?{readonly [string]: T},
  maybeB: ?{readonly [string]: T},
): {readonly [string]: T} {
  return maybeA == null || maybeB == null
    ? (maybeA ?? maybeB ?? {})
    : {...maybeA, ...maybeB};
}
