/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * Native block margin collapsing — Stage 3 of text-children-plan.md §4.5
 * (CSS2 §8.3.1). Every expectation is pinned against real Safari (block
 * container as a flex item, i.e. an independent formatting context, so
 * first/last child margins are contained; sibling margins collapse):
 *
 *   - adjacent siblings: gap = max(positives) + min(negatives)
 *   - self-collapsing (zero-height) boxes collapse through
 *   - first/last child margins are contained at the container edges
 *
 * Only the NATIVE block path collapses; the flex emulation cannot (flex
 * items don't collapse margins) — that fidelity gap is why Stage 3 is
 * native-only.
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

describe('adjacent sibling margins collapse (CSS2 §8.3.1)', () => {
  it('positive margins collapse to the larger one', () => {
    const blockRef = createRef<HostInstance>();
    const secondRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: 20}} />
          <View
            collapsable={false}
            ref={secondRef}
            style={{height: 10, marginTop: 30}}
          />
        </View>,
      );
    });

    // Safari: 10 + max(20, 30) + 10 = 50 (uncollapsed would be 60).
    expect(rectOf(blockRef).height).toBe(50);
    expect(rectOf(secondRef).y - rectOf(blockRef).y).toBe(40);
  });

  it('mixed-sign margins collapse to their sum', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: -10}} />
          <View style={{height: 10, marginTop: 30}} />
        </View>,
      );
    });

    // Safari: 10 + (-10 + 30) + 10 = 40.
    expect(rectOf(blockRef).height).toBe(40);
  });

  it('negative margins collapse to the most negative one', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: -10}} />
          <View style={{height: 10, marginTop: -20}} />
        </View>,
      );
    });

    // Safari: 10 + min(-10, -20) + 10 = 0 — the children overlap fully.
    expect(rectOf(blockRef).height).toBe(0);
  });

  it('an anonymous text run has zero margin: gap is just the block margin', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', alignSelf: 'flex-start'}}>
          {'a'}
          <View style={{height: 10, marginTop: 10, marginBottom: 10}} />
          {'b'}
        </View>,
      );
    });

    // Safari: run 'a' (20) + collapse(0, 10) + 10 + collapse(10, 0) + run 'b'
    // (20) = 70.
    expect(rectOf(blockRef).height).toBe(70);
  });
});

describe('self-collapsing boxes collapse through (CSS2 §8.3.1)', () => {
  it('a zero-height child folds all four adjoining margins into one', () => {
    const blockRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: 10}} />
          <View style={{marginTop: 5, marginBottom: 30}} />
          <View style={{height: 10, marginTop: 10}} />
        </View>,
      );
    });

    // Safari: 10 + max(10, 5, 30, 10) + 10 = 50 (uncollapsed would be 75).
    expect(rectOf(blockRef).height).toBe(50);
  });
});

describe('nested block-in-block margins escape (collapse through, Stage 3b)', () => {
  it("a nested block's first-child margin escapes to the outer flow", () => {
    // outer(block, BFC root) > mid(block) > inner(h10, mt20): the 20pt margin
    // collapses through mid's top edge — mid stays 10pt tall, sits 20pt down.
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const innerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View collapsable={false} ref={midRef} style={{display: 'block'}}>
            <View
              collapsable={false}
              ref={innerRef}
              style={{height: 10, marginTop: 20}}
            />
          </View>
        </View>,
      );
    });

    // Safari: e1outer=30, e1mid=10@20, e1inner@0.
    expect(rectOf(outerRef).height).toBe(30);
    expect(rectOf(midRef).height).toBe(10);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(20);
    expect(rectOf(innerRef).y - rectOf(midRef).y).toBe(0);
  });

  it('an escaped margin collapses with the preceding sibling margin', () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: 10}} />
          <View collapsable={false} ref={midRef} style={{display: 'block'}}>
            <View style={{height: 10, marginTop: 30}} />
          </View>
        </View>,
      );
    });

    // Safari: e2outer=50, e2mid=10@40 — gap = max(10, 30) = 30.
    expect(rectOf(outerRef).height).toBe(50);
    expect(rectOf(midRef).height).toBe(10);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(40);
  });

  it("a nested block's last-child margin escapes through its bottom edge", () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View collapsable={false} ref={midRef} style={{display: 'block'}}>
            <View style={{height: 10, marginBottom: 25}} />
          </View>
          <View style={{height: 10, marginTop: 10}} />
        </View>,
      );
    });

    // Safari: e3outer=45, e3mid=10@0 — gap = max(25, 10) = 25.
    expect(rectOf(outerRef).height).toBe(45);
    expect(rectOf(midRef).height).toBe(10);
  });

  it('padding on the nested block stops the escape', () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View
            collapsable={false}
            ref={midRef}
            style={{display: 'block', paddingTop: 5}}>
            <View style={{height: 10, marginTop: 20}} />
          </View>
        </View>,
      );
    });

    // Safari: e4outer=35, e4mid=35@0 — the margin is contained inside mid.
    expect(rectOf(outerRef).height).toBe(35);
    expect(rectOf(midRef).height).toBe(35);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(0);
  });

  it('a flex middle container contains the margin (independent FC)', () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View collapsable={false} ref={midRef}>
            <View style={{height: 10, marginTop: 20}} />
          </View>
        </View>,
      );
    });

    // Safari: e5outer=30, e5mid=30@0.
    expect(rectOf(outerRef).height).toBe(30);
    expect(rectOf(midRef).height).toBe(30);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(0);
  });

  it('escapes chain through multiple nested blocks', () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const inner2Ref = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View collapsable={false} ref={midRef} style={{display: 'block'}}>
            <View
              collapsable={false}
              ref={inner2Ref}
              style={{display: 'block'}}>
              <View style={{height: 10, marginTop: 20}} />
            </View>
          </View>
        </View>,
      );
    });

    // Safari: e6outer=30, e6mid=10@20, e6inner2=10@0.
    expect(rectOf(outerRef).height).toBe(30);
    expect(rectOf(midRef).height).toBe(10);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(20);
    expect(rectOf(inner2Ref).y - rectOf(midRef).y).toBe(0);
  });

  it("the nested block's own margin collapses with sibling and escaped margins", () => {
    const outerRef = createRef<HostInstance>();
    const midRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{display: 'block'}}>
          <View style={{height: 10, marginBottom: 5}} />
          <View
            collapsable={false}
            ref={midRef}
            style={{display: 'block', marginTop: 10}}>
            <View style={{height: 10, marginTop: 30}} />
          </View>
        </View>,
      );
    });

    // Safari: e7outer=50, e7mid=10@40 — gap = max(5, 10, 30) = 30.
    expect(rectOf(outerRef).height).toBe(50);
    expect(rectOf(midRef).height).toBe(10);
    expect(rectOf(midRef).y - rectOf(outerRef).y).toBe(40);
  });
});

describe('first/last child margins are contained (independent formatting context)', () => {
  it('leading and trailing margins stay inside the container', () => {
    const blockRef = createRef<HostInstance>();
    const childRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
          <View
            collapsable={false}
            ref={childRef}
            style={{height: 10, marginTop: 10, marginBottom: 15}}
          />
        </View>,
      );
    });

    // Safari (block container as flex item — an independent formatting
    // context): 10 + 10 + 15 = 35; child sits 10 below the container top.
    expect(rectOf(blockRef).height).toBe(35);
    expect(rectOf(childRef).y - rectOf(blockRef).y).toBe(10);
  });

  it('horizontal margins offset the child once and shrink its auto width', () => {
    // Horizontal margins never collapse (CSS2 §8.3.1 is vertical-only). The
    // child's border box starts at its margin and auto width fills the rest.
    // Also guards the (previously latent) double-counted leading margin:
    // Node::setPosition already bakes the margin into the layout position.
    const blockRef = createRef<HostInstance>();
    const childRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', width: 200}}>
          <View
            collapsable={false}
            ref={childRef}
            style={{height: 10, marginLeft: 15, marginRight: 25}}
          />
        </View>,
      );
    });

    expect(rectOf(childRef).x - rectOf(blockRef).x).toBe(15);
    expect(rectOf(childRef).width).toBe(160);
  });

  it('a definite container height is unaffected by collapsing', () => {
    const blockRef = createRef<HostInstance>();
    const secondRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={blockRef}
          style={{display: 'block', height: 100}}>
          <View style={{height: 10, marginBottom: 20}} />
          <View
            collapsable={false}
            ref={secondRef}
            style={{height: 10, marginTop: 30}}
          />
        </View>,
      );
    });

    expect(rectOf(blockRef).height).toBe(100);
    // Children still stack with the collapsed 30pt gap.
    expect(rectOf(secondRef).y - rectOf(blockRef).y).toBe(40);
  });
});
