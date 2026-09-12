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
 * How many times a node has been cloned into a new tree, which for a node
 * every commit touches is how many commits there have been; the performance
 * cases below count commits with it
 */
function revisionsOf(ref: {current: HostInstance | null}): () => number {
  const get = Fantom.createShadowNodeRevisionGetter(nullthrows(ref.current));
  return () => get() ?? 0;
}

/*
 * `height` is a layout property: the engine lays out once at the destination
 * and glides the mounted views between the two layouts, so the committed tree
 * holds the target for the whole flight (`getBoundingClientRect` reads that)
 * and the interpolation is visible only in the mounted metrics these helpers
 * read
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
   * Read before any frame is produced: the mounted view must not have moved,
   * or the transition arrived on the commit and animates from the target to
   * itself
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
 * Everything below the animating view moves with it, unlike a `scaleY`. The
 * follower declares no transition; its movement is a consequence of the
 * height change, so it rides the same clock.
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
 * `auto` has no number in it, and 10% is not on the way from 10px to 20px:
 * css-transitions-1 makes both discrete, so the value applies at once. An
 * endpoint interpolated as zero would collapse the view for the duration.
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
  // frame it is committed, mounted too, and nothing runs
  render('50%');
  expect(mountedFrame(root, 'box').height).toBe(200);
  // $FlowFixMe[prop-missing] a host instance is a ReactNativeElement here
  expect(nullthrows(viewRef.current).getBoundingClientRect().height).toBe(200);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  expect(mountedFrame(root, 'box').height).toBe(200);
});

/*
 * A percentage to a percentage is interpolable: both resolve against the same
 * containing block
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
  // Halfway between 10% and 50% of 400 is 120
  expect(midway).toBeGreaterThan(90);
  expect(midway).toBeLessThan(150);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(600);
  expect(mountedFrame(root, 'box').height).toBeCloseTo(200, 1);
});

/*
 * Performance as a contract: the author's own commit is the only commit, and
 * every frame after it is mounted metrics. Measured by counting how often a
 * shared ancestor is cloned, since every commit clones the path down to each
 * changed node.
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

  // Thirty frames of interpolation and not one commit
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
   * One clone, the author's own commit: attribution comes from a scratch
   * layout that never enters the tree. Pinned exactly, not bounded.
   */
  const started = revisions();
  expect(started - before).toBe(1);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);

  /*
   * Thirty frames of three views animating add no clones: every frame is
   * mounted metrics with no commit behind it
   */
  expect(revisions() - started).toBe(0);
});

/*
 * Nothing is committed once the transition is over: a frame loop that kept
 * writing the final value would cost a commit per frame for the life of the
 * screen
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
 * A transition declared by the same change it governs: css-transitions-1 §3
 * starts a transition from the after-change style, so adding
 * `transition: height` and changing `height` together animates
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

  // Both at once: the declaration arrives with the change it is for
  render(120, true);
  expect(mountedFrame(root, 'box').height).toBe(20);

  Fantom.runWorkLoop();
  Fantom.unstable_produceFramesForDuration(500);
  const midway = mountedFrame(root, 'box').height;
  expect(midway).toBeGreaterThan(50);
  expect(midway).toBeLessThan(90);
});
