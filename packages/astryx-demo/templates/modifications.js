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
const MODIFIED = [
  {
    slug: 'settings-dialog',
    what:
      'The tab strip of the narrow dialog and its tabs do not shrink ' +
      '(`flexShrink: 0`), so the strip scrolls sideways.',
    why:
      'The strip is a scroll container, whose automatic minimum height is 0, ' +
      'so a long panel took its height and covered the bottom of the tabs. ' +
      'Each Button sets `min-width: 0` to truncate its label, so the row ' +
      'squeezed the tabs narrower than their icons and padding: the labels ' +
      'were cut and the selected background sat off its icon. Both happen in ' +
      'browsers too.',
  },
];

module.exports = {MODIFIED};
