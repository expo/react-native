/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * Stylesheets as the Astryx runtime installs them, in the renderer's style
 * engine, which owns the cascade; and the context the DOM shim's selector
 * matching reads.
 */

import type {MatchContext} from './match';

import {
  addStyleSheet as addEngineStyleSheet,
  removeStyleSheet as removeEngineStyleSheet,
  replaceStyleSheet as replaceEngineStyleSheet,
} from '../native-css/engine';
import {Appearance} from 'react-native';

export {VIEWPORT_BLOCK_SIZE, VIEWPORT_INLINE_SIZE} from './match';
export type {ElementDescriptor} from './match';

/** An installed sheet, which its caller replaces or removes by this handle */
export opaque type Stylesheet = {readonly id: number};

// Exported for dom-compat.js and document-shim.js, whose selector matching
// answers a `.dark` root class from the appearance
export function currentContext(): MatchContext {
  return {schemeIsDark: Appearance.getColorScheme() === 'dark'};
}

/**
 * Installs a stylesheet. Later sheets cascade after earlier ones, exactly like
 * a later `<link>`. Idempotence is the caller's concern.
 */
export function installStylesheet(css: string): Stylesheet {
  return {id: addEngineStyleSheet(css)};
}

/**
 * Removes an installed sheet, as removing a `<style>` from the document drops
 * its rules (CSSOM §6.1). The keyframes it declared stay registered under
 * their names.
 */
export function removeStylesheet(sheet: Stylesheet): void {
  removeEngineStyleSheet(sheet.id);
}

/**
 * Replaces an installed sheet's rules with `css` in the same cascade position,
 * as a `<style>` whose text changes keeps its place in the document. Returns
 * the sheet, which later replacements and removals take.
 */
export function replaceStylesheet(sheet: Stylesheet, css: string): Stylesheet {
  replaceEngineStyleSheet(sheet.id, css);
  return sheet;
}
