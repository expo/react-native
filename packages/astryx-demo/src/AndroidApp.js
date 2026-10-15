/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import NativePageScroll, {
  usePageViewport,
} from '../../expo-intrinsics/src/NativePageScroll';
import NativeSafeArea from '../../expo-intrinsics/src/NativeSafeArea';
import navigation from '../../rn-tester/js/astryx/native-screen/NativePaneController';
import AstryxHost from './AstryxHost';
import GalleryGrid from './GalleryGrid';
import {GALLERY_COLUMNS} from './galleryLayout';
import {SELECTED_TEMPLATE_STYLE} from './sidebarSelection';
import {templateComponent, templateInfo, templates} from './templates';
import {Card} from '@astryxdesign/core/Card';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import * as React from 'react';
import {
  DeviceEventEmitter,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

// Both native fragments share this runtime and selection; switching a demo never
// replaces a fragment or navigation screen.
const navigationConstants = navigation.getConstants();
let currentSlug = null;
let twoPane = navigationConstants.twoPane ?? false;
let canToggleSidebar = navigationConstants.canToggleSidebar ?? false;
let galleryDivision = navigationConstants.galleryFold
  ? {
      x: navigationConstants.divisionStart,
      width: navigationConstants.divisionWidth,
    }
  : null;
const listeners = new Set();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function select(slug) {
  currentSlug = slug;
  notify();
  navigation.openDetail();
}
DeviceEventEmitter.addListener('astryxPaneMode', event => {
  twoPane = event.twoPane;
  canToggleSidebar = event.canToggleSidebar;
  galleryDivision = event.galleryFold
    ? {x: event.divisionStart, width: event.divisionWidth}
    : null;
  notify();
});

export function AndroidCatalog(): React.Node {
  const slug = React.useSyncExternalStore(subscribe, () => currentSlug);
  React.useEffect(() => {
    const open = url => {
      const match = url == null ? null : /template\/([a-z0-9-]+)/.exec(url);
      if (match != null) select(match[1]);
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', ({url}) => open(url));
    return () => sub.remove();
  }, []);
  return <CatalogScreen onSelect={select} selectedSlug={slug} />;
}

export default function AndroidDetail(): React.Node {
  const slug = React.useSyncExternalStore(subscribe, () => currentSlug);
  const split = React.useSyncExternalStore(subscribe, () => twoPane);
  if (slug == null) {
    return <View style={styles.empty} />;
  }
  return (
    <TemplateScreen
      slug={slug}
      showBack={!split}
      onBack={() => navigation.closeDetail()}
    />
  );
}

function SidebarToggle(): React.Node {
  const available = React.useSyncExternalStore(
    subscribe,
    () => canToggleSidebar,
  );
  const split = React.useSyncExternalStore(subscribe, () => twoPane);
  return available ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={split ? 'Hide sidebar' : 'Show sidebar'}
      onPress={() => navigation.toggleSidebar()}>
      <Text>{split ? 'Hide sidebar' : 'Show sidebar'}</Text>
    </Pressable>
  ) : null;
}

function CatalogScreen({
  onSelect,
  selectedSlug,
}: {
  onSelect: (slug: string) => void,
  selectedSlug: ?string,
}): React.Node {
  const [viewport, onViewport] = usePageViewport();
  const split = React.useSyncExternalStore(subscribe, () => twoPane);
  const division = React.useSyncExternalStore(subscribe, () => galleryDivision);
  return (
    <NativePageScroll onContentViewportChange={onViewport}>
      <AstryxHost viewport={viewport} fill={false}>
        <div style={styles.list}>
          <VStack gap={3}>
            <HStack hAlign="between" vAlign="center">
              <Heading level={1}>Astryx</Heading>
              <SidebarToggle />
            </HStack>
            <GalleryGrid
              columns={split ? 1 : GALLERY_COLUMNS}
              division={division}>
              {templates.map(t => (
                <Pressable
                  key={t.slug}
                  onPress={() => onSelect(t.slug)}
                  accessibilityState={{selected: selectedSlug === t.slug}}>
                  <Card
                    style={
                      selectedSlug === t.slug
                        ? SELECTED_TEMPLATE_STYLE
                        : undefined
                    }>
                    <VStack gap={1}>
                      <Text weight="semibold">{t.name}</Text>
                      <Text size="small" color="secondary">
                        {t.category}
                      </Text>
                    </VStack>
                  </Card>
                </Pressable>
              ))}
            </GalleryGrid>
          </VStack>
        </div>
      </AstryxHost>
    </NativePageScroll>
  );
}
function TemplateScreen({
  slug,
  onBack,
  showBack,
}: {
  slug: string,
  onBack: () => void,
  showBack: boolean,
}): React.Node {
  const Template = templateComponent(slug);
  const page = React.useMemo(() => <Template />, [Template]);
  const info = templateInfo(slug);
  const ref = React.useRef((null: any));
  const [viewport, onViewport] = usePageViewport();
  return (
    <View style={styles.screen}>
      <NativeSafeArea edges={{bottom: false}} style={styles.header}>
        <View style={styles.bar}>
          {showBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back">
              <Text>‹ Astryx</Text>
            </Pressable>
          ) : null}
          <Text weight="semibold">{info?.name ?? slug}</Text>
          <SidebarToggle />
        </View>
      </NativeSafeArea>
      <NativePageScroll
        key={slug}
        ref={ref}
        contentContainerStyle={styles.content}
        onContentViewportChange={onViewport}>
        {/* The page's viewport is the scroll view's frame, which `dvh`
            and a page of `height: 100%` resolve against. Without it the
            surface's own height stood in: the window's, taller than the frame
            by the bar, and then that of the last page the surface held. The
            page renders once it is known, so it renders once. */}
        <AstryxHost viewport={viewport}>
          {viewport != null ? page : null}
        </AstryxHost>
      </NativePageScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {flex: 1},
  list: {padding: 16},
  screen: {flex: 1},
  header: {
    backgroundColor: '#f2f2f2',
  },
  bar: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
  },
  content: {flexGrow: 1},
});
