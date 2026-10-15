/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {Image} from 'react-native';

// A picture of each template for its tile on the grid: a band of the page
// as the app renders it on an iPhone, in both appearances, cut from
// simulator screenshots below the header, where the template shows its
// pictures if it has any. Metro bundles what `require` names, so the map is
// written out.
const modules = {
  blank: {
    light: require('./blank.jpg'),
    dark: require('./blank-dark.jpg'),
  },
  'centered-hero': {
    light: require('./centered-hero.jpg'),
    dark: require('./centered-hero-dark.jpg'),
  },
  'classic-gallery': {
    light: require('./classic-gallery.jpg'),
    dark: require('./classic-gallery-dark.jpg'),
  },
  documentation: {
    light: require('./documentation.jpg'),
    dark: require('./documentation-dark.jpg'),
  },
  'gallery-hero': {
    light: require('./gallery-hero.jpg'),
    dark: require('./gallery-hero-dark.jpg'),
  },
  'mixed-gallery': {
    light: require('./mixed-gallery.jpg'),
    dark: require('./mixed-gallery-dark.jpg'),
  },
  'product-gallery': {
    light: require('./product-gallery.jpg'),
    dark: require('./product-gallery-dark.jpg'),
  },
  'side-gallery': {
    light: require('./side-gallery.jpg'),
    dark: require('./side-gallery-dark.jpg'),
  },
  login: {
    light: require('./login.jpg'),
    dark: require('./login-dark.jpg'),
  },
  'login-card': {
    light: require('./login-card.jpg'),
    dark: require('./login-card-dark.jpg'),
  },
  'login-split': {
    light: require('./login-split.jpg'),
    dark: require('./login-split-dark.jpg'),
  },
  'login-sso': {
    light: require('./login-sso.jpg'),
    dark: require('./login-sso-dark.jpg'),
  },
  'file-explorer': {
    light: require('./file-explorer.jpg'),
    dark: require('./file-explorer-dark.jpg'),
  },
  'product-detail': {
    light: require('./product-detail.jpg'),
    dark: require('./product-detail-dark.jpg'),
  },
  library: {
    light: require('./library.jpg'),
    dark: require('./library-dark.jpg'),
  },
  settings: {
    light: require('./settings.jpg'),
    dark: require('./settings-dark.jpg'),
  },
  'settings-sidebar': {
    light: require('./settings-sidebar.jpg'),
    dark: require('./settings-sidebar-dark.jpg'),
  },
  'form-two-column': {
    light: require('./form-two-column.jpg'),
    dark: require('./form-two-column-dark.jpg'),
  },
  'detail-page': {
    light: require('./detail-page.jpg'),
    dark: require('./detail-page-dark.jpg'),
  },
  'form-wizard-inline': {
    light: require('./form-wizard-inline.jpg'),
    dark: require('./form-wizard-inline-dark.jpg'),
  },
  'contact-form': {
    light: require('./contact-form.jpg'),
    dark: require('./contact-form-dark.jpg'),
  },
  table: {
    light: require('./table.jpg'),
    dark: require('./table-dark.jpg'),
  },
  'kanban-board': {
    light: require('./kanban-board.jpg'),
    dark: require('./kanban-board-dark.jpg'),
  },
  'shell-side-nav': {
    light: require('./shell-side-nav.jpg'),
    dark: require('./shell-side-nav-dark.jpg'),
  },
  'shell-top-nav': {
    light: require('./shell-top-nav.jpg'),
    dark: require('./shell-top-nav-dark.jpg'),
  },
  ide: {
    light: require('./ide.jpg'),
    dark: require('./ide-dark.jpg'),
  },
  'table-page': {
    light: require('./table-page.jpg'),
    dark: require('./table-page-dark.jpg'),
  },
  'table-tree': {
    light: require('./table-tree.jpg'),
    dark: require('./table-tree-dark.jpg'),
  },
  editor: {
    light: require('./editor.jpg'),
    dark: require('./editor-dark.jpg'),
  },
  'payment-form': {
    light: require('./payment-form.jpg'),
    dark: require('./payment-form-dark.jpg'),
  },
  'checkout-wizard': {
    light: require('./checkout-wizard.jpg'),
    dark: require('./checkout-wizard-dark.jpg'),
  },
  'form-wizard': {
    light: require('./form-wizard.jpg'),
    dark: require('./form-wizard-dark.jpg'),
  },
  'settings-dialog': {
    light: require('./settings-dialog.jpg'),
    dark: require('./settings-dialog-dark.jpg'),
  },
  'work-item-detail': {
    light: require('./work-item-detail.jpg'),
    dark: require('./work-item-detail-dark.jpg'),
  },
  'documentation-technical': {
    light: require('./documentation-technical.jpg'),
    dark: require('./documentation-technical-dark.jpg'),
  },
  'ai-chat': {
    light: require('./ai-chat.jpg'),
    dark: require('./ai-chat-dark.jpg'),
  },
  'ai-chat-landing': {
    light: require('./ai-chat-landing.jpg'),
    dark: require('./ai-chat-landing-dark.jpg'),
  },
  'shell-nav': {
    light: require('./shell-nav.jpg'),
    dark: require('./shell-nav-dark.jpg'),
  },
  'documentation-design': {
    light: require('./documentation-design.jpg'),
    dark: require('./documentation-design-dark.jpg'),
  },
  'canvas-editor': {
    light: require('./canvas-editor.jpg'),
    dark: require('./canvas-editor-dark.jpg'),
  },
  'form-wizard-dialog': {
    light: require('./form-wizard-dialog.jpg'),
    dark: require('./form-wizard-dialog-dark.jpg'),
  },
  'table-inbox': {
    light: require('./table-inbox.jpg'),
    dark: require('./table-inbox-dark.jpg'),
  },
  'form-wizard-vertical': {
    light: require('./form-wizard-vertical.jpg'),
    dark: require('./form-wizard-vertical-dark.jpg'),
  },
  'table-filter': {
    light: require('./table-filter.jpg'),
    dark: require('./table-filter-dark.jpg'),
  },
};

// Resolved to `{uri, width, height, scale}` as the template images are (see
// templateAssets.js): `<img>` chooses among source objects and does not
// resolve a bare asset number
module.exports = Object.fromEntries(
  Object.entries(modules).map(([slug, {light, dark}]) => [
    slug,
    {
      light: Image.resolveAssetSource(light),
      dark: Image.resolveAssetSource(dark),
    },
  ]),
);
