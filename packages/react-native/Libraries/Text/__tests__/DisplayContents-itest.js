/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

// `display: contents` is upstream's, and already in this fork. What was not
// covered is whether it survives this fork's OWN display handling (block and
// inline) and composes with text children — which is where a flattened box is
// most likely to go wrong, since the run is built from the element tree.
function rectOf(render: ({current: HostInstance | null}) => React.Node) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400}}>
        {render(ref)}
      </View>,
    );
  });
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('display: contents', () => {
  it('flattens the box: children become flex items of the grandparent', () => {
    // Shrink-to-fit, so the row reports its CONTENT's width rather than the
    // 400 its parent would otherwise stretch it to.
    // Flattened, the two 50pt boxes are items of the row: 100 across.
    const flattened = rectOf(ref => (
      <View ref={ref} style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
        <View style={{display: 'contents'}}>
          <View style={{width: 50, height: 20}} />
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    // Not flattened, the wrapper is ONE item and its own column stacks them,
    // so the row is only 50 across. That difference is the whole property.
    const nested = rectOf(ref => (
      <View ref={ref} style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
        <View>
          <View style={{width: 50, height: 20}} />
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    expect(nested.width).toBe(50);
    expect(flattened.width).toBe(100);
  });

  it('a contents box has no box of its own', () => {
    const wrapper = rectOf(ref => (
      <View style={{flexDirection: 'row'}}>
        <View ref={ref} style={{display: 'contents'}}>
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    // A generated box would be 50x20; a flattened one contributes nothing.
    expect(wrapper.width).toBe(0);
    expect(wrapper.height).toBe(0);
  });

  it('composes with text children: text inside contents still joins the run', () => {
    // The interesting interaction for this fork — a flattened box around bare
    // text. On the web the text joins the parent's inline formatting context.
    const box = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{display: 'contents'}}>{'bb'}</span>
      </div>
    ));
    // 4 characters at 10pt each, on one line, if the text joined the run.
    expect(box.width).toBe(40);
    expect(box.height).toBe(20);
  });
});
