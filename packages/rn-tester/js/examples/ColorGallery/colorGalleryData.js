/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The colors, pictures and sampler the two color galleries share: each
 * space's chips, the fixtures with their expected patch values, and
 * `sampleAll`, which reads every registered point back in extended linear
 * sRGB through `ScreenshotManager.sample`.
 */

import {sample} from '../../../NativeModuleExample/NativeScreenshotManager';
import {Dimensions, Image, Platform} from 'react-native';

const rgb = (space, mid = '0.5 0.5 0.5') => [
  ['red', `color(${space} 1 0 0)`],
  ['green', `color(${space} 0 1 0)`],
  ['blue', `color(${space} 0 0 1)`],
  ['mid', `color(${space} ${mid})`],
  ['white', `color(${space} 1 1 1)`],
];
// PQ signals for 203 (SDR white), 406, 812 and 1000 cd/m²
const pq = space => [
  ['red', `color(${space} 0.5807 0 0)`],
  ['white', `color(${space} 0.5807 0.5807 0.5807)`],
  ['2×', `color(${space} 0.6542 0.6542 0.6542)`],
  ['4×', `color(${space} 0.7291 0.7291 0.7291)`],
  ['1000', `color(${space} 0.7518 0.7518 0.7518)`],
];
// HLG: 0.75 is reference white, 1 the peak
const hlg = space => [
  ['red', `color(${space} 0.75 0 0)`],
  ['mid', `color(${space} 0.5 0.5 0.5)`],
  ['white', `color(${space} 0.75 0.75 0.75)`],
  ['0.9', `color(${space} 0.9 0.9 0.9)`],
  ['peak', `color(${space} 1 1 1)`],
];
const linear = space => [
  ['red', `color(${space} 1 0 0)`],
  ['mid', `color(${space} 0.18 0.18 0.18)`],
  ['white', `color(${space} 1 1 1)`],
  ['2×', `color(${space} 2 2 2)`],
  ['4×', `color(${space} 4 4 4)`],
];
const PRIMARY = ['red', 'green', 'blue', 'mid', 'white'];
const fn = colors => colors.map((color, i) => [PRIMARY[i], color]);

const CSS_SPACES = [
  [
    'legacy',
    'hex and rgb(): the int path',
    fn(['#ff0000', '#00ff00', '#0000ff', 'rgb(119 119 119)', 'white']),
  ],
  ['srgb', 'the reference', rgb('srgb')],
  ['srgb-linear', 'linear: mid differs', rgb('srgb-linear')],
  ['display-p3', 'wider red, green', rgb('display-p3')],
  ['display-p3-linear', 'P3, linear', rgb('display-p3-linear')],
  ['a98-rgb', 'Adobe RGB', rgb('a98-rgb')],
  ['prophoto-rgb', 'clipped to display', rgb('prophoto-rgb')],
  ['rec2020', 'BT.2020, clipped', rgb('rec2020')],
  [
    'xyz-d65',
    '= srgb row',
    fn([
      'color(xyz-d65 0.4124 0.2126 0.0193)',
      'color(xyz-d65 0.3576 0.7152 0.1192)',
      'color(xyz-d65 0.1805 0.0722 0.9505)',
      'color(xyz-d65 0.2034 0.214 0.233)',
      'color(xyz-d65 0.9505 1 1.089)',
    ]),
  ],
  [
    'xyz-d50',
    '= srgb row',
    fn([
      'color(xyz-d50 0.4361 0.2225 0.0139)',
      'color(xyz-d50 0.3851 0.7169 0.0971)',
      'color(xyz-d50 0.1431 0.0606 0.7141)',
      'color(xyz-d50 0.2068 0.214 0.1765)',
      'color(xyz-d50 0.9642 1 0.8251)',
    ]),
  ],
  [
    'lab',
    'past sRGB',
    fn([
      'lab(54 95 75)',
      'lab(85 -120 90)',
      'lab(30 70 -120)',
      'lab(50 0 0)',
      'lab(100 0 0)',
    ]),
  ],
  [
    'lch',
    'past sRGB',
    fn([
      'lch(54 120 38)',
      'lch(85 150 143)',
      'lch(30 139 300)',
      'lch(50 0 0)',
      'lch(100 0 0)',
    ]),
  ],
  [
    'oklab',
    'past sRGB',
    fn([
      'oklab(0.65 0.25 0.14)',
      'oklab(0.87 -0.28 0.2)',
      'oklab(0.45 -0.03 -0.32)',
      'oklab(0.6 0 0)',
      'oklab(1 0 0)',
    ]),
  ],
  [
    'oklch',
    'past sRGB',
    fn([
      'oklch(0.65 0.29 29)',
      'oklch(0.87 0.34 144)',
      'oklch(0.45 0.32 265)',
      'oklch(0.6 0 0)',
      'oklch(1 0 0)',
    ]),
  ],
  ['rec2100-pq', 'red · white · 2× · 4× · 1000 nits', pq('rec2100-pq')],
  ['rec2100-hlg', 'red · mid · white · 0.9 · peak', hlg('rec2100-hlg')],
  ['rec2100-linear', 'red · mid · white · 2× · 4×', linear('rec2100-linear')],
];

const DASHED_SPACES = [
  ['--dci-p3', 'cinema P3', rgb('--dci-p3')],
  ['--rec709', 'HDTV', rgb('--rec709')],
  ['--aces-cg', 'linear, very wide', rgb('--aces-cg', '0.18 0.18 0.18')],
  ['--aces', 'ACES AP0, linear', rgb('--aces', '0.18 0.18 0.18')],
  ['--ntsc-1953', 'NTSC 1953', rgb('--ntsc-1953')],
  ['--smpte-c', 'SMPTE C', rgb('--smpte-c')],
  ['--rec2020-srgb-transfer', 'sRGB transfer', rgb('--rec2020-srgb-transfer')],
  ['--display-p3-pq', 'red · white · 2× · 4× · 1000', pq('--display-p3-pq')],
  [
    '--display-p3-hlg',
    'red · mid · white · 0.9 · peak',
    hlg('--display-p3-hlg'),
  ],
  ['--rec709-pq', 'red · white · 2× · 4× · 1000', pq('--rec709-pq')],
  ['--rec709-hlg', 'red · mid · white · 0.9 · peak', hlg('--rec709-hlg')],
  [
    '--gray-gamma-2.2',
    '0 · ¼ · ½ · ¾ · 1',
    [0, 0.25, 0.5, 0.75, 1].map(v => [
      String(v),
      `color(--gray-gamma-2.2 ${v})`,
    ]),
  ],
  [
    '--gray-linear',
    'linear 0 · ¼ · ½ · ¾ · 1',
    [0, 0.25, 0.5, 0.75, 1].map(v => [String(v), `color(--gray-linear ${v})`]),
  ],
];

// Required statically so Metro bundles them; `src` is the resolved URI, as
// `<img>` takes a URL
const PICTURES = [
  [
    require('../../assets/color/srgb-ramp.png'),
    'srgb-ramp.png',
    'sRGB · PNG · 8-bit',
  ],
  [
    require('../../assets/color/untagged.png'),
    'untagged.png',
    'untagged · PNG · 8-bit (shown as sRGB)',
  ],
  [
    require('../../assets/color/srgb-16bit.png'),
    'srgb-16bit.png',
    'sRGB · PNG · 16-bit',
  ],
  [
    require('../../assets/color/p3-primaries.png'),
    'p3-primaries.png',
    'Display P3 · PNG · 8-bit',
  ],
  [
    require('../../assets/color/p3-alpha.png'),
    'p3-alpha.png',
    'Display P3 · PNG · 8-bit · 50% alpha',
  ],
  [
    require('../../assets/color/p3-camera.jpg'),
    'p3-camera.jpg',
    'Display P3 · JPEG · 8-bit',
  ],
  [
    require('../../assets/color/p3.heic'),
    'p3.heic',
    'Display P3 · HEIC · 8-bit',
  ],
  [
    require('../../assets/color/p3-orient6.jpg'),
    'p3-orient6.jpg',
    'Display P3 · JPEG · EXIF orientation 6',
  ],
  [
    require('../../assets/color/adobe-rgb.jpg'),
    'adobe-rgb.jpg',
    'Adobe RGB (1998) · JPEG · 8-bit',
  ],
  [
    require('../../assets/color/prophoto-16.tif'),
    'prophoto-16.tif',
    'ProPhoto RGB · TIFF · 16-bit',
  ],
  [require('../../assets/color/cmyk.jpg'), 'cmyk.jpg', 'CMYK · JPEG · 8-bit'],
  [
    require('../../assets/color/gray-gamma22.png'),
    'gray-gamma22.png',
    'Gray gamma 2.2 · PNG · 8-bit',
  ],
  [
    require('../../assets/color/profile-broken.jpg'),
    'profile-broken.jpg',
    'corrupt ICC · JPEG (shown as sRGB)',
  ],
  [
    require('../../assets/color/p3-16bit-ramp.png'),
    'p3-16bit-ramp.png',
    'Display P3 · PNG · 16-bit ramp (no banding)',
  ],
  [
    require('../../assets/color/linear.exr'),
    'linear.exr',
    'linear sRGB · OpenEXR · 16-bit float',
  ],
  [
    require('../../assets/color/pq-cicp.png'),
    'pq-cicp.png',
    'BT.2100 PQ · PNG (cICP) · 16-bit · HDR · peak untagged, read as 1000',
  ],
  [
    require('../../assets/color/pq.heic'),
    'pq.heic',
    'BT.2100 PQ · HEIC · 10-bit · HDR · 4000-nit peak tagged',
  ],
  [
    require('../../assets/color/pq.avif'),
    'pq.avif',
    'BT.2100 PQ · AVIF · 10-bit · HDR · 4000-nit peak tagged',
  ],
  [
    require('../../assets/color/hlg.heic'),
    'hlg.heic',
    'BT.2100 HLG · HEIC · 10-bit · HDR',
  ],
  [
    require('../../assets/color/gainmap-iso.jpg'),
    'gainmap-iso.jpg',
    'Display P3 + ISO gain map · JPEG · HDR',
  ],
  [
    require('../../assets/color/gainmap-iso.heic'),
    'gainmap-iso.heic',
    'Display P3 + ISO gain map · HEIC · HDR',
  ],
  [
    require('../../assets/color/gainmap-orient6.heic'),
    'gainmap-orient6.heic',
    'gain map · HEIC · orientation 6 · HDR',
  ],
  [
    require('../../assets/color/gainmap-broken.jpg'),
    'gainmap-broken.jpg',
    'gain map cut off · JPEG (the SDR base)',
  ],
  [
    require('../../assets/color/gainmap-huge.jpg'),
    'gainmap-huge.jpg',
    'gain map · JPEG · 4096² · HDR',
  ],
].map(([asset, file, label]) => ({
  uri: Image.resolveAssetSource(asset).uri,
  file,
  label,
}));

const HDR_FILES = new Set([
  'gainmap-iso.jpg',
  'gainmap-iso.heic',
  'pq-cicp.png',
  'pq.avif',
  'pq.heic',
  'hlg.heic',
]);
const HDR_PICTURES = PICTURES.filter(p => HDR_FILES.has(p.file));

// Which image view backs `<img>` here, by the same probe the element uses,
// asked at render because the Expo runtime installs itself after this module
// loads
const imgBacking = (): string =>
  global.expo?.getViewConfig?.('ExpoImage') != null
    ? 'expo-image'
    : 'the framework image view';

/*
 * Each fixture's expected patches, in exact2's JSON: a patch is a rectangle
 * in the picture's own pixels and its value in extended linear sRGB. The
 * oriented fixtures give their patches in unrotated coordinates, so they are
 * left out of sampling.
 */
const EXPECTATIONS = {
  'srgb-ramp.png': require('../../assets/color/srgb-ramp.png.json'),
  'untagged.png': require('../../assets/color/untagged.png.json'),
  'srgb-16bit.png': require('../../assets/color/srgb-16bit.png.json'),
  'p3-primaries.png': require('../../assets/color/p3-primaries.png.json'),
  'p3-alpha.png': require('../../assets/color/p3-alpha.png.json'),
  'p3-camera.jpg': require('../../assets/color/p3-camera.jpg.json'),
  'p3.heic': require('../../assets/color/p3.heic.json'),
  'adobe-rgb.jpg': require('../../assets/color/adobe-rgb.jpg.json'),
  'prophoto-16.tif': require('../../assets/color/prophoto-16.tif.json'),
  'cmyk.jpg': require('../../assets/color/cmyk.jpg.json'),
  'gray-gamma22.png': require('../../assets/color/gray-gamma22.png.json'),
  'p3-16bit-ramp.png': require('../../assets/color/p3-16bit-ramp.png.json'),
  'linear.exr': require('../../assets/color/linear.exr.json'),
  'pq-cicp.png': require('../../assets/color/pq-cicp.png.json'),
  'pq.heic': require('../../assets/color/pq.heic.json'),
  'pq.avif': require('../../assets/color/pq.avif.json'),
  'hlg.heic': require('../../assets/color/hlg.heic.json'),
  'gainmap-iso.jpg': require('../../assets/color/gainmap-iso.jpg.json'),
  'gainmap-iso.heic': require('../../assets/color/gainmap-iso.heic.json'),
};

// Patch centres as fractions of the picture, with each patch's expectation
function patchTargets(file) {
  const patches = EXPECTATIONS[file]?.patches ?? [];
  const width = Math.max(0, ...patches.map(p => p.x + p.w));
  const height = Math.max(0, ...patches.map(p => p.y + p.h));
  return patches.map(p => ({
    at: [(p.x + p.w / 2) / width, (p.y + p.h / 2) / height],
    expected: p.linearSRGB,
  }));
}

// Every chip and picture registers its sample points, as fractions of its
// box, and what each should read
const TARGETS = new Map();
const target = (key, points) => element => {
  if (element == null) {
    TARGETS.delete(key);
  } else {
    TARGETS.set(key, {element, points});
  }
};

function measureInWindow(element) {
  return new Promise(resolve =>
    element.measureInWindow((x, y, width, height) =>
      resolve({x, y, width, height}),
    ),
  );
}

// One `COLOR_SAMPLE` line per target, since logcat cuts long lines
async function sampleAll(scrollView, contentHeight) {
  const window = Dimensions.get('window');
  const done = new Set();
  let count = 0;
  for (let y = 0; y < contentHeight; y += window.height / 2) {
    scrollView.scrollTo({y, animated: false});
    await new Promise(resolve => setTimeout(resolve, 500));
    const entries = [];
    for (const [key, {element, points}] of TARGETS) {
      if (done.has(key)) {
        continue;
      }
      const box = await measureInWindow(element);
      // Only the middle of the window, clear of the header and the tab bar
      if (
        box.y < window.height * 0.2 ||
        box.y + box.height > window.height * 0.75 ||
        box.width === 0
      ) {
        continue;
      }
      done.add(key);
      for (const point of points) {
        entries.push({
          key,
          expected: point.expected,
          at: [
            box.x + point.at[0] * box.width,
            box.y + point.at[1] * box.height,
          ],
        });
      }
    }
    if (entries.length === 0) {
      continue;
    }
    const result = await sample(entries.map(entry => entry.at));
    entries.forEach((entry, index) => {
      console.log(
        'COLOR_SAMPLE ' +
          JSON.stringify({
            platform: Platform.OS,
            space: result.space,
            key: entry.key,
            expected: entry.expected,
            got: result.values[index]?.map(v => Math.round(v * 10000) / 10000),
          }),
      );
    });
    count += entries.length;
  }
  scrollView.scrollTo({y: 0, animated: false});
  return count;
}

export {
  CSS_SPACES,
  DASHED_SPACES,
  EXPECTATIONS,
  HDR_PICTURES,
  PICTURES,
  imgBacking,
  patchTargets,
  sampleAll,
  target,
};
