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

import AppContainerDev from '../AppContainer-dev';
import AppContainerProd from '../AppContainer-prod';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

[
  {name: 'development', Container: AppContainerDev},
  {name: 'production', Container: AppContainerProd},
].forEach(({name, Container}) => {
  describe(`AppContainer (${name})`, () => {
    [false, true].forEach(maximumOnly => {
      it(`keeps overflowing content within a ${maximumOnly ? 'maximum-size' : 'fixed-size'} host`, () => {
        const root = Fantom.createRoot({
          viewportWidth: 400,
          viewportHeight: 800,
        });
        const contentRef = React.createRef<React.ElementRef<typeof View>>();

        Fantom.runTask(() => {
          const application = (
            <Container
              rootTag={root.getRootTag()}
              internal_excludeLogBox={true}
              internal_excludeInspector={true}>
              <View
                ref={contentRef}
                style={{width: 1200, height: 1200, flexShrink: 0}}
              />
            </Container>
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

        const content = nullthrows(contentRef.current);
        const container = nullthrows(content.parentElement);
        const frame = container.getBoundingClientRect();
        expect({width: frame.width, height: frame.height}).toEqual({
          width: 400,
          height: 800,
        });
        expect(content.getBoundingClientRect().height).toBe(1200);
      });
    });
  });
});
