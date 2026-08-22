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
 * What `NativeComponentRegistry` does when static view configs are asked to be
 * verified against native ones that cannot be obtained.
 *
 * Verification compares a component's static view config with the native one.
 * On the new architecture, native view configs are reachable only through the
 * legacy ViewConfig interop layer; with it off there is no native config for
 * ANY component. The registry used to ask regardless, which produced a soft
 * error per component resolved — seven on a stock RNTester launch — describing
 * a per-component problem whose cause was a runtime setting, and telling any
 * library that defines elements with static view configs and deliberately no
 * native view manager that each of its elements was broken.
 *
 * These tests pin the three properties that fix has to keep at once: the futile
 * call is not made, the skip is still reported (once), and verification is
 * untouched wherever it can actually run.
 */

// RN's jest setup auto-mocks this module for everyone else's tests; this one
// is about its actual behaviour.
jest.unmock('../NativeComponentRegistry');

const NAME_SEQUENCE = (() => {
  let next = 0;
  // Registration is global and rejects duplicates, so each test needs a name
  // no other test has used.
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

  // The registry's own default would pick `verify: false`; the app-level
  // provider is what turns verification on, which is the configuration these
  // tests are about.
  NativeComponentRegistry.setRuntimeConfigProvider(() => ({
    native: false,
    verify: true,
  }));

  return {
    getNativeComponentAttributes,
    // Registration is lazy: resolving the config is what runs the code here.
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
    // The heart of it. Asking was never going to succeed, and asking is what
    // logged the error.
    const {resolve, getNativeComponentAttributes} = setUp({hasInterop: false});
    const config = resolve(NAME_SEQUENCE());

    expect(getNativeComponentAttributes).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // ...and the component is still usable, from its static config.
    expect(config.validAttributes.someProp).toBe(true);
  });

  test('reports the skipped check exactly once, as a log, not once per component', () => {
    // A disabled integrity check has to be visible — "no validation errors"
    // otherwise reads as "validated". But the cause is one runtime setting, so
    // it is one message however many components are resolved — and a LOG, not
    // a warning: on the new architecture without the interop layer this is the
    // app's permanent configuration, and a warning put the LogBox banner on
    // every dev launch for a condition no one can act on from inside the app.
    const {resolve} = setUp({hasInterop: false});
    resolve(NAME_SEQUENCE());
    resolve(NAME_SEQUENCE());
    resolve(NAME_SEQUENCE());

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('interop');
    expect(warn).not.toHaveBeenCalled();
  });

  test('still verifies when native view configs ARE obtainable', () => {
    // The other half: this must narrow *when* the check runs, never whether it
    // works. With the interop layer on, the comparison happens as before.
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
    // `UIManager` has implementations outside this repository. A missing
    // capability method must leave behaviour exactly as it was, never crash.
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
    // The boundary of the fix, and the real problem the original message was
    // written for. `native: true` means "this component's config comes from the
    // native side" — with no native config available that is a genuine defect
    // in how the component is set up, not a property of the runtime, so it must
    // still go and ask and let the failure surface. Only the *comparison* is
    // skipped when it cannot run; depending on the thing is not.
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
    // ...and it is not quietly reclassified as the skipped-verification case.
    expect(warn).not.toHaveBeenCalled();
  });
});
