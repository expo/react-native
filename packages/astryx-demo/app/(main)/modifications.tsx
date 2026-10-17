/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import AppPage from '../../src/AppPage';
import {astryxVersion, modifications, templates} from '../../src/templates';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import * as React from 'react';

/**
 * Every way a shipped template differs from Astryx's source, from
 * templates/modifications.js. The list is meant to stay empty.
 */
export default function Modifications(): React.Node {
  return (
    <AppPage>
      <VStack gap={3}>
        <Heading level={1}>Modifications</Heading>
        <Text color="secondary">
          {templates.length} templates from Astryx {astryxVersion}, copied byte
          for byte by scripts/sync-templates.js, which fails on any template
          that drifts from upstream without an entry here.
        </Text>
        {modifications.length === 0 ? (
          <Card>
            <Text>None. Every template runs as Astryx publishes it.</Text>
          </Card>
        ) : (
          modifications.map(m => (
            <Card key={m.slug + m.what}>
              <VStack gap={1}>
                <Text weight="semibold">{m.slug}</Text>
                <Text>{m.what}</Text>
                <Text color="secondary">{m.why}</Text>
              </VStack>
            </Card>
          ))
        )}
        <Heading level={2}>What the app supplies</Heading>
        <Text color="secondary">
          Not changes to the templates, but what a page gets from its host on
          the web and has to get from this app instead.
        </Text>
        {SUPPLIED.map(item => (
          <Card key={item.what}>
            <VStack gap={1}>
              <Text weight="semibold">{item.what}</Text>
              <Text color="secondary">{item.how}</Text>
            </VStack>
          </Card>
        ))}
      </VStack>
    </AppPage>
  );
}

const SUPPLIED = [
  {
    what: 'The template images',
    how:
      'The templates show images by root-relative path (/template-assets/…), ' +
      "which Astryx's docsite serves from its public directory. The app bundles " +
      'the 56 files the templates reference (template-assets/), resized to ' +
      'phone width and re-encoded as JPEG (the logos keep their PNG ' +
      'transparency), and resolves the paths to them ' +
      '(src/templateAssets.js).',
  },
  {
    what: "Astryx's stylesheets",
    how:
      "Astryx's reset (reset.css) and the built neutral theme (theme.css), which " +
      'a web app imports globally and the docsite applies to every page; the ' +
      'host installs both in the CSS engine. The theme is the one ' +
      '`astryx theme build` generates from the published sources.',
  },
  {
    what: 'The page',
    how:
      "The templates render transparent, content only. The host paints the theme's " +
      'surface colour behind them and gives the page root a definite height, as the ' +
      'docsite\'s preview frame does, so a Layout of height "fill" scrolls its ' +
      'content and an auto-height page grows past it. The viewport is the ' +
      'screen below the bar and above the home indicator, as a ' +
      "browser's ends above its toolbar (src/AstryxHost.tsx).",
  },
  {
    what: 'The font',
    how:
      "The neutral theme's type is Figtree, which the docsite loads from Google " +
      'Fonts. The app bundles it (ios/AstryxDemo/Fonts and ' +
      'android/app/src/main/res/font, SIL Open Font License) at the four ' +
      'weights the theme uses, upright and italic, cut from the variable font; ' +
      'without it the templates fall back to the system font and wrap their ' +
      'headings differently.',
  },
  {
    what: 'The platform variable',
    how:
      'Expo Router expects babel-preset-expo to have inlined process.env.EXPO_OS; ' +
      "this app compiles with React Native's preset and sets it at startup (expo-os.js).",
  },
];
