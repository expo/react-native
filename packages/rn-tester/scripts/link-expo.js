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
 * Links the Expo packages the tester needs from the sibling expo checkout into
 * the repository's node_modules. They cannot be `link:` dependencies:
 * expo-modules-core's manifest uses the `workspace:` protocol (for
 * expo-modules-jsi), which Yarn 1 refuses to resolve, and `yarn install`
 * removes symlinks it does not own. The packages are read from the checkout in
 * place; their imports resolve through its pnpm store, which metro.config.js
 * adds to `watchFolders`.
 *
 * `expo` is linked only for Expo's autolinking, which `pod install` runs as
 * `require('expo/bin/autolinking')` from this package. The Podfile leaves out
 * the `expo` pod, and Metro resolves `expo` to js/expo-package-shim.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const expoPackages = path.resolve(repoRoot, '../expo/packages');
const nodeModules = path.join(repoRoot, 'node_modules');

const PACKAGES = ['expo', 'expo-image', 'expo-modules-core'];

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
