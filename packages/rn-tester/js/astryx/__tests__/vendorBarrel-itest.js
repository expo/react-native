/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

// The vendored Astryx sources run unmodified on the StyleX runtime, so a
// StyleX API they call at module scope that the runtime lacks takes the whole
// library down at import time — `stylex.when.ancestor` did exactly that at
// 0.5.0. Loading the barrel evaluates every component module once, and the
// tokens, themes and keyframes they make at module scope register with the
// renderer's style engine.

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import * as Fantom from '@react-native/fantom';

describe('the vendored Astryx barrel', () => {
  it('loads every component module', () => {
    // Fantom's Hermes is built without `Intl`, which the app's has, and
    // `utils/characters` reads `Intl.Segmenter` as it loads
    globalThis.Intl ??= {};
    let core = {};
    const failures = [];
    // Run as a task, so the engine commits what the modules register once the
    // runtime is idle
    Fantom.runTask(() => {
      core = require('../vendor/index.ts');
      // The barrel exports getters that require each module on first read, so
      // every export has to be read for every module to load
      for (const name of Object.keys(core)) {
        try {
          core[name];
        } catch (e) {
          failures.push(`${name}: ${e.message.split('\n')[0]}`);
        }
      }
    });
    expect(failures).toEqual([]);
    expect(typeof core.Button).toBe('function');
    expect(typeof core.Layout).toBe('function');
    expect(typeof core.Table).toBe('function');
    expect(Object.keys(core).length).toBeGreaterThan(100);
  });
});
