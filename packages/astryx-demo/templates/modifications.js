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
 * Every way a shipped template differs from its upstream source. The goal is
 * an empty list: templates are meant to run as Astryx publishes them.
 * `scripts/sync-templates.js --check` fails on any template that drifted from
 * upstream without an entry here, and the app shows this list on its
 * "Modifications" screen.
 *
 * Shape: {slug, what, why}.
 */
const MODIFIED = [];

module.exports = {MODIFIED};
