/**
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true enableStringChildren:true
 */
/**
 * A grid of cards whose items are scroll containers (`overflow: hidden`),
 * measured under a fit-content constraint — a grid inside a flex column that
 * has an available height. The items' minimum contribution is 0 (css-grid-2
 * §6.6: a scroll container's automatic minimum size), so the auto rows start
 * at nothing and must grow to their items in the maximize step; a fit-content
 * axis with no definite size grows them as max-content does. Before the fix
 * every row stayed at 0 and the grid measured as a stack of gaps.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function rect(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

const DESC =
  'AppShell provides a foundational page layout with header, sidebar, and content regions. Use it to establish consistent structure across your application.';

describe('grid of scroll-container cards under fit-content', () => {
  it('sizes each row to its card', () => {
    const gridRef = createRef<HostInstance>();
    const cardRef = createRef<HostInstance>();
    const contentRef = createRef<HostInstance>();
    const root = Fantom.createRoot({viewportWidth: 402});
    Fantom.runTask(() => {
      root.render(
        <View style={{flexDirection: 'column', width: 402}}>
          <View style={{flexDirection: 'column', gap: 16}}>
            <Text style={{fontSize: 22}}>Core</Text>
            <View
              ref={gridRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 8,
                margin: -8,
              }}>
              {Array.from({length: 20}, (_, i) => (
                <View
                  key={i}
                  ref={i === 0 ? cardRef : undefined}
                  style={{
                    display: 'block',
                    padding: 8,
                    overflow: 'hidden',
                    position: 'relative',
                    minWidth: 0,
                  }}>
                  <View
                    style={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      margin: -1,
                      overflow: 'hidden',
                    }}
                  />
                  <View
                    ref={i === 0 ? contentRef : undefined}
                    style={{flexDirection: 'column', gap: 12}}>
                    <View
                      style={{
                        display: 'block',
                        minHeight: 160,
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    />
                    <View style={{flexDirection: 'column', gap: 4}}>
                      <Text style={{fontWeight: 'bold'}}>AppShell</Text>
                      <Text numberOfLines={3}>{DESC}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>,
      );
    });
    const content = rect(contentRef).height;
    const card = rect(cardRef).height;
    const grid = rect(gridRef).height;
    expect(card).toBeGreaterThan(content);
    expect(grid).toBeGreaterThan(20 * content);
  });
});
