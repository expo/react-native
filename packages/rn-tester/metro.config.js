/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

const {getDefaultConfig} = require('@react-native/metro-config');
const {mergeConfig} = require('metro-config');
const fs = require('node:fs');
const path = require('node:path');

/**
 * This cli config is needed for development purposes, e.g. for running
 * integration tests during local development or on CI services.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  // Make Metro able to resolve required external dependencies
  watchFolders: [
    path.resolve(__dirname, '../../node_modules'),
    path.resolve(__dirname, '../asset-utils'),
    path.resolve(__dirname, '../community-cli-plugin'),
    path.resolve(__dirname, '../dev-middleware'),
    path.resolve(__dirname, '../new-app-screen'),
    path.resolve(__dirname, '../normalize-color'),
    path.resolve(__dirname, '../polyfills'),
    path.resolve(__dirname, '../react-native'),
    path.resolve(__dirname, '../virtualized-lists'),
    path.resolve(__dirname, '../react-native-popup-menu-android'),
    path.resolve(__dirname, '../expo-intrinsics'),
    path.resolve(__dirname, '../react-native-test-library/apple'),
    path.resolve(__dirname, '../react-native-test-library/common'),
    // The local expo checkout: expo-modules-core and expo-image are linked
    // into node_modules from it (the DOM element catalog's eventual home), and
    // their imports resolve through its pnpm store.
    path.resolve(__dirname, '../../../expo'),
  ],
  transformer: {
    // `.css` imports load as raw text for the stylesheet engine
    // (js/astryx/css); see css-transformer.js.
    babelTransformerPath: path.resolve(__dirname, 'css-transformer.js'),
  },
  resolver: {
    blockList: [/..\/react-native\/sdks\/hermes/],
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx', 'css'],
    extraNodeModules: {
      'react-native': path.resolve(__dirname, '../react-native'),
    },
    // The vendored Astryx sources (js/astryx/vendor) import '@stylexjs/stylex'
    // verbatim; resolve it to the RN StyleX runtime so they run unmodified.
    resolveRequest: (context, moduleName, platform) => {
      // The Radix shim layer: vendored shadcn sources import
      // '@radix-ui/react-*' verbatim; each id resolves to the shim
      // implementing that package's public surface over the fork's machinery
      // (js/astryx/radix).
      // The vendored shadcn sources (js/shadcn/ui) import their world by the
      // upstream names; each resolves to the fork's implementation.
      // @expo/ui imports three symbols from 'expo' — requireNativeView,
      // requireNativeModule and installOnUIRuntime — all of which the `expo`
      // package merely re-exports from expo-modules-core. The tester
      // deliberately does not depend on `expo` itself (the Podfile excludes it,
      // because it drags in Expo's AppDelegate/factory pod), so the import
      // resolves to a shim over the module that actually defines them. It has
      // to be a shim rather than expo-modules-core directly, because one of the
      // three is exported under a different name there; see the file.
      // A handful of tester screens import React Native internals by deep path
      // (`react-native/src/private/featureflags/...`, `.../webapis/geometry/...`,
      // `.../components/switch/specs/...`). The package's `exports` map has no
      // `./src/*` entry — deliberately, since these are private — so Metro warns
      // and falls back to file-based resolution on every bundle. Resolving them
      // here says where the files are without widening React Native's public
      // surface, which is the part that should not change.
      if (moduleName.startsWith('react-native/src/')) {
        return context.resolveRequest(
          context,
          path.resolve(
            __dirname,
            '../react-native',
            moduleName.slice('react-native/'.length),
          ),
          platform,
        );
      }
      if (moduleName === 'expo') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/expo-package-shim.js'),
        };
      }
      // `@expo/ui/swift-ui` is reachable only through the package's `exports`
      // map, which points at TypeScript source. This resolver does not consult
      // exports maps, so the subpath resolves to nothing and the import fails
      // with "Cannot find module '@expo/ui/swift-ui'" — which is what it did.
      // The universal entry is unaffected because it is the package's main.
      if (moduleName.startsWith('@expo/ui/swift-ui')) {
        const rest = moduleName.slice('@expo/ui/swift-ui'.length);
        const candidate = path.resolve(
          __dirname,
          '../../node_modules/@expo/ui/src/swift-ui' +
            (rest === '' ? '/index.tsx' : rest + '/index.ts'),
        );
        // Fall through rather than throw if the layout ever changes: a resolver
        // that dies takes every bundle with it, and the caller already copes
        // with this module being unavailable.
        if (fs.existsSync(candidate)) {
          return {type: 'sourceFile', filePath: candidate};
        }
      }
      // expo-modules-core is *linked* from the expo checkout, so Metro resolves
      // its imports by walking up from there — into a pnpm store with no
      // hoisted @babel/runtime — and never consults this repo's copy. Babel's
      // transform of that source emits helper requires, so without this the
      // bundle fails on `@babel/runtime/helpers/*` before reaching any Expo
      // code. Point them at the repo's own @babel/runtime.
      // Scoped to importers inside that checkout on purpose: redirecting every
      // caller would also re-point React Native's own helper imports at this
      // exact file, changing which interop shape they get, and the app dies on
      // its first render with "undefined is not a function".
      if (
        moduleName.startsWith('@babel/runtime/') &&
        context.originModulePath != null &&
        context.originModulePath.includes(
          `${path.sep}Developer${path.sep}expo${path.sep}`,
        )
      ) {
        return {
          type: 'sourceFile',
          filePath: require.resolve(moduleName, {
            paths: [path.resolve(__dirname, '../..')],
          }),
        };
      }
      if (moduleName === '@/lib/utils') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'utils.js'),
        };
      }
      if (moduleName.startsWith('@/registry/default/ui/')) {
        const component = moduleName.slice('@/registry/default/ui/'.length);
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            __dirname,
            'js',
            'shadcn',
            'ui',
            component + '.tsx',
          ),
        };
      }
      if (moduleName === 'class-variance-authority') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'cva.js'),
        };
      }
      if (moduleName === 'lucide-react') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'lucide.js'),
        };
      }
      if (moduleName.startsWith('@radix-ui/')) {
        const radixName = moduleName.slice('@radix-ui/'.length);
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            __dirname,
            'js',
            'astryx',
            'radix',
            'pkg',
            radixName + '.js',
          ),
        };
      }
      // Astryx 0.5.0's `Layer/useLayer` imports `createPortal`. react-dom is
      // banned here — these components are meant to run on the renderer, not
      // on the web — and the branch that calls it is unreachable anyway, since
      // its portal target is an `HTMLElement` resolved from `parentElement`.
      // The import still has to resolve for the module to load. Aliasing keeps
      // the vendored source unmodified, exactly as the StyleX alias below does.
      if (moduleName === 'react-dom') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/astryx/react-dom-shim.js'),
        };
      }
      if (moduleName === '@stylexjs/stylex') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/astryx/stylex-rn.js'),
        };
      }
      // The astryx directory compiles JSX against this runtime (see .babelrc)
      // so intrinsic elements can inherit CSS custom properties.
      if (
        moduleName === 'astryx-jsx/jsx-runtime' ||
        moduleName === 'astryx-jsx/jsx-dev-runtime'
      ) {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/astryx/jsx-runtime.js'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
