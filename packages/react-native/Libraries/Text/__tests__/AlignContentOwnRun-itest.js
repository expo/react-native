/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `align-content` moves a block container's own inline run. The container's
 * contents are one alignment subject (css-align-3 §5.3); Yoga offsets the
 * container's children, and a container whose content is bare text has none,
 * since the run is an anonymous box elided off the Yoga tree. A `<button>` with
 * a text label and the user-agent sheet's 44pt minimum height is the case. The
 * run has no node to measure, so these read an atomic inline placed by it.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

const MIN_HEIGHT = 44;
const PADDING = 8;
const PROBE = 10;

type Align = 'flex-start' | 'center' | 'flex-end' | 'stretch';

function runY(alignContent: Align): number {
  const probe = createRef<HostInstance | null>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View style={{width: 300}}>
        <View
          style={{
            display: 'block',
            minHeight: MIN_HEIGHT,
            alignContent,
            paddingVertical: PADDING,
          }}>
          {/* $FlowFixMe[prop-missing] intrinsic <span> tag */}
          <span
            ref={probe}
            style={{display: 'inline-block', width: PROBE, height: PROBE}}
          />
        </View>
      </View>,
    );
  });
  const node = probe.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  return node.getBoundingClientRect().y;
}

describe('align-content on a container that measures its own run', () => {
  it('centres the run in the space a minimum height left over', () => {
    const start = runY('flex-start');
    const center = runY('center');
    // Half the slack, whatever the measurer makes the run
    const slack = (runY('flex-end') - start) / 2;
    expect(slack).toBeGreaterThan(0);
    expect(center - start).toBeCloseTo(slack, 5);
  });

  it('moves the run twice as far for flex-end as for center', () => {
    // A relation, since the line height is the harness's model here and real
    // metrics on a device
    const start = runY('flex-start');
    const centred = runY('center') - start;
    // Without this the relation holds trivially when nothing moves: 0 === 2 * 0
    expect(centred).toBeGreaterThan(0);
    expect(runY('flex-end') - start).toBeCloseTo(2 * centred, 5);
  });

  it('leaves the run at the block-start edge by default', () => {
    // `normal`, `start` and `stretch` all mean "do not move it"
    expect(runY('stretch')).toBeCloseTo(runY('flex-start'), 5);
  });

  it('does not move a run that already fills its box', () => {
    // No minimum height, so no slack; an offset from negative free space would
    // push the text out of the box
    const noMinimum = (alignContent: Align): number => {
      const probe = createRef<HostInstance | null>();
      const root = Fantom.createRoot();
      Fantom.runTask(() => {
        root.render(
          <View style={{width: 300}}>
            <View style={{display: 'block', alignContent}}>
              {/* $FlowFixMe[prop-missing] intrinsic <span> tag */}
              <span
                ref={probe}
                style={{display: 'inline-block', width: PROBE, height: PROBE}}
              />
            </View>
          </View>,
        );
      });
      const node = probe.current;
      if (node == null) {
        throw new Error('not mounted');
      }
      return node.getBoundingClientRect().y;
    };
    expect(noMinimum('center')).toBeCloseTo(noMinimum('flex-start'), 5);
  });
});
