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
import AstryxHost from '../../src/AstryxHost';
import {modifications, templateComponent, templates} from '../../src/templates';
import {galleryPreviewSize} from '../../src/galleryLayout';
import GalleryGrid from '../../src/GalleryGrid';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import thumbnails from '../../src/thumbnails';
import {Link} from 'expo-router';
import * as React from 'react';
import {useColorScheme, useWindowDimensions} from 'react-native';

/** Browse templates, long-press for a preview, or tap to open the detail screen. */
export default function Home(): React.Node {
  // Give previews a document-shaped size, independent of their content.
  const window = useWindowDimensions();
  const previewStyle = React.useMemo(
    () => galleryPreviewSize(window.width, window.height),
    [window.width, window.height],
  );
  const appearance = useColorScheme() === 'dark' ? 'dark' : 'light';
  // The tiles follow the appearance and the preview size alone: a fold or a
  // sidebar change re-lays the grid out, and a re-render of the screen leaves
  // the tiles as they are.
  const grid = React.useMemo(
    () => (
      <GalleryGrid>
        {templates.map(t => (
          // Keep tracks shrinkable and clip previews to their tile bounds.
          <div key={t.slug} style={tileStyle}>
            <Link href={`/template/${t.slug}`} asChild>
              <Link.Trigger>
                <TileButton>
                  <Card>
                    <VStack gap={2}>
                      {thumbnails[t.slug] != null ? (
                        <img
                          source={thumbnails[t.slug][appearance]}
                          alt=""
                          style={tileImageStyle}
                        />
                      ) : null}
                      <Text weight="semibold">{t.name}</Text>
                      <Text size="small" color="secondary">
                        {t.category}
                      </Text>
                    </VStack>
                  </Card>
                </TileButton>
              </Link.Trigger>
              <Link.Preview style={previewStyle}>
                <TemplatePreview slug={t.slug} size={previewStyle} />
              </Link.Preview>
            </Link>
          </div>
        ))}
      </GalleryGrid>
    ),
    [appearance, previewStyle],
  );
  return (
    <AppPage>
      <VStack gap={4}>
        {grid}
        <Link href="/modifications">
          <Text color="secondary">
            Modifications to the templates: {modifications.length}
          </Text>
        </Link>
      </VStack>
    </AppPage>
  );
}

/** Adapt Link.Trigger's onPress to a native button with Card-owned chrome. */
function TileButton({
  onPress,
  children,
}: {
  onPress?: (event: unknown) => unknown;
  children: React.Node;
}): React.Node {
  return (
    <button type="button" onClick={onPress} style={tileButtonStyle}>
      {children}
    </button>
  );
}

// Preserve the thumbnail aspect ratio and outline light pages on light tiles.
const tileImageStyle = {
  display: 'block',
  width: '100%',
  aspectRatio: '540 / 403',
  objectFit: 'cover',
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--color-border)',
};

const tileButtonStyle = {
  display: 'block',
  width: '100%',
  minHeight: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
};

function TemplatePreview({
  slug,
  size,
}: {
  slug: string;
  size: {width: number; height: number};
}): React.Node {
  const Template = templateComponent(slug);
  // Render the preview page and its sized host together.
  return (
    <AstryxHost initialSize={size}>
      <Template />
    </AstryxHost>
  );
}

const tileStyle = {minWidth: 0, overflow: 'hidden'};
