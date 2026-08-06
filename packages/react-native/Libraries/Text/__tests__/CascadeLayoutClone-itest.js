/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// The regression this pins: the LAYOUT walk clones nodes to write layout
// metrics, and such a clone rebuilds its anonymous text boxes — which start
// with DEFAULT text attributes. The clone is born AFTER the pass's configure
// already ran, so unless the rebuild re-stamps the cascade itself, the same
// pass publishes the text at 14pt default instead of its inherited size.
// On screen that was whole runs of text dropping their font styling whenever
// an unrelated re-render moved them.
//
// The trigger, distilled: the text-owning View's PROPS never change (so React
// never clones it — its attributes cannot come from a props parse), but an
// ancestor's layout DOES change (so the layout pass must clone it to write a
// new frame). The deterministic measurer bills width per character at the
// cascaded font size, so a cascade lost to the clone is a measurable width
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
    // 5 characters at the cascaded 30pt; the 14pt default would be narrower
    // and shorter. Pin both axes so either kind of loss trips this.
    expect(before.width).toBeGreaterThan(0);
    expect(before.height).toBeGreaterThan(0);

    // Move ONLY the ancestor's padding, several times: the text-owning View's
    // props are untouched, so any change to its measured text is the layout
    // clone dropping the cascade.
    for (const padding of [4, 9, 2, 17]) {
      Fantom.runTask(() => render(padding));
      const now = rectOf(textRef);
      expect(now.width).toBe(before.width);
      expect(now.height).toBe(before.height);
    }
  });
});
