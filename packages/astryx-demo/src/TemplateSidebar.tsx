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
import {SELECTED_TEMPLATE_STYLE} from './sidebarSelection';
import NativePageScroll, {
  usePageViewport,
} from '../../expo-intrinsics/src/NativePageScroll';
import {templates} from './templates';
import {List, ListItem} from '@astryxdesign/core/List';
import {Heading} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {usePathname, useRouter} from 'expo-router';
import * as React from 'react';

/** Select templates in the existing detail screen and highlight the current route. */
export default function TemplateSidebar(): React.Node {
  const [viewport, onViewport] = usePageViewport();
  const [canvasColor, setCanvasColor] = React.useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // The list follows the route alone. A change of the column's size (a fold,
  // the sidebar showing) re-renders the host with its new viewport and leaves
  // the items as they are.
  const content = React.useMemo(() => {
    const open = (href: string): void => {
      if (pathname === href) {
        return;
      }
      if (pathname.startsWith('/template/') && href.startsWith('/template/')) {
        router.setParams({slug: href.slice('/template/'.length)});
      } else if (pathname === '/') {
        router.navigate(href);
      } else {
        router.replace(href);
      }
    };
    return (
      <div style={{paddingBlock: 24, paddingInline: 8}}>
        <VStack gap={4}>
          <div style={{paddingInline: 16}}>
            <Heading level={1}>Astryx</Heading>
          </div>
          <List density="compact" hasDividers={false}>
            {templates.map(t => {
              const href = `/template/${t.slug}`;
              const selected = pathname === href;
              return (
                <ListItem
                  key={t.slug}
                  label={t.name}
                  description={t.category}
                  isSelected={selected}
                  style={selected ? SELECTED_TEMPLATE_STYLE : undefined}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => open(href)}
                />
              );
            })}
            <ListItem
              label="Modifications"
              description="What the app supplies to the templates"
              isSelected={pathname === '/modifications'}
              style={
                pathname === '/modifications'
                  ? SELECTED_TEMPLATE_STYLE
                  : undefined
              }
              onClick={() => open('/modifications')}
            />
          </List>
        </VStack>
      </div>
    );
  }, [pathname, router]);
  return (
    <NativePageScroll
      onContentViewportChange={onViewport}
      style={canvasColor == null ? null : {backgroundColor: canvasColor}}>
      <AstryxHost
        fill={false}
        viewport={viewport}
        onCanvasColor={setCanvasColor}>
        {content}
      </AstryxHost>
    </NativePageScroll>
  );
}
