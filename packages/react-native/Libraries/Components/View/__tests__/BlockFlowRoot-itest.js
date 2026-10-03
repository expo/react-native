/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */
/**
 * `display: flow-root` is a block container that establishes a block
 * formatting context of its own (css-display-3 §2). The `display` parser did
 * not know it, so the View was a flex container: a bottom sheet's body, a flow
 * root as tall as the sheet, squeezed the column in it to that height, and the
 * sections in the column overlapped.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('a flow root', () => {
  it('stacks a block-level child at its content height', () => {
    const columnRef = createRef<HostInstance>();
    const sectionRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{height: 300}}>
          <View style={{display: 'flow-root', height: '100%'}}>
            {/* A column that may shrink, as a flex item on the web may */}
            <View ref={columnRef} style={{flexShrink: 1, minHeight: 0}}>
              {['a', 'b', 'c'].map((key, index) => (
                <View
                  key={key}
                  ref={index === 0 ? sectionRef : undefined}
                  style={{paddingTop: 24, paddingBottom: 16}}>
                  <View style={{height: 104}} />
                </View>
              ))}
            </View>
          </View>
        </View>,
      );
    });
    // Past the flow root's 300 points, which it overflows, with its items whole
    expect(rect(columnRef).height).toBe(432);
    expect(rect(sectionRef).height).toBe(144);
  });

  it("keeps its children's margins inside it", () => {
    const blockRef = createRef<HostInstance>();
    const blockChildRef = createRef<HostInstance>();
    const flowRootRef = createRef<HostInstance>();
    const flowRootChildRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{display: 'block', paddingTop: 1}}>
          <View ref={blockRef} style={{display: 'block'}}>
            <View
              ref={blockChildRef}
              style={{display: 'block', marginTop: 20, height: 10}}
            />
          </View>
          <View ref={flowRootRef} style={{display: 'flow-root'}}>
            <View
              ref={flowRootChildRef}
              style={{display: 'block', marginTop: 20, height: 10}}
            />
          </View>
        </View>,
      );
    });
    // A block's first child's margin collapses through its top edge (CSS2
    // §8.3.1), so the block starts where its child does; a flow root's stays
    // inside it, between its top edge and its child
    const block = rect(blockRef);
    const flowRoot = rect(flowRootRef);
    expect(rect(blockChildRef).y - block.y).toBe(0);
    expect(block.height).toBe(10);
    expect(rect(flowRootChildRef).y - flowRoot.y).toBe(20);
    expect(flowRoot.height).toBe(30);
  });
});
