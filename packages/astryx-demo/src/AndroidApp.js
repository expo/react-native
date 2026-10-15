/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import AstryxHost from './AstryxHost';
import {templateComponent, templateInfo, templates} from './templates';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import * as React from 'react';
import {BackHandler, Linking, Pressable, StyleSheet, View} from 'react-native';

/**
 * The templates as a list, a template full-screen on top, the device's back
 * button returning to the list. `astryxdemo://template/<slug>` opens a
 * template, whether the app is cold or running, as on iOS.
 */
export default function AndroidApp(): React.Node {
  const [slug, setSlug] = React.useState((null: ?string));
  // The template screen's viewport, the scroll view below the bar: the same
  // for every template, so a screen after the first renders its page once
  const [viewportHeight, setViewportHeight] = React.useState((null: ?number));
  React.useEffect(() => {
    const open = (url: ?string) => {
      const match = url == null ? null : /template\/([a-z0-9-]+)/.exec(url);
      if (match != null) {
        setSlug(match[1]);
      }
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', ({url}) => open(url));
    return () => sub.remove();
  }, []);
  React.useEffect(() => {
    if (slug == null) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSlug(null);
      return true;
    });
    return () => sub.remove();
  }, [slug]);
  if (slug != null) {
    return (
      <TemplateScreen
        // A template is a page of its own, with a surface of its own: one
        // kept from the last template sized the new page's viewport units
        key={slug}
        slug={slug}
        onBack={() => setSlug(null)}
        viewportHeight={viewportHeight}
        onViewportHeight={setViewportHeight}
      />
    );
  }
  return (
    <AstryxHost>
      <native:scroll contentContainerStyle={styles.listInset}>
        <div style={styles.list}>
          <VStack gap={3}>
            <Heading level={1}>Astryx</Heading>
            {templates.map(t => (
              <Pressable key={t.slug} onPress={() => setSlug(t.slug)}>
                <Card>
                  <VStack gap={1}>
                    <Text weight="semibold">{t.name}</Text>
                    <Text size="small" color="secondary">
                      {t.category}
                    </Text>
                  </VStack>
                </Card>
              </Pressable>
            ))}
          </VStack>
        </div>
      </native:scroll>
    </AstryxHost>
  );
}
function TemplateScreen({
  slug,
  onBack,
  viewportHeight,
  onViewportHeight,
}: {
  slug: string,
  onBack: () => void,
  viewportHeight: ?number,
  onViewportHeight: (height: number) => void,
}): React.Node {
  const Template = templateComponent(slug);
  const info = templateInfo(slug);
  const ref = React.useRef((null: any));
  // Named: an inline function on a namespaced tag crashes Metro's function map
  const onLayout = React.useCallback(
    (event: any) => onViewportHeight(event.nativeEvent.layout.height),
    [onViewportHeight],
  );
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.bar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Text>‹ Astryx</Text>
          </Pressable>
          <Text weight="semibold">{info?.name ?? slug}</Text>
        </View>
      </View>
      <native:scroll
        ref={ref}
        contentContainerStyle={styles.content}
        onLayout={onLayout}>
        {/* The page's viewport is the scroll view's frame, which `dvh`
            and a page of `height: 100%` resolve against. Without it the
            surface's own height stood in: the window's, taller than the frame
            by the bar, and then that of the last page the surface held. The
            page renders once it is known, so it renders once. */}
        <AstryxHost viewportHeight={viewportHeight}>
          {viewportHeight != null ? <Template /> : null}
        </AstryxHost>
      </native:scroll>
    </View>
  );
}

// The status bar's height, from the surface's layout constraints (`env()`),
// which the first layout already has: `StatusBar.currentHeight` is fixed when
// its module loads, and is 0 if the window had no insets yet
const statusBarInset = 'env(safe-area-inset-top)';

const styles = StyleSheet.create({
  listInset: {paddingTop: statusBarInset},
  list: {padding: 16},
  screen: {flex: 1},
  header: {
    paddingTop: statusBarInset,
    paddingHorizontal: 16,
    backgroundColor: '#f2f2f2',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
  },
  content: {flexGrow: 1},
});
