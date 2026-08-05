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

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect();
}

describe('cascade into an atomic inline', () => {
  it('text inside an inline-block takes the inherited font size', () => {
    const insideRef = createRef<HostInstance>();
    const outsideRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[incompatible-type] fontSize cascades to bare text
        <View style={{display: 'block', width: 300, fontSize: 30}}>
          {/* $FlowExpectedError[not-a-component] */}
          <span ref={insideRef} style={{display: 'inline-block'}}>
            {'abc'}
          </span>
          {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
          <span ref={outsideRef}>{'abc'}</span>
        </View>,
      );
    });

    // The deterministic measurer bills per character at the CASCADED size, so
    // an inline-block whose contents ignored the cascade measures narrower.
    expect(rectOf(insideRef).width).toBe(rectOf(outsideRef).width);
  });
});
