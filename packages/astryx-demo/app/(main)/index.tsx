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
import {useHorizontalSizeClass} from '../../src/sizeClass';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import thumbnails from '../../src/thumbnails';
import {Link} from 'expo-router';
import * as React from 'react';
import {useColorScheme, useWindowDimensions} from 'react-native';

/**
 * The grid of templates, under the stack's large title. Each tile is an Expo
 * Router link with a preview, so a long press peeks the template and a tap, or
 * a harder press, pops into it. The scroll view is the screen, as on the
 * template screen, so it reaches the bottom edge and holds the content clear
 * of the home indicator with an inset; the host inside it paints the surface
 * behind the grid and ends where the tiles end: a surface stretched to the
 * viewport, as a template's is, would add the header's height of blank page
 * below the last row.
 */
export default function Home(): React.Node {
  // The preview platter takes its size from `Link.Preview`'s style, zero by
  // default, which would shrink the platter to the template's first word
  const window = useWindowDimensions();
  const sizeClass = useHorizontalSizeClass();
  const previewStyle = React.useMemo(
    () => ({width: window.width - 32, height: Math.round(window.height * 0.6)}),
    [window.width, window.height],
  );
  const appearance = useColorScheme() === 'dark' ? 'dark' : 'light';
  if (sizeClass === 'regular') {
    // The split view's sidebar holds the list; this column waits for a choice
    return (
      <AstryxHost>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 24,
          }}>
          <EmptyState
            title="Choose a template"
            description="Pick one of Astryx's page templates from the sidebar."
          />
        </div>
      </AstryxHost>
    );
  }
  return (
    <AppPage>
      <VStack gap={4}>
        <Grid columns={2} gap={3}>
          {templates.map(t => (
            // `minWidth: 0` because the fork sizes a `1fr` track's automatic
            // minimum from the item's max-content width, not its min-content
            // width, so a tile with a long category name would widen its
            // column past the screen; see DOM-CSS-LIMITATION(grid-min-content).
            // `overflow: hidden` because the link lays its peek preview out
            // here, absolutely, at the preview's full height: the platform
            // takes the view for the platter, but its layout stayed in the
            // page and gave the last row's preview 117 points of scroll range
            // below the page
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
        </Grid>
        <Link href="/modifications">
          <Text color="secondary">
            Modifications to the templates: {modifications.length}
          </Text>
        </Link>
      </VStack>
    </AppPage>
  );
}

/**
 * A tile is the catalog's `<button>`: the press is drawn by the platform the
 * moment the finger lands (the dim on iOS, the ripple on Android), with no
 * render in between, and it activates on the release like any button. The
 * link's trigger hands it `onPress`; a `<button>` speaks `onClick`. The
 * button's own chrome — platform padding, background, the touch-target
 * minimum — is withdrawn so the Card is the whole tile.
 */
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

// A picture of the template's top, the tile's width, at the aspect the
// screenshots were cut to
// A hairline frames the picture, since a white page on a white tile has no
// edge of its own
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
  const page = React.useMemo(() => <Template />, [Template]);
  // The surface first, the template a frame later, so the platter has
  // something to open on while a page that takes long to render (File
  // Explorer) renders; the surface is told its size, so it renders once
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const handle = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(handle);
  }, []);
  return <AstryxHost initialSize={size}>{ready ? page : null}</AstryxHost>;
}

const tileStyle = {minWidth: 0, overflow: 'hidden'};
