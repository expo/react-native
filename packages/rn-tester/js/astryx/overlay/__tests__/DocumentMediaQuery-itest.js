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

import {useMediaQuery} from '../../native-css/useMediaQuery';
import {PageViewportContext} from '../TopLayerElement';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

it('updates responsive content with the document width while the native window stays unchanged', () => {
  const root = Fantom.createRoot({viewportWidth: 1000, viewportHeight: 900});
  let compact = false;
  let mounts = 0;
  function Probe(): React.Node {
    compact = useMediaQuery('(width < 768px)');
    React.useEffect(() => {
      mounts++;
    }, []);
    return <View />;
  }
  function render(width: number) {
    Fantom.runTask(() =>
      root.render(
        <PageViewportContext value={{width, height: 800}}>
          <Probe />
        </PageViewportContext>,
      ),
    );
  }
  render(480);
  expect(compact).toBe(true);
  render(900);
  expect(compact).toBe(false);
  render(480);
  expect(compact).toBe(true);
  expect(mounts).toBe(1);
});
