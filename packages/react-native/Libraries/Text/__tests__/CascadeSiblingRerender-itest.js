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

// Re-rendering one sibling re-parents the other's shadow nodes, whose clone
// rebuilds its anonymous text boxes; the cascade must reach the rebuilt boxes
// or the untouched sibling's text publishes with default attributes, which the
// deterministic measurer shows as a width change.
describe('cascade survives a sibling re-render', () => {
  it("an untouched sibling's text keeps its inherited font size", () => {
    const stableRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    const render = (counter: number) => {
      root.render(
        // $FlowExpectedError[incompatible-type] fontSize cascades to bare text
        <View style={{width: 500, fontSize: 30}}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>
            {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
            <div ref={stableRef} style={{alignSelf: 'flex-start'}}>
              {'abcde'}
            </div>
          </div>
          {/* A sibling whose TEXT changes — the shape of a live status
              panel — so its anonymous box content is rebuilt each render. */}
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>{`count ${counter}`}</div>
        </View>,
      );
    };

    Fantom.runTask(() => render(0));
    const before = ensureInstance(
      stableRef.current,
      ReactNativeElement,
    ).getBoundingClientRect().width;
    // 5 characters at the cascaded 30pt; the default size would be narrower
    expect(before).toBeGreaterThan(0);

    // Re-render several times, changing only the sibling
    for (let i = 1; i <= 4; i++) {
      Fantom.runTask(() => render(i));
    }

    const after = ensureInstance(
      stableRef.current,
      ReactNativeElement,
    ).getBoundingClientRect().width;
    expect(after).toBe(before);
  });
});
