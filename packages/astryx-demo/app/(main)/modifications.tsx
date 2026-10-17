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

/** Show recorded template changes and the services supplied by the native host. */
export default function Modifications(): React.Node {
  return (
    <AppPage>
      <VStack gap={3}>
        <Heading level={1}>Modifications</Heading>
        <Text color="secondary">
          {templates.length} templates from Astryx {astryxVersion}. The sync
          script checks that every change from upstream is documented here.
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
          The app provides the assets, theme and page environment that a web
          host normally supplies.
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
      'Referenced images are bundled with the app and resolved from their ' +
      'original root-relative paths. Photos are resized for mobile displays; ' +
      'logos retain their transparency.',
  },
  {
    what: "Astryx's stylesheets",
    how:
      "The host installs Astryx's reset and built neutral theme for every page, " +
      'including light and dark appearances.',
  },
  {
    what: 'The page',
    how:
      'Each template receives its own viewport and safe-area environment, ' +
      'sized to the available column. The host paints the page background ' +
      'through the surrounding insets and lets longer pages scroll.',
  },
  {
    what: 'The font',
    how:
      'Figtree is bundled in the weights and italic styles used by the ' +
      'neutral theme, under the SIL Open Font License.',
  },
  {
    what: 'Native navigation',
    how:
      'The gallery and detail screen share native navigation. The optional ' +
      'sidebar keeps the selected template highlighted, and the system ' +
      'controls fold and size-class transitions.',
  },
];
