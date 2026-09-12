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

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

/*
 * How many times a node has been cloned into a new tree — which, for a node
 * every commit touches, is how many commits there have been. This is the
 * instrument the performance cases below are built on: the engine's contract
 * is ONE commit per conceptual transition, and counting commits is how that
 * stops being a claim.
 */
function revisionsOf(ref: {current: HostInstance | null}): () => number {
  const get = Fantom.createShadowNodeRevisionGetter(nullthrows(ref.current));
  return () => get() ?? 0;
}

/*
 * `height` is a LAYOUT property, and its transition is read differently from
 * the paint properties' — from the MOUNTED tree, not the committed one.
 *
 * Opacity and friends change what a view paints, so their frames are written
 * straight to the mounted view and `unstable_getDirectManipulationProps`
 * reads them back. A height frame moves other views — siblings below,
 * ancestors around — so the engine lays out ONCE at the destination and
 * glides the mounted views between the two real layouts, the way both
 * platforms' own layout animations do. The committed tree therefore holds the
 * TARGET for the whole flight (`getBoundingClientRect` reads that), and the
 * interpolation is visible only in mounted metrics — which is what these
 * helpers read.
 */
function mountedFrame(
  root: ReturnType<typeof Fantom.createRoot>,
  nativeID: string,
): {x: number, y: number, width: number, height: number} {
  const json = root.getRenderedOutput({includeLayoutMetrics: true}).toJSON();
  let found: ?{[string]: string} = null;
  const visit = (node: unknown) => {
    if (node == null || typeof node !== 'object') {
      return;
    }
    // Untyped JSON from the harness: prop values are all strings.
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
  return {
    x: parseFloat(match[1]),
    y: parseFloat(match[2]),
    width: parseFloat(match[3]),
    height: parseFloat(match[4]),
  };
}

test('a height transition interpolates and lands on the target', () => {
  const root = Fantom.createRoot();

  const render = (height: number) => {
    Fantom.runTask(() => {
      root.render(
        <View
          nativeID="box"
          collapsable={false}
          style={{
            width: 200,
            height,
            transitionProperty: 'height',
            transitionDuration: '1000ms',
            transitionTimingFunction: 'linear',
          }}
        />,
      );
    });
  };

  render(20);
  expect(mountedFrame(root, 'box').height).toBe(20);

  render(120);
  /*
   * Read before any frame is produced: the mounted view must not have moved.
   * This pins the thing a transition is most likely to get wrong — arriving
   * on the commit and animating from the target to itself.
   */
  expect(mountedFrame(root, 'box').height).toBe(20);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  const midway = mountedFrame(root, 'box').height;
  expect(midway).toBeGreaterThan(50);
  expect(midway).toBeLessThan(90);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(600);
  expect(mountedFrame(root, 'box').height).toBeCloseTo(120, 1);
});

/*
 * The reason this property is worth having: everything below the animating
 * view moves with it, which is what an author asking for `transition: height`
 * is asking for. A `scaleY` — the cheap approximation this replaces — leaves
 * the siblings exactly where they were and squashes the content instead.
 *
 * The follower has no transition declared. Its movement is a consequence of
 * the height change, so it rides the same clock — attribution the engine can
 * make exactly, because the transitioned change is committed on its own.
 */
test('a height transition moves the views below it', () => {
  const root = Fantom.createRoot();

  const render = (height: number) => {
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 200}}>
          <View
            collapsable={false}
            style={{
              width: 200,
              height,
              transitionProperty: 'height',
              transitionDuration: '1000ms',
              transitionTimingFunction: 'linear',
            }}
          />
          <View
            nativeID="follower"
            collapsable={false}
            style={{width: 200, height: 10}}
          />
        </View>,
      );
    });
  };

  render(20);
  expect(mountedFrame(root, 'follower').y).toBe(20);

  render(120);
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  const midway = mountedFrame(root, 'follower').y;
  expect(midway).toBeGreaterThan(50);
  expect(midway).toBeLessThan(90);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(600);
  expect(mountedFrame(root, 'follower').y).toBeCloseTo(120, 1);
});

/*
 * `auto` has no number in it, and 10% is not on the way from 10px to 20px.
 * css-transitions-1 makes both DISCRETE: the value applies at once and no
 * transition runs. Worth a test rather than a comment because the failure is
 * silent in the worst way — an endpoint that interpolated as a zero would
 * collapse the view for the duration and then restore it, which reads as a
 * flicker rather than as a bug in an interpolator.
 */
test('a height that cannot be interpolated applies at once', () => {
  const root = Fantom.createRoot();
  const viewRef = createRef<HostInstance>();

  const render = (height: number | string) => {
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 200, height: 400}}>
          <View
            ref={viewRef}
            nativeID="box"
            collapsable={false}
            style={{
              width: 200,
              height,
              transitionProperty: 'height',
              transitionDuration: '1000ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </View>,
      );
    });
  };

  render(20);
  expect(mountedFrame(root, 'box').height).toBe(20);

  // Points to a percentage: not interpolable, so the new value stands on the
  // frame it is committed — in the MOUNTED world too — and nothing runs.
  render('50%');
  expect(mountedFrame(root, 'box').height).toBe(200);
  // $FlowFixMe[prop-missing] a host instance is a ReactNativeElement here
  expect(nullthrows(viewRef.current).getBoundingClientRect().height).toBe(200);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  expect(mountedFrame(root, 'box').height).toBe(200);
});

/*
 * And a percentage to a percentage IS interpolable, because both resolve
 * against the same containing block.
 */
test('percent heights interpolate against the containing block', () => {
  const root = Fantom.createRoot();

  const render = (height: string) => {
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 200, height: 400}}>
          <View
            nativeID="box"
            collapsable={false}
            style={{
              width: 200,
              height,
              transitionProperty: 'height',
              transitionDuration: '1000ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </View>,
      );
    });
  };

  render('10%');
  expect(mountedFrame(root, 'box').height).toBe(40);

  render('50%');
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  const midway = mountedFrame(root, 'box').height;
  // Halfway between 10% and 50% of 400 is 120.
  expect(midway).toBeGreaterThan(90);
  expect(midway).toBeLessThan(150);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(600);
  expect(mountedFrame(root, 'box').height).toBeCloseTo(200, 1);
});

/*
 * PERFORMANCE, as a contract rather than a claim.
 *
 * The engine's promise is ONE commit per conceptual transition: the author's
 * own commit carries the change (rewound), one more carries the transitioned
 * end values, and every frame after that is mounted metrics with no commit
 * behind it at all. Measured by counting how often a shared ancestor is
 * cloned: every commit clones the path down to each changed node.
 */
test('a paint-only transition commits nothing at all', () => {
  const root = Fantom.createRoot();
  const parentRef = createRef<HostInstance>();

  const render = (opacity: number) => {
    Fantom.runTask(() => {
      root.render(
        <View
          ref={parentRef}
          collapsable={false}
          style={{width: 200, height: 400}}>
          <View
            collapsable={false}
            style={{
              width: 200,
              height: 20,
              opacity,
              transitionProperty: 'opacity',
              transitionDuration: '1000ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </View>,
      );
    });
  };

  render(1);
  const revisions = revisionsOf(parentRef);
  render(0);
  const before = revisions();

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);

  // Thirty frames of interpolation and not one commit.
  expect(revisions() - before).toBe(0);
});

test('a height transition costs one commit, however long it runs', () => {
  const root = Fantom.createRoot();
  const parentRef = createRef<HostInstance>();

  const render = (height: number) => {
    const style = {
      width: 200,
      height,
      transitionProperty: 'height',
      transitionDuration: '1000ms',
      transitionTimingFunction: 'linear',
    };
    Fantom.runTask(() => {
      root.render(
        <View ref={parentRef} collapsable={false} style={{width: 200}}>
          <View collapsable={false} style={style} />
          <View collapsable={false} style={style} />
          <View collapsable={false} style={style} />
        </View>,
      );
    });
  };

  render(20);
  const revisions = revisionsOf(parentRef);
  const before = revisions();
  render(120);
  /*
   * ONE clone: the author's own commit, and nothing else. The engine adds no
   * commits at all — attribution comes from a scratch layout that never
   * enters the tree, and every frame after is mounted metrics with no commit
   * behind them. Pinned exactly, not bounded, because this number is the
   * engine's reason to exist.
   */
  const started = revisions();
  expect(started - before).toBe(1);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);

  /*
   * And then thirty frames of three views animating cost NOTHING here: every
   * frame is mounted metrics with no commit behind it. The previous design
   * committed each frame — a tree clone, a Yoga pass, a diff and a mounting
   * transaction, fifteen times over to move a box thirteen points.
   */
  expect(revisions() - started).toBe(0);
});

/*
 * And nothing is committed once the transition is over. A frame loop that
 * kept writing the final value would cost a commit per frame for the life of
 * the screen, which is the kind of thing that never shows up in a screenshot.
 */
test('a finished height transition stops committing', () => {
  const root = Fantom.createRoot();
  const parentRef = createRef<HostInstance>();

  const render = (height: number) => {
    Fantom.runTask(() => {
      root.render(
        <View ref={parentRef} collapsable={false} style={{width: 200}}>
          <View
            collapsable={false}
            style={{
              width: 200,
              height,
              transitionProperty: 'height',
              transitionDuration: '200ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </View>,
      );
    });
  };

  render(20);
  render(120);
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(400);

  const revisions = revisionsOf(parentRef);
  const settled = revisions();
  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  expect(revisions() - settled).toBe(0);
});

/*
 * A transition DECLARED BY THE SAME CHANGE it governs.
 *
 * css-transitions-1 §3 starts a transition from the AFTER-change style: the
 * property list that matters is the one the element has once the change has
 * been made, and the value it starts from is the one it had before. So adding
 * `transition: height` and changing `height` together animates, and a page
 * that does both in one style update gets an animation rather than a jump.
 *
 * Written because a screen relied on it and did not get it — a composer
 * turning the transition on in the same handler that emptied it, and the
 * field snapped. It passes, so the engine was not at fault: the screen's two
 * updates were landing in different commits with the height first, which no
 * amount of spec-conformance here would have fixed. Kept because the property
 * is worth holding, and because the next reader deserves to find the question
 * already answered rather than assume the engine.
 */
test('a transition declared by the same change still runs', () => {
  const root = Fantom.createRoot();

  const render = (height: number, eases: boolean) => {
    Fantom.runTask(() => {
      root.render(
        <View
          nativeID="box"
          collapsable={false}
          style={{
            width: 200,
            height,
            ...(eases
              ? {
                  transitionProperty: 'height',
                  transitionDuration: '1000ms',
                  transitionTimingFunction: 'linear',
                }
              : null),
          }}
        />,
      );
    });
  };

  render(20, false);
  expect(mountedFrame(root, 'box').height).toBe(20);

  // Both at once: the declaration arrives with the change it is for.
  render(120, true);
  expect(mountedFrame(root, 'box').height).toBe(20);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  const midway = mountedFrame(root, 'box').height;
  expect(midway).toBeGreaterThan(50);
  expect(midway).toBeLessThan(90);
});
