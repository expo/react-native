/**
 * @fantom_flags enableStringChildren:true
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

let root;
function inlineChildren(n: number): Array<React.Node> {
  const out: Array<React.Node> = [];
  for (let i = 0; i < n; i++) {
    out.push(`word${i} `);
    // $FlowFixMe[incompatible-type]
    out.push(
      <View
        key={String(i)}
        style={{width: 4, height: 4, display: 'inline-block'}}
      />,
    );
  }
  return out;
}

Fantom.unstable_benchmark
  .suite('inline append scaling', {
    minIterations: 20,
    disableOptimizedBuildCheck: true,
  })
  .test.each(
    [50, 100, 200, 400],
    n => `one container, ${String(n)} inline children`,
    n => {
      Fantom.runTask(() =>
        root.render(
          <View style={{width: 320, display: 'block'}}>
            {inlineChildren(n)}
          </View>,
        ),
      );
    },
    {
      beforeEach: () => {
        root = Fantom.createRoot();
      },
      afterEach: () => {
        root.destroy();
      },
    },
  );
