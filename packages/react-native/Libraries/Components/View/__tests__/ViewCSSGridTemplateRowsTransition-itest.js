/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags useSharedAnimatedBackend:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {View} from 'react-native';

/*
 * `grid-template-rows` is how a panel collapses to nothing and opens to its
 * content without measuring it: one row track moving between `1fr` and `0fr`
 * over an item whose minimum is zero. Like `height`, it is a layout property,
 * so the mounted views glide between two real layouts and the interpolation is
 * visible only in the mounted metrics these helpers read.
 */
function mountedFrame(
  root: ReturnType<typeof Fantom.createRoot>,
  nativeID: string,
): {y: number, height: number} {
  const json = root.getRenderedOutput({includeLayoutMetrics: true}).toJSON();
  let found: ?{[string]: string} = null;
  const visit = (node: unknown) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    // Untyped JSON from the harness: prop values are all strings
    const props: ?{[string]: string} = (node as $FlowFixMe).props;
    if (props != null && props.nativeID === nativeID) {
      found = props;
    }
    const children = (node as $FlowFixMe).children;
    if (Array.isArray(children)) {
      children.forEach(visit);
    }
  };
  if (Array.isArray(json)) {
    json.forEach(visit);
  } else {
    visit(json);
  }
  const frame = nullthrows(found)['layoutMetrics-frame'];
  const match = nullthrows(
    String(frame).match(
      /\{x:(-?[\d.]+),y:(-?[\d.]+),width:(-?[\d.]+),height:(-?[\d.]+)\}/,
    ),
  );
  return {y: parseFloat(match[2]), height: parseFloat(match[4])};
}

/*
 * A collapsible panel over 40 points of content, and a view below it. A panel
 * that is not `paintless` keeps its view regardless, so it can be read.
 */
function renderPanel(
  root: ReturnType<typeof Fantom.createRoot>,
  gridTemplateRows: string,
  paintless: boolean = false,
) {
  Fantom.runTask(() => {
    root.render(
      <View style={{width: 200}}>
        <View
          nativeID={paintless ? undefined : 'panel'}
          collapsable={paintless}
          style={{
            display: 'grid',
            gridTemplateRows,
            transitionProperty: 'grid-template-rows',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}>
          <View
            nativeID="content"
            collapsable={false}
            style={{minHeight: 0, overflow: 'hidden'}}>
            <View style={{height: 40}} />
          </View>
        </View>
        <View
          nativeID="below"
          collapsable={false}
          style={{width: 200, height: 10}}
        />
      </View>,
    );
  });
}

function produceFrames(duration: number) {
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(duration);
  Fantom.runWorkLoop();
}

test('a row collapsing from 1fr to 0fr glides to zero', () => {
  const root = Fantom.createRoot();

  renderPanel(root, '1fr');
  expect(mountedFrame(root, 'panel').height).toBe(40);
  expect(mountedFrame(root, 'content').height).toBe(40);

  renderPanel(root, '0fr');
  /*
   * Read before any frame is produced: the mounted panel must not have moved,
   * or the change arrived on the commit and nothing is left to animate
   */
  expect(mountedFrame(root, 'panel').height).toBe(40);

  produceFrames(500);
  const panel = mountedFrame(root, 'panel').height;
  expect(panel).toBeGreaterThan(10);
  expect(panel).toBeLessThan(30);
  // The item rides the same clock as the track it sits in
  expect(mountedFrame(root, 'content').height).toBeCloseTo(panel, 3);

  produceFrames(600);
  expect(mountedFrame(root, 'panel').height).toBe(0);
  expect(mountedFrame(root, 'content').height).toBe(0);
});

/*
 * The view below declares no transition; it moves because the panel does, so
 * it rides the panel's clock
 */
test('a row opening from 0fr to 1fr moves the views below it', () => {
  const root = Fantom.createRoot();

  renderPanel(root, '0fr');
  expect(mountedFrame(root, 'below').y).toBe(0);

  renderPanel(root, '1fr');
  expect(mountedFrame(root, 'below').y).toBe(0);

  produceFrames(500);
  const below = mountedFrame(root, 'below').y;
  expect(below).toBeGreaterThan(10);
  expect(below).toBeLessThan(30);

  produceFrames(600);
  expect(mountedFrame(root, 'below').y).toBe(40);
  expect(mountedFrame(root, 'panel').height).toBe(40);
});

/*
 * A grid with nothing to paint would be flattened away, leaving no update of
 * its own for the engine to know the change by; declaring the transition
 * keeps its view
 */
test('a panel that paints nothing still glides', () => {
  const root = Fantom.createRoot();

  renderPanel(root, '0fr', true);
  renderPanel(root, '1fr', true);
  expect(mountedFrame(root, 'below').y).toBe(0);

  produceFrames(500);
  const below = mountedFrame(root, 'below').y;
  expect(below).toBeGreaterThan(10);
  expect(below).toBeLessThan(30);

  produceFrames(600);
  expect(mountedFrame(root, 'below').y).toBe(40);
});

/*
 * css-grid-1 §7.2 interpolates a track list only against one of the same
 * length, track by track, and a track only between values of one type; `auto`
 * is a keyword with no number in it, so `auto` to `0fr` is discrete and the
 * new value applies at once
 */
test('a track that cannot be interpolated applies at once', () => {
  const root = Fantom.createRoot();

  renderPanel(root, 'auto');
  expect(mountedFrame(root, 'panel').height).toBe(40);

  renderPanel(root, '0fr');
  expect(mountedFrame(root, 'panel').height).toBe(0);
  produceFrames(500);
  expect(mountedFrame(root, 'panel').height).toBe(0);
});

test('a track list that changes length applies at once', () => {
  const root = Fantom.createRoot();

  renderPanel(root, '20px');
  expect(mountedFrame(root, 'panel').height).toBe(20);

  renderPanel(root, '30px 10px');
  expect(mountedFrame(root, 'panel').height).toBe(40);
  produceFrames(500);
  expect(mountedFrame(root, 'panel').height).toBe(40);
});

/*
 * Lengths and percentages are both <length-percentage>, which css-values-4
 * combines through calc(), so a length track glides to a percentage track.
 * The panel's height is definite here, so the percentage has something to
 * resolve against.
 */
test('a length track glides to a percentage track', () => {
  const root = Fantom.createRoot();

  const render = (gridTemplateRows: string) => {
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{
            width: 200,
            height: 100,
            display: 'grid',
            gridTemplateRows,
            transitionProperty: 'grid-template-rows',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}>
          <View nativeID="row" collapsable={false} style={{minHeight: 0}} />
        </View>,
      );
    });
  };

  render('20px');
  expect(mountedFrame(root, 'row').height).toBe(20);

  render('60%');
  expect(mountedFrame(root, 'row').height).toBe(20);
  produceFrames(500);
  const row = mountedFrame(root, 'row').height;
  expect(row).toBeGreaterThan(30);
  expect(row).toBeLessThan(50);

  produceFrames(600);
  expect(mountedFrame(root, 'row').height).toBe(60);
});
