/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {TemplateWebView} from '../../../modules/template-web/src';
import {templateInfo} from '../../../src/templates';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import * as React from 'react';

/**
 * The web version of a template, in a sheet over the app's rendering of it:
 * Astryx's own template viewer, bundled into the app, in a web view, for
 * comparing the two. The bar is opaque so the page's viewport starts below
 * it, as a browser's does.
 */
export default function TemplateWebScreen(): React.Node {
  const {slug} = useLocalSearchParams<{slug: string}>();
  const router = useRouter();
  const info = templateInfo(slug);
  return (
    <>
      <Stack.Screen
        options={{
          title: info?.name ?? slug,
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Close',
              icon: {type: 'sfSymbol', name: 'xmark'},
              onPress: () => router.back(),
            },
          ],
        }}
      />
      <TemplateWebView slug={slug} style={webStyle} />
    </>
  );
}

const webStyle = {flex: 1};
