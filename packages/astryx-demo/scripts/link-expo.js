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

/**
 * Links the Expo packages this app needs from the sibling expo checkout into
 * the repository's node_modules. They cannot be `link:` dependencies: their own
 * manifests use the `workspace:` protocol, which Yarn 1 refuses to resolve, and
 * `yarn install` removes symlinks it does not own. The packages are read from
 * the checkout in place; their imports resolve through its pnpm store, which
 * metro.config.js adds to `watchFolders`.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const expoPackages = path.resolve(repoRoot, '../expo/packages');
const nodeModules = path.join(repoRoot, 'node_modules');

const PACKAGES = [
  'expo',
  'expo-router',
  'expo-constants',
  'expo-linking',
  'expo-glass-effect',
  'expo-image',
  'expo-modules-core',
  'expo-modules-autolinking',
  '@expo/metro-runtime',
  '@expo/log-box',
];

function link(name) {
  const target = path.join(expoPackages, name);
  const linkPath = path.join(nodeModules, name);
  if (!fs.existsSync(target)) {
    throw new Error(
      `${target} does not exist. This app reads Expo from a checkout of expo/expo beside this repository; clone it to ${path.dirname(expoPackages)} first.`,
    );
  }
  let existing = null;
  try {
    existing = fs.readlinkSync(linkPath);
  } catch {
    if (fs.existsSync(linkPath)) {
      // A real directory from the registry; leave it, since another package
      // chose it deliberately
      console.log(`keeping ${name} (installed from the registry)`);
      return;
    }
  }
  const relative = path.relative(path.dirname(linkPath), target);
  if (existing === relative) {
    return;
  }
  fs.mkdirSync(path.dirname(linkPath), {recursive: true});
  if (existing != null) {
    fs.unlinkSync(linkPath);
  }
  fs.symlinkSync(relative, linkPath);
  console.log(`linked ${name} -> ${relative}`);
}

for (const name of PACKAGES) {
  link(name);
}
