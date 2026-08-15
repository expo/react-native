/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true enableStringChildren:true
 */
/**
 * The accordion idiom: a grid whose one row is `0fr` while closed and `1fr`
 * while open, over an item with `overflow: hidden` and `min-height: 0`. The
 * grid's height is `auto`, which Yoga lays out in max-content mode but which
 * is indefinite free space rather than a max-content constraint (css-grid-2
 * §12.5), so the closed row takes the item's minimum contribution, 0, and
 * collapses. Before the fix it took the item's content height, and a drawer's
 * closed sections each stood as tall as their open contents.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function height(ref: {current: HostInstance | null}): number {
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect()
    .height;
}

function section(rows: string): number {
  const gridRef = createRef<HostInstance>();
  const root = Fantom.createRoot({viewportWidth: 300});
  Fantom.runTask(() => {
    root.render(
      <View style={{width: 300}}>
        <View ref={gridRef} style={{display: 'grid', gridTemplateRows: rows}}>
          <View style={{overflow: 'hidden', minHeight: 0}}>
            <View style={{height: 100}} />
          </View>
        </View>
      </View>,
    );
  });
  return height(gridRef);
}

describe('a single fr row over a clipping item', () => {
  it('collapses at 0fr', () => {
    expect(section('0fr')).toBe(0);
  });

  it('stands as tall as its item at 1fr', () => {
    expect(section('1fr')).toBe(100);
  });
});
