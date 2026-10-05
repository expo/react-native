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
import '@react-native/expo-intrinsics-poc';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Image, View} from 'react-native';

const SOURCE = {uri: 'https://example.com/picture.png'};

// Each picture's effective `dynamic-range-limit`, in document order
function limitsOf(root: Fantom.Root): Array<?string> {
  const limits: Array<?string> = [];
  const visit = (node: $FlowFixMe) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    // A flattened container leaves several elements at the root
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
    if (element.type === 'Image' || element.type === 'img') {
      limits.push(element.props?.dynamicRangeLimit);
    }
    for (const child of element.children ?? []) {
      visit(child);
    }
  };
  visit(root.getRenderedOutput({props: ['dynamicRangeLimit']}).toJSON());
  return limits;
}

function Picture(props: {limit?: 'no-limit' | 'constrained' | 'standard'}) {
  return (
    <Image
      source={SOURCE}
      style={{width: 10, height: 10, dynamicRangeLimit: props.limit}}
    />
  );
}

describe('dynamic-range-limit inheritance', () => {
  it("is CSS's initial value where nothing states one", () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View>
          <Picture />
        </View>,
      );
    });
    expect(limitsOf(root)).toEqual(['no-limit']);
    root.destroy();
  });

  it("is a container's limit for every picture inside it", () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{dynamicRangeLimit: 'standard'}}>
          <Picture />
          <View>
            <View>
              <Picture />
            </View>
          </View>
        </View>,
      );
    });
    expect(limitsOf(root)).toEqual(['standard', 'standard']);
    root.destroy();
  });

  it("is the picture's own where it states one, and the nearest ancestor's otherwise", () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{dynamicRangeLimit: 'standard'}}>
          <Picture limit="no-limit" />
          <View style={{dynamicRangeLimit: 'constrained'}}>
            <Picture />
          </View>
          <Picture />
        </View>,
      );
    });
    expect(limitsOf(root)).toEqual(['no-limit', 'constrained', 'standard']);
    root.destroy();
  });

  it("follows a change to the container's limit without the picture's layout changing", () => {
    const root = Fantom.createRoot();
    const render = (limit: 'no-limit' | 'constrained' | 'standard') =>
      Fantom.runTask(() => {
        root.render(
          <View style={{dynamicRangeLimit: limit}}>
            <View>
              <Picture />
            </View>
          </View>,
        );
      });
    render('standard');
    expect(limitsOf(root)).toEqual(['standard']);
    render('constrained');
    expect(limitsOf(root)).toEqual(['constrained']);
    render('no-limit');
    expect(limitsOf(root)).toEqual(['no-limit']);
    root.destroy();
  });

  it('reaches an inline <img> through its anonymous box in the same commit', () => {
    // The picture is an atomic inline hanging off an anonymous box
    const root = Fantom.createRoot();
    const render = (limit: 'no-limit' | 'constrained' | 'standard') =>
      Fantom.runTask(() => {
        root.render(
          // $FlowFixMe[prop-missing] elements from the catalog
          <div style={{width: 200, dynamicRangeLimit: limit}}>
            before
            <img source={SOURCE} style={{width: 10, height: 10}} />
            after
          </div>,
        );
      });
    render('standard');
    expect(limitsOf(root)).toEqual(['standard']);
    render('constrained');
    expect(limitsOf(root)).toEqual(['constrained']);
    render('no-limit');
    expect(limitsOf(root)).toEqual(['no-limit']);
    root.destroy();
  });

  it("goes back to the container's limit when the picture drops its own", () => {
    const root = Fantom.createRoot();
    const render = (limit?: 'no-limit' | 'constrained' | 'standard') =>
      Fantom.runTask(() => {
        root.render(
          <View style={{dynamicRangeLimit: 'standard'}}>
            <Picture limit={limit} />
          </View>,
        );
      });
    render('constrained');
    expect(limitsOf(root)).toEqual(['constrained']);
    render(undefined);
    expect(limitsOf(root)).toEqual(['standard']);
    root.destroy();
  });
});
