/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

// The Android app: the same templates, the same host, a plain shell in place
// of Expo Router (whose native modules are iOS-only here) — a list of the
// templates, a template screen, and the `astryxdemo://template/<slug>` deep
// links the sweeps use. The element catalog must register before anything
// renders; see index.js for the rest of this order.
import '../expo-intrinsics/src/index';
import '../rn-tester/js/astryx/document-shim';
import '../rn-tester/js/astryx/dom-compat';
import './src/templateAssets';

import {registerFrameworkComponent} from '../expo-intrinsics/src/ElementRegistry';
import {
  EngineSvg,
  SvgCircle,
  SvgLine,
  SvgPath,
  SvgRect,
} from '../rn-tester/js/astryx/svg/Svg';
import AndroidDetail, {AndroidCatalog} from './src/AndroidApp';
import {AppRegistry} from 'react-native';

registerFrameworkComponent('svg', EngineSvg);
registerFrameworkComponent('path', SvgPath);
registerFrameworkComponent('circle', SvgCircle);
registerFrameworkComponent('rect', SvgRect);
registerFrameworkComponent('line', SvgLine);

AppRegistry.registerComponent('AstryxCatalog', () => AndroidCatalog);
AppRegistry.registerComponent('AstryxDetail', () => AndroidDetail);
