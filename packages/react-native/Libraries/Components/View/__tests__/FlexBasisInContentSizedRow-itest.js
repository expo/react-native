/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */
/**
 * A flex basis that is a length is the item's flex base size whatever the
 * container's size (css-flexbox-1 §9.2.3.A). Yoga used it only when the
 * container's main size was definite, so in a horizontal scroll view, whose
 * row is as wide as its content, a column of a kanban board with
 * `flex: 0 0 300px` was as wide as its longest line instead. A percentage
 * basis still needs a definite container.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {ScrollView, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {readonly current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('a flex basis in a row sized by its content', () => {
  it('sizes a column of a horizontal scroll view', () => {
    const columns = [createRef<HostInstance>(), createRef<HostInstance>()];
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <ScrollView horizontal style={{width: 402}}>
          <View style={{flexDirection: 'row', gap: 16}}>
            {columns.map((ref, i) => (
              <View
                key={i}
                ref={ref}
                style={{flexBasis: 300, flexShrink: 0, minWidth: 0}}>
                <View style={{width: 500, height: 10}} />
              </View>
            ))}
          </View>
        </ScrollView>,
      );
    });
    expect(columns.map(ref => [rect(ref).x, rect(ref).width])).toEqual([
      [0, 300],
      [316, 300],
    ]);
  });

  it('leaves a percentage basis to the content there', () => {
    const item = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <ScrollView horizontal style={{width: 402}}>
          <View style={{flexDirection: 'row'}}>
            <View ref={item} style={{flexBasis: '50%', flexShrink: 0}}>
              <View style={{width: 120, height: 10}} />
            </View>
          </View>
        </ScrollView>,
      );
    });
    expect(rect(item).width).toBe(120);
  });
});

describe('a growing item with a zero basis in a column sized by its content', () => {
  it('keeps its content', () => {
    const region = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <ScrollView style={{width: 402}}>
          <View style={{flexDirection: 'column'}}>
            <View
              ref={region}
              style={{flexGrow: 1, flexShrink: 1, flexBasis: 0}}>
              <View style={{height: 120}} />
            </View>
          </View>
        </ScrollView>,
      );
    });
    expect(rect(region).height).toBe(120);
  });
});
