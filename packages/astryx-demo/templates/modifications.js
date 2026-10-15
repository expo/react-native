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
    slug: 'ai-chat',
    what: 'The artifact opens on request, using a dialog until both panes have room. Its panel leaves at least 400 points for the conversation.',
    why: 'Opening a 640-point panel automatically narrowed the conversation when the device unfolded.',
  },
  {
    slug: 'ide',
    what: 'The IDE keeps file search text and fits its editor and terminal inside the viewport.',
    why: 'The editor must share the available height with the resizable terminal instead of pushing it below the screen.',
  },
  {
    slug: 'kanban-board',
    what: 'The board opts into native horizontal safe-area scrolling. Its toolbar wraps inside the safe column.',
    why: 'Columns can pass beneath side controls while native content insets keep both resting edges unobscured. The toolbar stays clear of those controls when the page narrows.',
  },
  {
    slug: 'shell-top-nav',
    what: 'The mega-menu content fits its container and uses one column in a narrow drawer. Checkout uses its icon in a narrow navigation bar.',
    why: 'Fixed 520-point content overflowed the drawer, and the full checkout label crowded the menu toggle on narrow screens.',
  },
  {
    slug: 'payment-form',
    what: 'The order summary and checkout form use one column at every width.',
    why: 'The summary stays above the fields, keeping the demo readable in full-screen and fold panes.',
  },
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
