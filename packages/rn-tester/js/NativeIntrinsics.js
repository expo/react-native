/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * Proof: an *external* module (this file lives in the app, not in react-native
 * core) registers `<native-*>` intrinsics that map to EXISTING RN components —
 * with no new C++, no ComponentDescriptor, and no ShadowNode.
 *
 * How it works: Fabric passes `viewConfig.uiViewClassName` (not the JSX element
 * type string) to `createNode`. So registering the name "native-switch" with an
 * existing native component's view config makes `<native-switch>` mount that
 * component. The "native-switch" string is only a JS registry key the native
 * side never sees.
 *
 * Hyphenated lowercase tags are plain JSX (dashes are valid in JSX
 * identifiers), so unlike the earlier namespaced `<native:switch>` spelling —
 * which needed `throwIfNamespace: false` in the babel preset and a Metro
 * source-map fix — this needs NO babel/Metro changes at all.
 */

import type {HostComponent} from 'react-native';

// The native switch host component. Importing it registers its view config;
// the reference itself is what we alias (no magic string).
//
// The platforms ship *different* native components — iOS's `Switch` and
// Android's `AndroidSwitch` — so the alias must pick per platform. Aliasing
// the iOS one unconditionally throws "Can't find ViewManager 'Switch'" on
// Android, which is exactly what emulator verification caught.
import {Platform} from 'react-native';
import SwitchNativeComponent from 'react-native/Libraries/Components/Switch/SwitchNativeComponent';
import * as ReactNativeViewConfigRegistry from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';
import AndroidSwitchNativeComponent from 'react-native/src/private/components/switch/specs/AndroidSwitchNativeComponent';

/**
 * Map an intrinsic name to an existing RN native component, passed by
 * reference. `<${intrinsicName}>` mounts `target`'s native view.
 *
 * RN host components ARE their registered name string (createReactNativeComponentClass
 * / NativeComponentRegistry.get return the name), so aliasing = reusing the
 * target's view config from the registry. Passing the imported reference (rather
 * than a bare name) guarantees the target module is loaded and its config
 * registered, and is refactor-safe.
 */
export function registerIntrinsic<TConfig extends {...}>(
  intrinsicName: string,
  target: HostComponent<TConfig>,
): void {
  if (typeof target !== 'string') {
    throw new Error(
      `registerIntrinsic("${intrinsicName}", …): expected a native host ` +
        `component (import it from its *NativeComponent spec), got ${typeof target}. ` +
        `Composite JS components can't be aliased by view config.`,
    );
  }
  // RN host components ARE their registered name string at runtime (the type
  // is opaque about it, hence the guard above).
  const targetName: string = target;
  ReactNativeViewConfigRegistry.register(intrinsicName, () =>
    ReactNativeViewConfigRegistry.get(targetName),
  );
}

// The proof: <native-switch> renders the platform's real native switch —
// a UISwitch on iOS, a SwitchCompat on Android. Registered per platform
// rather than through a union so each call keeps its own prop shape (Android
// adds `enabled`/`on`/`trackTintColor`).
if (Platform.OS === 'android') {
  registerIntrinsic('native-switch', AndroidSwitchNativeComponent);
} else {
  registerIntrinsic('native-switch', SwitchNativeComponent);
}
