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

import {
  ScreenScrollContext,
  useScreenAccessory,
  useScreenScrollEnd,
  useScreenScrollProvider,
} from '../ScreenScroll';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {Text, View} from 'react-native';

describe('screen chat accessory', () => {
  it('updates accessory content without rendering the screen or transcript', () => {
    const root = Fantom.createRoot();
    const dock = React.createRef<$FlowFixMe>();
    let renders = 0;
    let update: string => void = () => {};
    const Conversation = React.memo(function Conversation(): React.Node {
      const [label, setLabel] = React.useState('First');
      update = setLabel;
      return useScreenAccessory(<Text>{label}</Text>);
    });
    function Host(): React.Node {
      renders++;
      const scroll = React.useRef({scrollToLatest: () => {}});
      const state = useScreenScrollProvider(scroll);
      return (
        <ScreenScrollContext value={state.value}>
          <Conversation />
          <View ref={dock}>{state.accessories}</View>
        </ScreenScrollContext>
      );
    }
    Fantom.runTask(() => root.render(<Host />));
    const before = renders;
    Fantom.runTask(() => update('Updated'));
    expect(renders).toBe(before);
    expect(dock.current.textContent).toBe('Updated');
  });

  let controller: $FlowFixMe;
  let changeDraft: string => void;
  let draft: string;
  let composerRef;
  let dockRef;
  let scrollToLatest;
  let root;

  function Composer({label}: {label: string}): React.Node {
    const [text, setText] = React.useState('');
    changeDraft = setText;
    draft = text;
    return (
      <View ref={composerRef}>
        <Text>{label + text}</Text>
      </View>
    );
  }

  const Conversation = React.memo(function Conversation({
    label,
  }: {
    label: string,
  }): React.Node {
    useScreenScrollEnd();
    return (
      <View>
        <Text>Messages</Text>
        {useScreenAccessory(<Composer label={label} />)}
      </View>
    );
  });

  function Screen({
    label = 'Message',
    show = true,
  }: {
    label?: string,
    show?: boolean,
  }): React.Node {
    const scrollRef = React.useRef({scrollToLatest});
    controller = useScreenScrollProvider(scrollRef);
    return (
      <ScreenScrollContext value={controller.value}>
        <View>{show ? <Conversation label={label} /> : null}</View>
        <View ref={dockRef}>{controller.accessories}</View>
      </ScreenScrollContext>
    );
  }

  beforeEach(() => {
    root = Fantom.createRoot();
    composerRef = React.createRef<React.ElementRef<typeof View>>();
    dockRef = React.createRef<React.ElementRef<typeof View>>();
    scrollToLatest = jest.fn();
  });

  it('hosts the composer outside the transcript and follows the newest message', () => {
    Fantom.runTask(() => root.render(<Screen />));

    expect(nullthrows(composerRef.current).parentElement).toBe(dockRef.current);
    expect(controller.hasAccessory).toBe(true);
    expect(controller.contentAnchor).toBe('bottom');
    expect(scrollToLatest).toHaveBeenCalledWith(false);
  });

  it('keeps an unsent draft when the dock content updates', () => {
    Fantom.runTask(() => root.render(<Screen />));
    Fantom.runTask(() => changeDraft('Unsent draft'));
    const composer = composerRef.current;
    Fantom.runTask(() => root.render(<Screen label="Updated label" />));

    expect(draft).toBe('Unsent draft');
    expect(composerRef.current).toBe(composer);
  });

  it('removes the dock and releases bottom reservation when the conversation leaves', () => {
    Fantom.runTask(() => root.render(<Screen />));
    Fantom.runTask(() => root.render(<Screen show={false} />));

    expect(controller.hasAccessory).toBe(false);
    expect(controller.contentAnchor).toBe('top');
    expect(composerRef.current).toBe(null);
    expect(nullthrows(dockRef.current).children.length).toBe(0);
  });
});
