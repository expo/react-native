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

/**
 * Which build this bundle came from, shown in the Astryx transitions demo.
 *
 * 'metro-dev' means the bundle is being served live by Metro. Device preview
 * builds overwrite this file with the git hash and time before archiving
 * (see /tmp/build-preview.sh), then restore it — so a device screenshot
 * always says exactly which code it is running. This exists because a stale
 * install is indistinguishable from a fresh one on the home screen, and a
 * bug was once chased on a build that did not contain the fix.
 */
export const BUILD_STAMP: string = 'metro-dev';
