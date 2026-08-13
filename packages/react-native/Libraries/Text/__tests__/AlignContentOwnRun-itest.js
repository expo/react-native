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
 * `align-content` moves a block container's OWN inline run.
 *
 * A block container's contents are a single alignment subject (css-align-3
 * §5.3). Yoga implements that by offsetting the container's children — and a
 * container whose content is bare text has none: the run is an anonymous box
 * elided off the Yoga tree, so there was nothing for the offset to move and
 * the text stayed at the block-start edge whatever `align-content` said.
 *
 * That is every `<button>` with a text label. The user-agent sheet gives a
 * button `align-content: center` and a 44pt minimum touch height while its
 * label needs about 34pt, so the ~10pt of slack all fell BELOW the words and
 * the label sat visibly high in the pill — measured on the simulator at 11.3pt
 * of space above the ink and 20.7pt below.
 *
 * The run has no host node of its own to measure, so these read the position
 * of an atomic inline sitting in it, which is placed by the run.
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
    // Half the slack, whatever the measurer makes the run: stating the
    // absolute coordinate would pin this to one text model rather than to the
    // rule under test.
    const slack = (runY('flex-end') - start) / 2;
    expect(slack).toBeGreaterThan(0);
    expect(center - start).toBeCloseTo(slack, 5);
  });

  it('moves the run twice as far for flex-end as for center', () => {
    // Stated as a relation because the slack depends on the height the
    // MEASURER gives the line, which is a model in this harness and real text
    // metrics on a device. The relation is the rule and holds for both.
    const start = runY('flex-start');
    const centred = runY('center') - start;
    // Without this the relation holds trivially when nothing moves at all,
    // which is exactly the state this is meant to catch: 0 === 2 * 0.
    expect(centred).toBeGreaterThan(0);
    expect(runY('flex-end') - start).toBeCloseTo(2 * centred, 5);
  });

  it('leaves the run at the block-start edge by default', () => {
    // `normal`, `start` and `stretch` all mean "do not move it", and this is
    // the case a wrong sign or an unguarded offset would break first.
    expect(runY('stretch')).toBeCloseTo(runY('flex-start'), 5);
  });

  it('does not move a run that already fills its box', () => {
    // No minimum height, so no slack and nothing to distribute. An offset
    // computed from a NEGATIVE free space would push the text up out of the
    // box, where it could not be scrolled back into view.
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
