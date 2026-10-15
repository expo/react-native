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
 * The web version of the templates, bundled into the app: Astryx's own
 * template viewer (`apps/template-viewer`, a Vite app that renders any
 * template under `packages/cli/assets/templates` at the URL path naming its
 * directory), built with relative asset paths into `web/`, which the iOS
 * project copies into the bundle and `modules/template-web` serves to a web
 * view through the `astryx-web:` scheme.
 *
 * What the build does not carry comes from the app: the images the templates
 * reference by root-relative path are the app's own resized copies
 * (`template-assets/`), and Figtree, which the docsite loads from Google
 * Fonts, is the app's bundled font, declared in an `@font-face` block.
 *
 *   node scripts/sync-web.js            build and copy
 *   node scripts/sync-web.js --check    fail if web/ is missing or incomplete
 */

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const checkout =
  process.env.ASTRYX_CHECKOUT ??
  path.resolve(__dirname, '../../../../astryx-upstream');
const viewer = path.join(checkout, 'apps/template-viewer');
const out = path.resolve(__dirname, '../web');
const assets = path.resolve(__dirname, '../template-assets');
const fonts = path.resolve(__dirname, '../ios/AstryxDemo/Fonts');

const FONT_FACES = [
  ['Figtree-Regular', 400, 'normal'],
  ['Figtree-Italic', 400, 'italic'],
  ['Figtree-Medium', 500, 'normal'],
  ['Figtree-MediumItalic', 500, 'italic'],
  ['Figtree-SemiBold', 600, 'normal'],
  ['Figtree-SemiBoldItalic', 600, 'italic'],
  ['Figtree-Bold', 700, 'normal'],
  ['Figtree-BoldItalic', 700, 'italic'],
];

function main() {
  if (process.argv.includes('--check')) {
    check();
    return;
  }
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-web-'));
  // The viewer's own config, but with Astryx's components in the library
  // layer. The build plugin recognises library files by
  // `node_modules/@astryxdesign/` in their path; in the checkout the viewer
  // compiles core from `packages/core`, so every component rule landed in
  // `product`, the last layer, above the theme's `astryx-theme` overrides — a
  // `display-2` heading drew at the display weight (400) where the docsite and
  // an installed package draw the theme's level-1 weight (600). The docsite's
  // public directory (149 MB of originals) is left out; see below.
  const config = path.join(viewer, 'vite.config.astryx-demo.mjs');
  fs.writeFileSync(
    config,
    `import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {astryxStylex} from '@astryxdesign/build/vite';

export default defineConfig({
  plugins: [...astryxStylex({libraryPattern: '/packages/core/'}), react()],
  publicDir: false,
  server: {fs: {allow: ['../..']}},
});
`,
  );
  try {
    childProcess.execFileSync(
      'pnpm',
      [
        'exec',
        'vite',
        'build',
        '--config',
        config,
        '--base',
        './',
        '--outDir',
        dist,
        '--emptyOutDir',
      ],
      {cwd: viewer, stdio: 'inherit'},
    );
  } finally {
    fs.rmSync(config, {force: true});
  }
  fs.rmSync(out, {recursive: true, force: true});
  fs.mkdirSync(path.join(out, 'template-assets'), {recursive: true});
  fs.mkdirSync(path.join(out, 'fonts'));
  fs.cpSync(path.join(dist, 'assets'), path.join(out, 'assets'), {
    recursive: true,
  });
  // The templates' images: the app's own copies rather than the docsite's
  // originals the viewer's public directory brings (149 MB)
  for (const name of fs.readdirSync(assets)) {
    fs.copyFileSync(
      path.join(assets, name),
      path.join(out, 'template-assets', name),
    );
  }
  for (const [file] of FONT_FACES) {
    fs.copyFileSync(
      path.join(fonts, `${file}.ttf`),
      path.join(out, 'fonts', `${file}.ttf`),
    );
  }
  const faces = FONT_FACES.map(
    ([file, weight, style]) =>
      `@font-face{font-family:Figtree;font-weight:${weight};font-style:${style};font-display:block;src:url(./fonts/${file}.ttf) format("truetype")}`,
  ).join('\n');
  const html = fs
    .readFileSync(path.join(dist, 'index.html'), 'utf8')
    .replace('</head>', `    <style>\n${faces}\n    </style>\n  </head>`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.rmSync(dist, {recursive: true, force: true});
  console.log(
    `web/: ${fs.readdirSync(path.join(out, 'assets')).length} assets, ${fs.readdirSync(path.join(out, 'template-assets')).length} images, ${FONT_FACES.length} fonts`,
  );
}

function check() {
  const index = path.join(out, 'index.html');
  if (!fs.existsSync(index)) {
    console.error('web/index.html is missing: run `node scripts/sync-web.js`');
    process.exit(1);
  }
  const html = fs.readFileSync(index, 'utf8');
  for (const [file] of FONT_FACES) {
    if (
      !html.includes(`./fonts/${file}.ttf`) ||
      !fs.existsSync(path.join(out, 'fonts', `${file}.ttf`))
    ) {
      console.error(
        `web/ lacks the ${file} face: run \`node scripts/sync-web.js\``,
      );
      process.exit(1);
    }
  }
  const missing = fs
    .readdirSync(assets)
    .filter(name => !fs.existsSync(path.join(out, 'template-assets', name)));
  if (missing.length > 0) {
    console.error(
      `web/template-assets lacks ${missing.join(', ')}: run \`node scripts/sync-web.js\``,
    );
    process.exit(1);
  }
  console.log('web/ is complete');
}

main();
