/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * Stands in for the `expo` package (see metro.config.js).
 *
 * The tester deliberately does not depend on `expo` itself — the Podfile
 * excludes it, because it drags in Expo's AppDelegate/factory pod, which does
 * not compile against this fork's slimmed delegate API. But `@expo/ui` imports
 * three symbols from `expo`: `requireNativeModule`, `installOnUIRuntime` and
 * `requireNativeView`.
 *
 * All three are defined in expo-modules-core, which *is* linked here, and the
 * `expo` package does nothing but re-export them. The single wrinkle is the
 * last one: `requireNativeView` is not a distinct function, it is
 * `requireNativeViewManager` under a newer name. SDK 57's `expo/src/Expo.ts`
 * spells this exactly the way it is spelled below:
 *
 *     requireNativeViewManager as requireNativeView,
 *
 * so this file reproduces that package's behaviour rather than approximating
 * it. That rename is the whole reason a shim is needed instead of pointing
 * `expo` straight at expo-modules-core: the linked core predates the new name,
 * and `@expo/ui` calls it, so the import resolved to `undefined` and failed at
 * the call site with "undefined is not a function".
 */

export * from 'expo-modules-core';
export {requireNativeViewManager as requireNativeView} from 'expo-modules-core';
