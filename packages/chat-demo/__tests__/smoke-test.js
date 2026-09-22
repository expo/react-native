/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

/*
 * Catches errors thrown while a module's top-level code runs, such as a
 * `StyleSheet.create` that references a deleted constant. In the app these
 * show a blank screen without a native crash.
 *
 * `console.warn` is silenced because packages/jest-preset/jest/local-setup.js
 * turns warnings into throws, and expo-intrinsics' deep imports from
 * `react-native` warn when loaded.
 */
let warnSpy;
beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

test('the composer module loads', () => {
  expect(() => require('../Composer')).not.toThrow();
  expect(typeof require('../Composer').default).toBe('function');
});

test('the chat screen module loads', () => {
  expect(() => require('../screens/ChatScreen')).not.toThrow();
  expect(typeof require('../screens/ChatScreen').default).toBe('function');
});

test('the app module loads', () => {
  expect(() => require('../App')).not.toThrow();
  expect(typeof require('../App').default).toBe('function');
});
