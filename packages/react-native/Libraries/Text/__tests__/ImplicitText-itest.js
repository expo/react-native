/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {useState} from 'react';
import {Text, View} from 'react-native';

let setContent: (content: string) => void = () => {};

function UpdatableText(): React.Node {
  const [content, setStateContent] = useState('first');
  setContent = setStateContent;
  return <View collapsable={false}>{content}</View>;
}

describe('bare string children of <View> (with implicit wrapping prototype)', () => {
  it('renders text wrapped in <Text> identically (control case)', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false}>
          <Text>hello</Text>
        </View>,
      );
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>hello</rn-paragraph>
      </rn-view>,
    );
  });

  it('renders bare string children inside a synthesized paragraph', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<View collapsable={false}>hello</View>);
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>hello</rn-paragraph>
      </rn-view>,
    );
  });

  it('wraps each contiguous text run around a view child separately', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false}>
          before
          <View collapsable={false} />
          after
        </View>,
      );
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>before</rn-paragraph>
        <rn-view />
        <rn-paragraph>after</rn-paragraph>
      </rn-view>,
    );
  });

  it('updates bare string content across re-renders', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<UpdatableText />);
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>first</rn-paragraph>
      </rn-view>,
    );

    Fantom.runTask(() => {
      setContent('second');
    });

    expect(root.getRenderedOutput({props: []}).toJSX()).toEqual(
      <rn-view>
        <rn-paragraph>second</rn-paragraph>
      </rn-view>,
    );
  });
});
