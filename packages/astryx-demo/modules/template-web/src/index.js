/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {requireNativeViewManager} from 'expo-modules-core';

/**
 * The web version of a template: Astryx's template viewer, bundled into the
 * app (`web/`, from `scripts/sync-web.js`), in a web view. iOS only.
 *
 * @param slug the template's slug, which is also its directory upstream.
 */
export const TemplateWebView = requireNativeViewManager('TemplateWeb');
