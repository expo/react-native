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
 * from `expo`: `requireNativeView`, `requireNativeModule`, `installOnUIRuntime`,
 * `SharedObject`, `useReleasingSharedObject` and
 * `useReleasingSharedObjectWithLifecycle`.
 *
 * All of them are defined in expo-modules-core, which *is* linked here, and the
 * `expo` package does nothing but re-export them. The single wrinkle is the
 * first one: `requireNativeView` is not a distinct function, it is
 * `requireNativeViewManager` under another name. SDK 58's `expo/src/Expo.ts`
 * spells this exactly the way it is spelled below:
 *
 *     requireNativeViewManager as requireNativeView,
 *
 * so this file reproduces that package's behaviour rather than approximating
 * it. That rename is the whole reason a shim is needed instead of pointing
 * `expo` straight at expo-modules-core: the core exports only the old name,
 * and `@expo/ui` calls the new one, so the import would resolve to `undefined`
 * and fail at the call site with "undefined is not a function".
 */

export * from 'expo-modules-core';
export {requireNativeViewManager as requireNativeView} from 'expo-modules-core';
