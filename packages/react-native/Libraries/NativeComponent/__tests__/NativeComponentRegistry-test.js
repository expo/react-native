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

/**
 * What `NativeComponentRegistry` does when static view configs are to be
 * verified against native ones that cannot be obtained (the new architecture
 * with the legacy ViewConfig interop layer off): the futile call is not made,
 * the skip is reported once, and verification runs wherever it can.
 */

// RN's jest setup auto-mocks this module; this test is about its behaviour
jest.unmock('../NativeComponentRegistry');

const NAME_SEQUENCE = (() => {
  let next = 0;
  // Registration is global and rejects duplicates, so each test needs its own
  // name
  return () => `RCTFakeComponent${next++}`;
})();

const PARTIAL_VIEW_CONFIG: PartialViewConfig = {
  uiViewClassName: 'ignored',
  validAttributes: {someProp: true},
};

function setUp({
  hasInterop,
  nativeAttributes = null,
}: {
  hasInterop: boolean,
  nativeAttributes?: unknown,
}) {
  jest.resetModules();

  const getNativeComponentAttributes = jest.fn(() => nativeAttributes);
  jest.doMock(
    '../../ReactNative/getNativeComponentAttributes',
    () => getNativeComponentAttributes,
  );
  jest.doMock('../../ReactNative/UIManager', () => ({
    unstable_hasNativeViewConfigInterop: () => hasInterop,
  }));

  const NativeComponentRegistry = require('../NativeComponentRegistry');
  const ReactNativeViewConfigRegistry = require('../../Renderer/shims/ReactNativeViewConfigRegistry');

  // The app-level provider turns verification on, which is the configuration
  // these tests are about
  NativeComponentRegistry.setRuntimeConfigProvider(() => ({
    native: false,
    verify: true,
  }));

  return {
    getNativeComponentAttributes,
    // Registration is lazy: resolving the config is what runs the code here
    resolve(name: string) {
      NativeComponentRegistry.get<{...}>(name, () => PARTIAL_VIEW_CONFIG);
      return ReactNativeViewConfigRegistry.get(name);
    },
  };
}

describe('verification when native view configs cannot be obtained', () => {
  let warn, log, error;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not ask for a native view config it cannot get', () => {
    // Asking was never going to succeed, and asking is what logged the error
    const {resolve, getNativeComponentAttributes} = setUp({hasInterop: false});
    const config = resolve(NAME_SEQUENCE());

    expect(getNativeComponentAttributes).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // The component is still usable, from its static config
    expect(config.validAttributes.someProp).toBe(true);
  });

  test('reports the skipped check exactly once, as a log, not once per component', () => {
    // A disabled integrity check has to be visible, but the cause is one
    // runtime setting, so it is one log however many components are resolved
    const {resolve} = setUp({hasInterop: false});
    resolve(NAME_SEQUENCE());
    resolve(NAME_SEQUENCE());
    resolve(NAME_SEQUENCE());

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('interop');
    expect(warn).not.toHaveBeenCalled();
  });

  test('still verifies when native view configs ARE obtainable', () => {
    // With the interop layer on, the comparison happens as before
    const {resolve, getNativeComponentAttributes} = setUp({
      hasInterop: true,
      nativeAttributes: {
        uiViewClassName: 'ignored',
        NativeProps: {someProp: 'bool'},
        baseModuleName: null,
        bubblingEventTypes: {},
        directEventTypes: {},
      },
    });
    const name = NAME_SEQUENCE();
    resolve(name);

    expect(getNativeComponentAttributes).toHaveBeenCalledWith(name);
    expect(warn).not.toHaveBeenCalled();
  });

  test('assumes configs are obtainable if the UIManager cannot say', () => {
    // `UIManager` has implementations outside this repository; a missing
    // capability method must not crash
    jest.resetModules();
    const getNativeComponentAttributes = jest.fn(() => null);
    jest.doMock(
      '../../ReactNative/getNativeComponentAttributes',
      () => getNativeComponentAttributes,
    );
    jest.doMock('../../ReactNative/UIManager', () => ({}));

    const NativeComponentRegistry = require('../NativeComponentRegistry');
    const ReactNativeViewConfigRegistry = require('../../Renderer/shims/ReactNativeViewConfigRegistry');
    NativeComponentRegistry.setRuntimeConfigProvider(() => ({
      native: false,
      verify: true,
    }));

    const name = NAME_SEQUENCE();
    NativeComponentRegistry.get<{...}>(name, () => PARTIAL_VIEW_CONFIG);
    expect(() => ReactNativeViewConfigRegistry.get(name)).not.toThrow();
    expect(getNativeComponentAttributes).toHaveBeenCalledWith(name);
  });

  test('a component that DEPENDS on native reflection still asks, loudly', () => {
    // `native: true` means the config comes from the native side; with none
    // available that is a defect in the component, so it must still ask and
    // let the failure surface
    jest.resetModules();
    const getNativeComponentAttributes = jest.fn(() => null);
    jest.doMock(
      '../../ReactNative/getNativeComponentAttributes',
      () => getNativeComponentAttributes,
    );
    jest.doMock('../../ReactNative/UIManager', () => ({
      unstable_hasNativeViewConfigInterop: () => false,
    }));

    const NativeComponentRegistry = require('../NativeComponentRegistry');
    const ReactNativeViewConfigRegistry = require('../../Renderer/shims/ReactNativeViewConfigRegistry');
    NativeComponentRegistry.setRuntimeConfigProvider(() => ({
      native: true,
      verify: true,
    }));

    const name = NAME_SEQUENCE();
    NativeComponentRegistry.get<{...}>(name, () => PARTIAL_VIEW_CONFIG);
    ReactNativeViewConfigRegistry.get(name);

    expect(getNativeComponentAttributes).toHaveBeenCalledWith(name);
    // Not reclassified as the skipped-verification case
    expect(warn).not.toHaveBeenCalled();
  });
});
