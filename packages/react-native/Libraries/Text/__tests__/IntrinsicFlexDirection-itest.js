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

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

/**
 * Two fixed boxes in a container. Whether the second sits to the RIGHT of the
 * first or BELOW it is exactly the flex direction, with no other way to read
 * the same result.
 */
function layoutOf(container: React.Node => React.Node) {
  const aRef = createRef<HostInstance>();
  const bRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    const children = (
      <>
        <View ref={aRef} collapsable={false} style={{width: 20, height: 20}} />
        <View ref={bRef} collapsable={false} style={{width: 20, height: 20}} />
      </>
    );
    // $FlowFixMe[incompatible-type] the helper returns an element
    root.render(container(children));
  });
  const a = rectOf(aRef);
  const b = rectOf(bRef);
  return b.x > a.x ? 'row' : b.y > a.y ? 'column' : 'overlapping';
}

describe('flex-direction defaults to row on HTML intrinsics', () => {
  // css-flexbox-1 §5.1: the initial `flex-direction` is `row`; the elements
  // follow the web and RN's own components keep `column`
  it('an intrinsic flex container lays out in a row', () => {
    expect(
      layoutOf(children => (
        // $FlowExpectedError[not-a-component] intrinsic <div> tag
        <div style={{display: 'flex'}}>{children}</div>
      )),
    ).toBe('row');
  });

  it('a React Native View still lays out in a column', () => {
    expect(
      layoutOf(children => (
        <View collapsable={false} style={{display: 'flex'}}>
          {children}
        </View>
      )),
    ).toBe('column');
  });

  it('an authored flexDirection still wins over the UA default', () => {
    expect(
      layoutOf(children => (
        // $FlowExpectedError[not-a-component] intrinsic <div> tag
        <div style={{display: 'flex', flexDirection: 'column'}}>{children}</div>
      )),
    ).toBe('column');
  });

  // `flex-direction` has no effect on a block container, which keeps stacking
  // its children
  it('a block container still stacks vertically', () => {
    expect(
      layoutOf(children => (
        // $FlowExpectedError[not-a-component] intrinsic <div> tag
        <div>{children}</div>
      )),
    ).toBe('column');
  });

  it('an inline-block stacks its block children vertically too', () => {
    expect(
      layoutOf(children => (
        // $FlowExpectedError[not-a-component] intrinsic <div> tag
        <div style={{display: 'inline-block'}}>{children}</div>
      )),
    ).toBe('column');
  });
});
