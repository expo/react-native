/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

// $FlowFixMe[cannot-resolve-module]
// $FlowFixMe[untyped-import]
const {defaults} = require('jest-config');

const PODS_LOCATIONS = [
  'packages/rn-tester/Pods',
  'private/helloworld/ios/Pods',
];

module.exports = {
  transform: {
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$':
      '<rootDir>/packages/jest-preset/jest/assetFileTransformer.js',
    '\\.(css)$': '<rootDir>/packages/jest-preset/jest/cssFileTransformer.js',
    '.*': './jest/preprocessor.js',
  },
  resolver: './packages/jest-preset/jest/resolver.js',
  moduleNameMapper: {
    // `resolver.js` strips `exports`, so alias these subpaths to their `src/` impl.
    '^react-native/react-private-interface$':
      '<rootDir>/packages/react-native/src/react-private-interface.js',
    '^react-native/setup-env$':
      '<rootDir>/packages/react-native/src/setup-env.js',
    '^react-native/unstable-internals-do-not-use$':
      '<rootDir>/packages/react-native/src/unstable-internals-do-not-use.js',
    // The vendored shadcn sources' world, mirrored from rn-tester's Metro
    // aliases so the REAL components run under jest.
    '^@/lib/utils$': '<rootDir>/packages/rn-tester/js/shadcn/lib/utils.js',
    '^@/registry/default/ui/(.*)$':
      '<rootDir>/packages/rn-tester/js/shadcn/ui/$1.tsx',
    '^class-variance-authority$':
      '<rootDir>/packages/rn-tester/js/shadcn/lib/cva.js',
    '^lucide-react$': '<rootDir>/packages/rn-tester/js/shadcn/lib/lucide.js',
    '^@radix-ui/react-(.*)$':
      '<rootDir>/packages/rn-tester/js/astryx/radix/pkg/react-$1.js',
    // The vendored Astryx sources import StyleX and react-dom by their
    // published names; Metro resolves both to the fork's runtime (see
    // packages/rn-tester/metro.config.js), and so does Jest
    '^@stylexjs/stylex$': '<rootDir>/packages/rn-tester/js/astryx/stylex-rn.js',
    '^react-dom(/client)?$':
      '<rootDir>/packages/rn-tester/js/astryx/react-dom-shim.js',
    '^astryx-jsx/jsx-runtime$':
      '<rootDir>/packages/rn-tester/js/astryx/jsx-runtime.js',
    '^astryx-jsx/jsx-dev-runtime$':
      '<rootDir>/packages/rn-tester/js/astryx/jsx-runtime.js',
  },
  setupFiles: ['./packages/jest-preset/jest/local-setup.js'],
  fakeTimers: {
    enableGlobally: true,
    legacyFakeTimers: false,
  },
  snapshotFormat: {
    escapeString: true,
    printBasicPrototype: true,
  },
  // This allows running Meta-internal tests with the `-test.fb.js` suffix.
  testRegex: '/__tests__/.*-test(\\.fb)?\\.js$',
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/packages/react-native/sdks',
    '<rootDir>/packages/react-native/Libraries/Renderer',
    '<rootDir>/packages/react-native/sdks/hermes/',
    ...PODS_LOCATIONS,
  ] /*:: as ReadonlyArray<string> */,
  // intl-messageformat 11 and its @formatjs dependencies ship ES modules only;
  // the vendored Astryx i18n imports them, so Jest has to transform them
  transformIgnorePatterns: [
    'node_modules/(?!@react-native/|intl-messageformat|@formatjs/)',
  ],
  haste: {
    defaultPlatform: 'ios',
    platforms: ['ios', 'android'],
  },
  moduleFileExtensions: [
    'fb.js',
    ...defaults.moduleFileExtensions,
  ] /*:: as ReadonlyArray<string> */,
  modulePathIgnorePatterns: [
    'scripts/.*/__fixtures__/',
    '<rootDir>/packages/react-native/sdks/hermes/',
    ...PODS_LOCATIONS,
  ] /*:: as ReadonlyArray<string> */,
  unmockedModulePathPatterns: [
    'node_modules/react/',
    'packages/react-native/Libraries/Renderer',
    'promise',
    'source-map',
    'fastpath',
    'denodeify',
  ],
  testEnvironment: 'node',
  collectCoverageFrom: [
    'packages/react-native/Libraries/**/*.js',
    'packages/react-native/src/**/*.js',
  ],
  coveragePathIgnorePatterns: [
    '/__tests__/',
    '/vendor/',
    '<rootDir>/packages/react-native/Libraries/react-native/',
  ],
};
