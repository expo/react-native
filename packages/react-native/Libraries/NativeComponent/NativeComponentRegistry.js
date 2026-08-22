/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {HostComponent} from '../../src/private/types/HostComponent';
import type {
  PartialViewConfig,
  ViewConfig,
} from '../Renderer/shims/ReactNativeTypes';

import getNativeComponentAttributes from '../ReactNative/getNativeComponentAttributes';
import UIManager from '../ReactNative/UIManager';
import * as ReactNativeViewConfigRegistry from '../Renderer/shims/ReactNativeViewConfigRegistry';
import * as StaticViewConfigValidator from './StaticViewConfigValidator';
import {createViewConfig} from './ViewConfig';
import invariant from 'invariant';
import * as React from 'react';

let getRuntimeConfig;

/**
 * Configures a function that is called to determine whether a given component
 * should be registered using reflection of the native component at runtime.
 *
 * The provider should return null if the native component is unavailable in
 * the current environment.
 */
export function setRuntimeConfigProvider(
  runtimeConfigProvider: (name: string) => ?{
    native: boolean,
    verify: boolean,
  },
): void {
  if (getRuntimeConfig === undefined) {
    getRuntimeConfig = runtimeConfigProvider;
  }
}

/**
 * Gets a `NativeComponent` that can be rendered by React Native.
 *
 * The supplied `viewConfigProvider` may or may not be invoked and utilized,
 * depending on how `setRuntimeConfigProvider` is configured.
 */
export function get<Config extends {...}>(
  name: string,
  viewConfigProvider: () => PartialViewConfig,
): HostComponent<Config> {
  ReactNativeViewConfigRegistry.register(name, () => {
    const {native, verify} = getRuntimeConfig?.(name) ?? {
      native: !global.RN$Bridgeless,
      verify: false,
    };

    let viewConfig: ViewConfig;
    if (native) {
      viewConfig =
        getNativeComponentAttributes(name) ??
        createViewConfig(viewConfigProvider());
    } else {
      viewConfig =
        createViewConfig(viewConfigProvider()) ??
        getNativeComponentAttributes(name);
    }

    invariant(
      viewConfig != null,
      'NativeComponentRegistry.get: both static and native view config are missing for native component "%s".',
      name,
    );

    if (verify) {
      /*
       * Verification compares the static view config with the native one. When
       * native view configs are not obtainable at all — the new architecture
       * with the legacy ViewConfig interop layer off — there is nothing to
       * compare against, for any component.
       *
       * Asking anyway produced one soft error per component resolved, which is
       * wrong in three ways: the comparison was never going to happen, the
       * message described a per-component problem when the cause is a runtime
       * setting, and a library defining its own elements with static view
       * configs (and deliberately no native view manager) was told each one
       * was broken. Seven of these appeared on a stock RNTester launch.
       *
       * So the capability is asked about directly, and the check that cannot
       * run is skipped rather than attempted. It is reported ONCE — silently
       * disabling an integrity check is its own hazard, and the reader needs to
       * know that "no validation errors" currently means "no validation".
       *
       * Note this is only the `verify` path. Actually *depending* on native
       * view configs (`native: true`) while they are unobtainable is a real
       * problem and still raises the original error, per component, from
       * `getNativeComponentAttributes` above — that is what that message was
       * written for.
       */
      if (!native && !canObtainNativeViewConfigs()) {
        warnOnceThatVerificationIsUnavailable();
        return viewConfig;
      }

      const nativeViewConfig = native
        ? viewConfig
        : getNativeComponentAttributes(name);

      if (nativeViewConfig == null) {
        // Defer to static view config if native view config is missing.
        return viewConfig;
      }

      const staticViewConfig: ViewConfig = native
        ? createViewConfig(viewConfigProvider())
        : viewConfig;

      const validationOutput = StaticViewConfigValidator.validate(
        name,
        nativeViewConfig,
        staticViewConfig,
      );

      if (validationOutput.type === 'invalid') {
        console.error(
          StaticViewConfigValidator.stringifyValidationResult(
            name,
            validationOutput,
          ),
        );
      }
    }

    return viewConfig;
  });

  // $FlowFixMe[incompatible-type] `NativeComponent` is actually string!
  return name;
}

/**
 * Same as `NativeComponentRegistry.get(...)`, except this will check either
 * the `setRuntimeConfigProvider` configuration or use native reflection (slow)
 * to determine whether this native component is available.
 *
 * If the native component is not available, a stub component is returned. Note
 * that the return value of this is not `HostComponent` because the returned
 * component instance is not guaranteed to have native methods.
 */
export function getWithFallback_DEPRECATED<Config extends {...}>(
  name: string,
  viewConfigProvider: () => PartialViewConfig,
): React.ComponentType<Config> {
  if (getRuntimeConfig == null) {
    // `getRuntimeConfig == null` when static view configs are disabled
    // If `setRuntimeConfigProvider` is not configured, use native reflection.
    if (hasNativeViewConfig(name)) {
      /* $FlowFixMe[incompatible-type] Extra ref prop */
      return get<Config>(name, viewConfigProvider);
    }
  } else {
    // If there is no runtime config, then the native component is unavailable.
    if (getRuntimeConfig(name) != null) {
      /* $FlowFixMe[incompatible-type] Extra ref prop */
      return get<Config>(name, viewConfigProvider);
    }
  }

  const FallbackNativeComponent = function (props: Config): React.Node {
    return null;
  };
  FallbackNativeComponent.displayName = `Fallback(${name})`;
  return FallbackNativeComponent;
}

/*
 * Whether native view configs can be obtained in this runtime at all.
 *
 * Defensive about the method's absence: `UIManager` is an interface with more
 * than one implementation, including ones outside this repository, and a
 * missing capability method must not become a crash. Absent, we assume configs
 * ARE obtainable, which preserves the previous behaviour exactly.
 */
function canObtainNativeViewConfigs(): boolean {
  return UIManager.unstable_hasNativeViewConfigInterop?.() ?? true;
}

let hasWarnedAboutUnavailableVerification = false;

function warnOnceThatVerificationIsUnavailable(): void {
  if (hasWarnedAboutUnavailableVerification) {
    return;
  }
  hasWarnedAboutUnavailableVerification = true;
  /*
   * A LOG, not a warning. On the new architecture without the interop layer
   * this branch is the app's permanent, expected configuration — every dev
   * launch took the LogBox warnings banner for a condition nobody can act on
   * from inside the app. The message stays discoverable in the console for
   * someone auditing verification coverage; the boundary that deserves noise —
   * a `native: true` component with no native counterpart — still fails loudly
   * on its own path.
   */
  console.log(
    'NativeComponentRegistry: static view config verification is enabled but ' +
      'cannot run, because native view configs are not obtainable in the new ' +
      'architecture without the legacy ViewConfig interop layer. Static view ' +
      'configs are being used as-is and are NOT being checked against native ' +
      'ones. Turn on the interop layer to restore the check.',
  );
}

function hasNativeViewConfig(name: string): boolean {
  invariant(getRuntimeConfig == null, 'Unexpected invocation!');
  /*
   * `hasViewManagerConfig`, not `getViewManagerConfig(name) != null`: this is an
   * existence check, and on the new architecture fetching the config to answer
   * it logs a soft error advising exactly this call instead. The two are
   * equivalent on the old architecture, where `hasViewManagerConfig` is defined
   * as that same null check.
   *
   * A separate path from the verification above, and separately wrong: this one
   * is only reachable when static view configs are disabled entirely
   * (`getRuntimeConfig == null`), which is why fixing it alone does not quiet an
   * app that has them enabled.
   */
  return UIManager.hasViewManagerConfig(name);
}

/**
 * Unstable API. Do not use!
 *
 * This method returns if there is a StaticViewConfig registered for the
 * component name received as a parameter.
 */
export function unstable_hasStaticViewConfig(name: string): boolean {
  const {native} = getRuntimeConfig?.(name) ?? {
    native: true,
  };
  return !native;
}
