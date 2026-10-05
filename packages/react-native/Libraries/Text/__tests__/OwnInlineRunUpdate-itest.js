/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

/**
 * A block container whose content is one inline run measures that run itself:
 * the anonymous box stays off the Yoga tree, and the container answers Yoga's
 * size and baseline questions for it. An update that ends the arrangement —
 * the container becomes a flex container, or gains a block child — has to
 * hand both questions back to Yoga. The container then lays out exactly as
 * one rendered that way from the start.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

type Box = {display: 'block' | 'flex', blockChild: boolean};

// The label is small, so its top moves with the box's baseline: the row puts
// both baselines on one line.
function Row({box, labelRef}: {box: Box, labelRef: {current: HostInstance | null}}) {
  return (
    <View style={{width: 300, flexDirection: 'row', alignItems: 'baseline'}}>
      <Text ref={labelRef} style={{fontSize: 10}}>
        Label
      </Text>
      <View style={{display: box.display}}>
        {box.blockChild ? <View style={{height: 40}} /> : null}
        Open
      </View>
    </View>
  );
}

function labelTop(revisions: $ReadOnlyArray<Box>): number {
  const labelRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  for (const box of revisions) {
    Fantom.runTask(() => {
      root.render(<Row box={box} labelRef={labelRef} />);
    });
  }
  const top = ensureInstance(
    labelRef.current,
    ReactNativeElement,
  ).getBoundingClientRect().top;
  Fantom.runTask(() => root.destroy());
  return top;
}

const ownRun = {display: 'block', blockChild: false};

describe('a container that stops measuring its own inline run', () => {
  it('aligns by its flex baseline once it becomes a flex container', () => {
    const flex = {display: 'flex', blockChild: false};
    expect(labelTop([ownRun, flex])).toBe(labelTop([flex]));
  });

  it('aligns by its children once it gains a block child', () => {
    const withBlock = {display: 'block', blockChild: true};
    expect(labelTop([ownRun, withBlock])).toBe(labelTop([withBlock]));
  });
});
