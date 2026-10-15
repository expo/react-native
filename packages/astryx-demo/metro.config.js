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
const path = require('node:path');

// Where the icon packages' modules live, wherever node_modules puts them
const ICON_PACKAGES = [
  path.sep + path.join('@heroicons', 'react') + path.sep,
  path.sep + 'lucide-react' + path.sep,
];

const repoRoot = path.resolve(__dirname, '../..');
const astryx = path.resolve(__dirname, '../rn-tester/js/astryx');
const expoCheckout = path.resolve(repoRoot, '../expo');
const expoPackages = path.join(expoCheckout, 'packages');
// What scripts/link-expo.js links into node_modules
const LINKED_EXPO_PACKAGES = new Set([
  'expo',
  'expo-router',
  'expo-constants',
  'expo-linking',
  'expo-glass-effect',
  'expo-image',
  'expo-modules-core',
  '@expo/metro-runtime',
  '@expo/log-box',
]);

/**
 * The project root is this package, as for RN Tester, because Metro's Babel
 * transformer takes the `.babelrc.js` of the project root for every file it
 * compiles — this app's, with the Astryx JSX runtime for its screens and the
 * class-static-block transform that `intl-messageformat` needs. The repository
 * and the expo checkout are watch folders: the app imports the element catalog
 * from `packages/expo-intrinsics` and the Astryx layer from
 * `packages/rn-tester`, and the linked Expo packages resolve their own imports
 * through the checkout's pnpm store.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  projectRoot: __dirname,
  watchFolders: [repoRoot, expoCheckout],
  transformer: {
    // `.css` imports load as raw text for the stylesheet engine; see
    // packages/rn-tester/css-transformer.js
    babelTransformerPath: path.resolve(
      __dirname,
      '../rn-tester/css-transformer.js',
    ),
    // Expo Router discovers routes with `require.context` over the app directory
    unstable_allowRequireContext: true,
  },
  resolver: {
    // The native build writes into ios/build (codegen) and ios/Pods, both
    // inside the watched tree; without this every build step is a reload
    blockList: [
      /\/react-native\/sdks\/hermes\//,
      /\/astryx-demo\/ios\/(build|Pods)\//,
      // The templates' web version, served to a web view, not bundled
      /\/astryx-demo\/web\//,
      /\/rn-tester\/(build|Pods)\//,
    ],
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx', 'css'],
    resolveRequest: (context, moduleName, platform) => {
      // The Astryx layer imports React Native internals by deep path
      // (`react-native/src/private/webapis/dom/...`); the package's `exports`
      // map has no `./src/*` entry, so say where the files are rather than
      // let Metro warn and fall back on every bundle
      if (moduleName.startsWith('react-native/src/')) {
        return context.resolveRequest(
          context,
          path.resolve(
            repoRoot,
            'packages/react-native',
            moduleName.slice('react-native/'.length),
          ),
          platform,
        );
      }
      // expo-asset imports the asset registry by the name upstream publishes it
      // under; in this fork it is React Native's own secondary entry point
      if (moduleName === '@react-native/assets-registry/registry') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            repoRoot,
            'packages/react-native/src/asset-registry.js',
          ),
        };
      }
      // Expo Router's route context is normally produced by babel-preset-expo
      // from EXPO_ROUTER_APP_ROOT; this app compiles with React Native's preset,
      // so the context is written out by hand in `routes-context.js`
      if (
        /(^|\/)_ctx(\.(ios|android|web|html|shared))?$/.test(moduleName) &&
        context.originModulePath.includes('/expo-router/')
      ) {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'routes-context.js'),
        };
      }
      const fromExpoCheckout = context.originModulePath.startsWith(
        expoCheckout + path.sep,
      );
      if (fromExpoCheckout) {
        // One React and one React Native: the checkout's pnpm store carries
        // its own copies, and a module there asking for `react` must get this
        // repository's, or hooks run against two renderers
        const shared = moduleName.match(
          /^(react|react-native|react-native-screens|react-native-safe-area-context|expo-modules-core|expo-image)(\/.*)?$/,
        );
        if (shared != null) {
          return context.resolveRequest(
            {...context, originModulePath: path.join(__dirname, 'index.js')},
            moduleName,
            platform,
          );
        }
        // A linked package referring to itself by name (`expo-router/entry-classic`
        // from expo-router/entry.js) is resolved against its real directory,
        // which is not under any node_modules Metro would search from there
        const self = moduleName.match(/^((?:@expo\/)?[a-z-]+)(\/.*)?$/);
        if (self != null && LINKED_EXPO_PACKAGES.has(self[1])) {
          return context.resolveRequest(
            context,
            path.join(expoPackages, self[1]) + (self[2] ?? ''),
            platform,
          );
        }
        // Anything else the checkout's pnpm store does not carry — the Babel
        // helpers the preset injects (`@babel/runtime/helpers/*`) above all —
        // is taken from this repository's node_modules
        try {
          return context.resolveRequest(context, moduleName, platform);
        } catch (e) {
          return context.resolveRequest(
            {...context, originModulePath: path.join(__dirname, 'index.js')},
            moduleName,
            platform,
          );
        }
      }
      // A vendored source, a template or an icon package that builds an
      // element with `React.createElement` gets a React whose createElement
      // routes intrinsics through the Astryx JSX runtime, as Babel does for
      // JSX; see packages/rn-tester/js/astryx/react-with-runtime.js. Heroicons
      // and Lucide build their `<svg>` and its shapes that way: Astryx's Icon
      // hands an icon its colour as a `var()`, which only the runtime
      // resolves, and only the runtime draws `<path>`.
      if (
        moduleName === 'react' &&
        (context.originModulePath.startsWith(
          path.join(astryx, 'vendor') + path.sep,
        ) ||
          context.originModulePath.startsWith(
            path.join(__dirname, 'templates') + path.sep,
          ) ||
          ICON_PACKAGES.some(icons => context.originModulePath.includes(icons)))
      ) {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'react-with-runtime.js'),
        };
      }
      // The vendored Astryx sources import '@stylexjs/stylex' verbatim; resolve
      // it to the RN StyleX runtime so they run unmodified
      if (moduleName === '@stylexjs/stylex') {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'stylex-rn.js'),
        };
      }
      // The templates import `@astryxdesign/core` and `@astryxdesign/core/<Component>`;
      // both resolve into the vendored slice (`index.ts` is its barrel)
      if (moduleName === '@astryxdesign/core') {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'vendor', 'index.ts'),
        };
      }
      // The neutral theme: its sources, and the artifacts `astryx theme build`
      // generates from them (`built`, `theme.css`), vendored from a build of
      // the checkout since it ships no `dist`
      if (moduleName === '@astryxdesign/theme-neutral') {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'vendor-themes', 'neutral', 'source.ts'),
        };
      }
      if (moduleName === '@astryxdesign/theme-neutral/built') {
        return {
          type: 'sourceFile',
          filePath: path.join(
            astryx,
            'vendor-themes',
            'neutral',
            'built',
            'neutral.js',
          ),
        };
      }
      if (moduleName === '@astryxdesign/theme-neutral/theme.css') {
        return {
          type: 'sourceFile',
          filePath: path.join(
            astryx,
            'vendor-themes',
            'neutral',
            'built',
            'theme.css',
          ),
        };
      }
      if (moduleName.startsWith('@astryxdesign/core/')) {
        const sub = moduleName.slice('@astryxdesign/core/'.length);
        return context.resolveRequest(
          context,
          path.join(astryx, 'vendor', sub),
          platform,
        );
      }
      // Astryx's document-level press controller listens on `window` and
      // `document`; its stand-in keeps the exports and installs nothing (see
      // packages/rn-tester/js/astryx/pressFeedback-shim.js)
      if (/\/pressFeedback$/.test(moduleName)) {
        const resolved = context.resolveRequest(context, moduleName, platform);
        if (
          resolved.type === 'sourceFile' &&
          resolved.filePath.endsWith('/js/astryx/vendor/utils/pressFeedback.ts')
        ) {
          return {
            type: 'sourceFile',
            filePath: path.join(astryx, 'pressFeedback-shim.js'),
          };
        }
        return resolved;
      }
      // Astryx's `Layer/useLayer` imports `createPortal` from react-dom on a
      // branch this renderer never takes; the import still has to resolve
      if (moduleName === 'react-dom' || moduleName === 'react-dom/client') {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'react-dom-shim.js'),
        };
      }
      // The Astryx layer and this app compile JSX against the runtime that
      // lets intrinsic elements inherit CSS custom properties (see .babelrc.js)
      if (
        moduleName === 'astryx-jsx/jsx-runtime' ||
        moduleName === 'astryx-jsx/jsx-dev-runtime'
      ) {
        return {
          type: 'sourceFile',
          filePath: path.join(astryx, 'jsx-runtime.js'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(repoRoot), config);
