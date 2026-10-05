/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableColorSpaces:true enableStringChildren:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

// This host draws 8-bit sRGB only, so no View here is an HDR consumer
function limitsOf(root: Fantom.Root): Array<?string> {
  const limits: Array<?string> = [];
  const visit = (node: $FlowFixMe) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const element: {
      type?: string,
      props?: {dynamicRangeLimit?: ?string, ...},
      children?: Array<$FlowFixMe>,
      ...
    } = node;
    if (element.type === 'View') {
      limits.push(element.props?.dynamicRangeLimit);
    }
    for (const child of element.children ?? []) {
      visit(child);
    }
  };
  visit(root.getRenderedOutput({props: ['dynamicRangeLimit']}).toJSON());
  return limits;
}

describe('dynamic-range-limit on views', () => {
  it('leaves a View without an HDR color stateless under a limit', () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{dynamicRangeLimit: 'standard'}} collapsable={false}>
          <View
            collapsable={false}
            style={{
              width: 10,
              height: 10,
              backgroundColor: 'color(display-p3 1 0 0)',
            }}
          />
          <View
            collapsable={false}
            style={{width: 10, height: 10, backgroundColor: 'red'}}
          />
        </View>,
      );
    });
    expect(limitsOf(root)).toEqual([undefined, undefined, undefined]);
    root.destroy();
  });
});
