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
 * The fast guard: does each screen module even LOAD.
 *
 * A `StyleSheet.create` that references a `const` a refactor deleted throws
 * `ReferenceError: Property 'X' doesn't exist` at module-eval time and blanks
 * the whole app — and it does so WITHOUT a native crash, so the release gate's
 * crash check waves it through; only the ten-minute XCUITest suite caught it
 * (34/34 failed on "BADGE doesn't exist"). Importing the module runs its
 * top-level code, so this reproduces that class of failure in milliseconds.
 * See the `gate-misses-js-blank` note.
 *
 * Import rather than render: rendering needs the native components mocked and
 * is the XCUITest suite's job. Loading is what catches the module-eval throw,
 * which is the failure this exists for.
 *
 * `console.warn` is silenced for the load: the jest preset turns any warn into
 * a throw, and importing `expo-intrinsics` warns while it registers its
 * elements — benign in the app (only the preset throws on it) and not the
 * failure this guards. A real `ReferenceError` still throws straight through.
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
