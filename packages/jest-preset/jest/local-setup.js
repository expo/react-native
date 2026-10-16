/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

// Global setup for tests local to the react-native repo. This setup is not
// included in the react-native Jest preset.

import './setup';

// $FlowFixMe[incompatible-type]
const consoleError: (...data: ReadonlyArray<unknown>) => void = console.error;
// $FlowFixMe[incompatible-type]
const consoleWarn: (...data: ReadonlyArray<unknown>) => void = console.warn;

// $FlowFixMe[cannot-write]
console.error = (...args) => {
  consoleError(...args);
  throw new Error('console.error() was called (see error above)');
};

// $FlowFixMe[cannot-write]
console.warn = (...args) => {
  if (isRNTesterDeepImport(args[0])) {
    return;
  }
  consoleWarn(...args);
  throw new Error('console.warn() was called (see warning above)');
};

// Skip the deep-import warning for RNTester's own sources: it is React
// Native's app, and its native intrinsics and the Astryx runtime reach into
// React Native by design
function isRNTesterDeepImport(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    message.startsWith(
      "Deep imports from the 'react-native' package are deprecated",
    ) &&
    message.includes('/packages/rn-tester/')
  );
}
