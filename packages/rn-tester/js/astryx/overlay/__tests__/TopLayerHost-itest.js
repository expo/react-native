/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @fantom_flags enableYogaDisplayBlock:true
 * @fantom_flags enableCppPropsIteratorSetter:*
 * @fantom_flags enableNativeCSSParsing:*
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import {TopLayerHost} from '../TopLayer';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

[false, true].forEach(maximumOnly => {
  it(`keeps overlay hosts within a ${maximumOnly ? 'maximum-size' : 'fixed-size'} viewport when content overflows`, () => {
    const root = Fantom.createRoot({viewportWidth: 400, viewportHeight: 800});
    const contentRef = React.createRef<React.ElementRef<typeof View>>();

    Fantom.runTask(() => {
      const application = (
        <TopLayerHost>
          <View ref={contentRef} style={{height: 1200, flexShrink: 0}} />
        </TopLayerHost>
      );
      root.render(
        maximumOnly ? (
          <View style={{width: 400, maxHeight: 800, minHeight: 0}}>
            {application}
          </View>
        ) : (
          application
        ),
      );
    });

    const inner = nullthrows(nullthrows(contentRef.current).parentElement);
    const outer = nullthrows(inner.parentElement);
    for (const host of [inner, outer]) {
      const frame = host.getBoundingClientRect();
      expect({width: frame.width, height: frame.height}).toEqual({
        width: 400,
        height: 800,
      });
    }
  });
});
