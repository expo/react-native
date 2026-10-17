/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

// First, before any Expo module evaluates: the platform variable Expo Router
// expects babel-preset-expo to have inlined; see the file
import './expo-os';

// Must come before anything renders: it registers the elements' view configs.
// Rendering an element before its config is registered fails with "View config
// getter callback ... must be a function".
import '../expo-intrinsics/src/index';

// The `document` the vendored Astryx sources reach for (the theme provider
// injects its CSS through one); see the file
import '../rn-tester/js/astryx/document-shim';
// The DOM methods the vendored sources call on their element refs; see the file
import '../rn-tester/js/astryx/dom-compat';

// The images the templates reference by root-relative path; see the file
import './src/templateAssets';

import {registerFrameworkComponent} from '../expo-intrinsics/src/ElementRegistry';
import {
  EngineSvg,
  SvgCircle,
  SvgLine,
  SvgPath,
  SvgRect,
} from '../rn-tester/js/astryx/svg/Svg';

// The SVG elements under their bare tags, for an `<svg>` built with React's
// own `createElement` outside the Astryx runtime (Metro hands the vendored
// sources and the icon packages `react-with-runtime.js`, which maps the tags
// as the runtime does): the engine's `<svg>`, which paints with the colour the
// engine resolved for it.
registerFrameworkComponent('svg', EngineSvg);
registerFrameworkComponent('path', SvgPath);
registerFrameworkComponent('circle', SvgCircle);
registerFrameworkComponent('rect', SvgRect);
registerFrameworkComponent('line', SvgLine);

// Expo Router's entry registers the root component under the name `main`,
// which SceneDelegate.mm starts.
import 'expo-router/entry';
