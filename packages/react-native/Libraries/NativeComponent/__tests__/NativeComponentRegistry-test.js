/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {PartialViewConfig} from '../../Renderer/shims/ReactNativeTypes';

// The Jest preset replaces this module with a mock.
jest.unmock('../NativeComponentRegistry');

const NAME = 'RCTTestComponent';

const PARTIAL_VIEW_CONFIG: PartialViewConfig = {
  uiViewClassName: NAME,
  validAttributes: {},
};

const originalBridgeless = global.RN$Bridgeless;
const originalGetConstants = global.RN$LegacyInterop_UIManager_getConstants;

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  // $FlowExpectedError[cannot-write]
  global.RN$Bridgeless = originalBridgeless;
  // $FlowExpectedError[cannot-write]
  global.RN$LegacyInterop_UIManager_getConstants = originalGetConstants;
});

describe('get with verify', () => {
  function getNativeViewConfigRequests({
    bridgeless,
    interop,
  }: {
    bridgeless: boolean,
    interop: boolean,
  }): ReadonlyArray<string> {
    // $FlowExpectedError[cannot-write]
    global.RN$Bridgeless = bridgeless;
    // $FlowExpectedError[cannot-write]
    global.RN$LegacyInterop_UIManager_getConstants = interop
      ? () => ({})
      : undefined;
    const getNativeComponentAttributes = jest.fn((name: string) => null);
    jest.doMock(
      '../../ReactNative/getNativeComponentAttributes',
      () => getNativeComponentAttributes,
    );

    const NativeComponentRegistry = require('../NativeComponentRegistry');
    NativeComponentRegistry.setRuntimeConfigProvider(() => ({
      native: false,
      verify: true,
    }));
    NativeComponentRegistry.get<{...}>(NAME, () => PARTIAL_VIEW_CONFIG);
    // `get` registers a lazy view config. Reading it runs the verification.
    require('../../Renderer/shims/ReactNativeViewConfigRegistry').get(NAME);

    return getNativeComponentAttributes.mock.calls.map(([name]) => name);
  }

  test('does not request a native view config in bridgeless mode without the interop binding', () => {
    expect(
      getNativeViewConfigRequests({
        bridgeless: true,
        interop: false,
      }),
    ).toEqual([]);
  });

  test('requests the native view config in bridgeless mode with the interop binding', () => {
    expect(
      getNativeViewConfigRequests({
        bridgeless: true,
        interop: true,
      }),
    ).toEqual([NAME]);
  });

  test('requests the native view config outside bridgeless mode', () => {
    expect(
      getNativeViewConfigRequests({
        bridgeless: false,
        interop: false,
      }),
    ).toEqual([NAME]);
  });
});

describe('getWithFallback_DEPRECATED without a runtime config provider', () => {
  test('finds a component without requesting its view config', () => {
    const getViewManagerConfig = jest.fn((name: string) => null);
    jest.doMock('../../ReactNative/UIManager', () => ({
      getViewManagerConfig,
      hasViewManagerConfig: (name: string) => name === NAME,
    }));

    const NativeComponentRegistry = require('../NativeComponentRegistry');

    expect(
      NativeComponentRegistry.getWithFallback_DEPRECATED<{...}>(
        NAME,
        () => PARTIAL_VIEW_CONFIG,
      ),
    ).toBe(NAME);
    expect(getViewManagerConfig).not.toHaveBeenCalled();
  });
});
