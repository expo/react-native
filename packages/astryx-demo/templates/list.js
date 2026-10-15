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

// The page templates this app ships, by their directory under Astryx's
// `packages/cli/assets/templates/pages`. These are the templates whose every
// component and CSS feature the fork supports today (tiers A to C of the
// 2026-10-14 survey); the rest wait on table layout, `:has()` and the
// components a template draws its own way.
const TEMPLATES = [
  'blank',
  'centered-hero',
  'classic-gallery',
  'documentation',
  'gallery-hero',
  'mixed-gallery',
  'product-gallery',
  'side-gallery',
  'login',
  'login-card',
  'login-split',
  'login-sso',
  'file-explorer',
  // Tier C of the survey: every component vendored, and the gaps they needed
  // closed: popovers hidden until shown, `matchMedia`, a grid or block sized to
  // fit its column, icons coloured through the runtime
  'product-detail',
  'library',
  'settings',
  'settings-sidebar',
  'form-two-column',
  'detail-page',
  'form-wizard-inline',
  'contact-form',
  'table',
  'kanban-board',
  // Tier D, in the survey's order, without the dashboards (recharts), the
  // three pages Astryx's own viewer has no live preview for (Messaging Shell,
  // Incident Console, Theme Showcase) and Grouped Table, which does not open
  'shell-side-nav',
  'shell-top-nav',
  'ide',
  'table-page',
  'table-tree',
  'editor',
  'payment-form',
  'checkout-wizard',
  'form-wizard',
  'settings-dialog',
  'work-item-detail',
  'documentation-technical',
  'ai-chat',
  'ai-chat-landing',
  'shell-nav',
  'documentation-design',
  'canvas-editor',
  'form-wizard-dialog',
  'table-inbox',
  'form-wizard-vertical',
  'table-filter',
];

module.exports = {TEMPLATES};
