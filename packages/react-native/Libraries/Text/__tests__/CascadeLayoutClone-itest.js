/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The layout walk clones nodes to write metrics, and such a clone rebuilds its
// anonymous text boxes with default attributes after the pass's configure has
// run, so the rebuild must re-stamp the cascade itself. The text-owning View's
// props never change here, only an ancestor's layout, and the deterministic
// measurer bills width at the cascaded size, so a lost cascade is a width
// change on an element nobody touched.
function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('cascade survives a layout-metrics clone', () => {
  it('text keeps its inherited size when only an ancestor frame moves', () => {
    const textRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    const render = (padding: number) => {
      root.render(
        // $FlowExpectedError[incompatible-type] fontSize cascades to bare text
        <View style={{width: 500, fontSize: 30}}>
          <View style={{paddingTop: padding}}>
            <View
              ref={textRef}
              collapsable={false}
              style={{alignSelf: 'flex-start'}}>
              {'abcde'}
            </View>
          </View>
        </View>,
      );
    };

    Fantom.runTask(() => render(0));
    const before = rectOf(textRef);
    // 5 characters at the cascaded 30pt; pin both axes so either loss trips this
    expect(before.width).toBeGreaterThan(0);
    expect(before.height).toBeGreaterThan(0);

    // Move only the ancestor's padding, several times
    for (const padding of [4, 9, 2, 17]) {
      Fantom.runTask(() => render(padding));
      const now = rectOf(textRef);
      expect(now.width).toBe(before.width);
      expect(now.height).toBe(before.height);
    }
  });
});
