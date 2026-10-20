/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
// $FlowExpectedError[untyped-import]
import {ChatLayout} from '../native-chat/ChatLayout';
import {
  ScreenScrollContext,
  useScreenScrollProvider,
} from '../native-chat/ScreenScroll';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

it('keeps the scroll control mounted without changing the composer obstruction', () => {
  const timers = Fantom.installTimerMock();
  try {
    const root = Fantom.createRoot();
    const dock = React.createRef<$FlowFixMe>();
    const composer = React.createRef<$FlowFixMe>();
    let control: $FlowFixMe;
    function Screen(): React.Node {
      const scroll = React.useRef({scrollToLatest: () => {}});
      control = useScreenScrollProvider(scroll);
      return (
        <ScreenScrollContext value={control.value}>
          <ChatLayout
            composer={jsx('div', {
              ref: composer,
              style: {height: 60},
              children: 'Composer',
            })}>
            {jsx('div', {children: 'Transcript'})}
          </ChatLayout>
          <View ref={dock}>{control.accessories}</View>
        </ScreenScrollContext>
      );
    }
    Fantom.runTask(() => root.render(<Screen />));
    const bar = dock.current.firstElementChild;
    const height = bar.getBoundingClientRect().height;
    const button = bar.querySelector('[aria-label="Scroll to bottom"]');
    expect(button).not.toBe(null);
    const field = composer.current;
    Fantom.runTask(() =>
      control.onScroll({
        nativeEvent: {
          contentOffset: {x: 0, y: 300},
          contentSize: {width: 300, height: 1000},
          containerSize: {width: 300, height: 400},
          inset: {top: 0, left: 0, bottom: 0, right: 0},
        },
      }),
    );
    timers.advanceTimersByTime(300);
    Fantom.runWorkLoop();
    expect(dock.current.firstElementChild).toBe(bar);
    expect(bar.getBoundingClientRect().height).toBe(height);
    expect(composer.current).toBe(field);
    expect(bar.querySelector('[aria-label="Scroll to bottom"]')).toBe(button);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      field.getBoundingClientRect().top,
    );
  } finally {
    timers.uninstall();
  }
});
