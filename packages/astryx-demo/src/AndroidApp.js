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
import {
  BackHandler,
  Linking,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';

/**
 * The templates as a list, a template full-screen on top, the device's back
 * button returning to the list. `astryxdemo://template/<slug>` opens a
 * template, whether the app is cold or running, as on iOS.
 */
export default function AndroidApp(): React.Node {
  const [slug, setSlug] = React.useState((null: ?string));
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
    return <TemplateScreen slug={slug} onBack={() => setSlug(null)} />;
  }
  return (
    <AstryxHost>
      <native:scroll>
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
}: {
  slug: string,
  onBack: () => void,
}): React.Node {
  const Template = templateComponent(slug);
  const info = templateInfo(slug);
  const ref = React.useRef((null: any));
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Text>‹ Astryx</Text>
        </Pressable>
        <Text weight="semibold">{info?.name ?? slug}</Text>
      </View>
      <native:scroll ref={ref} contentContainerStyle={styles.content}>
        <AstryxHost>
          <Template />
        </AstryxHost>
      </native:scroll>
    </View>
  );
}

const statusBarHeight = StatusBar.currentHeight ?? 0;

const styles = StyleSheet.create({
  list: {padding: 16, paddingTop: statusBarHeight + 16},
  screen: {flex: 1},
  header: {
    paddingTop: statusBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    height: statusBarHeight + 48,
    backgroundColor: '#f2f2f2',
  },
  content: {flexGrow: 1},
});
