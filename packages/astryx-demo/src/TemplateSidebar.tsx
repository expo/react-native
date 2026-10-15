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
import {templates} from './templates';
import {List, ListItem} from '@astryxdesign/core/List';
import {Heading} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {useGlobalSearchParams, usePathname, useRouter} from 'expo-router';
import * as React from 'react';

/**
 * The split view's sidebar: the templates as a list, the open one selected.
 * Choosing one replaces the template in the main column rather than piling
 * them up in its stack; from the grid's stand-in screen it pushes, so the
 * column keeps a way back to it.
 */
export default function TemplateSidebar(): React.Node {
  const router = useRouter();
  const pathname = usePathname();
  const {slug} = useGlobalSearchParams<{slug?: string}>();
  const onTemplate = pathname.startsWith('/template/');
  const open = (href: string) => {
    if (onTemplate) {
      router.replace(href);
    } else {
      router.push(href);
    }
  };
  return (
    <AstryxHost>
      <native:scroll>
        <div style={{paddingBlock: 24, paddingInline: 8}}>
          <VStack gap={4}>
            <div style={{paddingInline: 16}}>
              <Heading level={1}>Astryx</Heading>
            </div>
            <List density="compact" hasDividers={false}>
              {templates.map(t => (
                <ListItem
                  key={t.slug}
                  label={t.name}
                  description={t.category}
                  isSelected={onTemplate && slug === t.slug}
                  onClick={() => open(`/template/${t.slug}`)}
                />
              ))}
              <ListItem
                label="Modifications"
                description="What the app supplies to the templates"
                isSelected={pathname === '/modifications'}
                onClick={() => open('/modifications')}
              />
            </List>
          </VStack>
        </div>
      </native:scroll>
    </AstryxHost>
  );
}
