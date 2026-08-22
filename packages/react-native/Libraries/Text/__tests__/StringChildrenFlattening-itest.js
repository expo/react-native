/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableViewCulling:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

// Real <span>/<b>/<em>: the nested-inline cases below are about the element
// vocabulary specifically, and a nested <Text> is a different code path.
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/*
 * String children vs Fabric's view flattening and view culling.
 *
 * Flattening removes visually-insignificant Views from the mounted hierarchy
 * (no FormsView trait -> never mounted). It is a MOUNT-side optimization; the
 * style cascade is SHADOW-side. These tests pin the contract between them:
 *
 *  - a plain intermediate View stays flattened even when it carries
 *    inheritable text styles (the styles need no mounted view to cascade);
 *  - a View that renders text runs must NOT be flattened (it paints);
 *  - document order survives a flattened sibling's children being hoisted;
 *  - culling a run container off-viewport and restoring it round-trips the
 *    painted text intact.
 *
 * Mount-level assertions use takeMountingManagerLogs (a flattened View never
 * appears in Create/Insert), paint assertions use rendered output.
 */

const RED = 'rgba(255, 0, 0, 1)';
const BLUE = 'rgba(0, 0, 255, 1)';

function renderedText(root: Fantom.Root): string {
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ) ?? ''
  );
}

// NOTE: `nativeID` itself defeats flattening (it must ride on a mounted
// view), so a would-be-flattened View can never be tagged with one. These
// tests detect flattening by COUNTING View creates instead.
function viewCreateCount(logs: Array<string>): number {
  return logs.filter(l => l.startsWith('Create {type: "View"')).length;
}

test('an intermediate View with ONLY inheritable text styles stays flattened', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="outer">
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View style={{color: 'red'}}>
          <View collapsable={false} nativeID="inner">
            bare text under a styled, flattened ancestor
          </View>
        </View>
      </View>,
    );
  });

  const logs = root.takeMountingManagerLogs();
  // The middle View sets nothing visually significant of its own — the
  // inheritable keys cascade in the shadow tree and must not force it into
  // the mounted hierarchy: exactly outer + inner mount.
  expect(viewCreateCount(logs)).toBe(2);
  expect(logs.join('\n')).toContain('nativeID: "inner"');
  // ...and the cascade still flowed through the flattened node.
  expect(renderedText(root)).toContain(RED);
});

test('a View with bare-text runs is never flattened', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="outer">
        {/* No collapsable={false}: the runs themselves must force mounting. */}
        <View nativeID="text-bearing">paints its own text</View>
      </View>,
    );
  });

  const logs = root.takeMountingManagerLogs().join('\n');
  expect(logs).toContain('nativeID: "text-bearing"');
  expect(renderedText(root)).toContain('paints its own text');
});

test('document order survives a flattened sibling between runs', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        {'before '}
        <View>
          <View
            collapsable={false}
            nativeID="hoisted"
            style={{height: 8, backgroundColor: 'blue'}}
          />
        </View>
        {' after'}
      </View>,
    );
  });

  const logs = root.takeMountingManagerLogs();
  // The wrapper flattens; its visible child hoists into the container:
  // exactly container + hoisted mount.
  expect(viewCreateCount(logs)).toBe(2);
  expect(logs.join('\n')).toContain('nativeID: "hoisted"');
  // Both runs survive, in document order around the hoisted child.
  const out = renderedText(root);
  expect(out).toContain('before');
  expect(out).toContain('after');
  expect(out.indexOf('before')).toBeLessThan(out.indexOf('after'));
});

test('updating an inheritable style on a flattened ancestor restyles the text below', () => {
  let setColor: string => void = () => {};
  function Tree(): React.Node {
    const [color, set] = useState('blue');
    setColor = set;
    return (
      <View collapsable={false} nativeID="outer">
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View style={{color}}>
          <View collapsable={false} nativeID="inner">
            recolored through a flattened node
          </View>
        </View>
      </View>
    );
  }
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<Tree />);
  });
  expect(renderedText(root)).toContain(BLUE);
  root.takeMountingManagerLogs();

  Fantom.runTask(() => {
    setColor('red');
  });
  expect(renderedText(root)).toContain(RED);
  // The restyle must not have unflattened anything: no Create mutations,
  // only updates to already-mounted views.
  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(0);
});

test('culling removes and restores a run container with its text intact', () => {
  const scrollRef = createRef<HostInstance>();
  const root = Fantom.createRoot({viewportWidth: 100, viewportHeight: 100});
  Fantom.runTask(() => {
    root.render(
      <ScrollView style={{height: 100, width: 100}} ref={scrollRef}>
        <View style={{height: 150}} collapsable={false} />
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View nativeID="prose" style={{color: 'red', width: 100}}>
          culled prose
        </View>
      </ScrollView>,
    );
  });

  // Below the fold: culling must have kept it out of the mounted tree.
  expect(root.takeMountingManagerLogs().join('\n')).not.toContain(
    'nativeID: "prose"',
  );
  expect(renderedText(root)).not.toContain('culled prose');

  Fantom.scrollTo(scrollRef, {x: 0, y: 120});
  // In view: the container mounts and paints its styled run.
  expect(root.takeMountingManagerLogs().join('\n')).toContain(
    'nativeID: "prose"',
  );
  const out = renderedText(root);
  expect(out).toContain('culled prose');
  expect(out).toContain(RED);

  Fantom.scrollTo(scrollRef, {x: 0, y: 0});
  // Culled again on the way out.
  expect(root.takeMountingManagerLogs().join('\n')).toContain('Delete');
  expect(renderedText(root)).not.toContain('culled prose');
});

test('a nested <Text> inside a flattened ancestor still isolates by default', () => {
  // Flattening must not change the boundary story: root <Text> under a
  // styled, flattened View keeps old semantics.
  const boundedRef = createRef<HostInstance>();
  const controlRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        <View collapsable={false}>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            <Text ref={boundedRef}>boundary probe</Text>
          </View>
        </View>
        <Text ref={controlRef}>boundary probe</Text>
      </>,
    );
  });

  const bounded = boundedRef.current?.getBoundingClientRect();
  const control = controlRef.current?.getBoundingClientRect();
  expect(bounded?.height).toBe(control?.height);
});

/*
 * Flattening is a MOUNT-side optimization; everything below is decided in the
 * shadow tree. These three pin that separation for the surfaces that would
 * quietly break if it ever stopped holding — geometry, events, and the styling
 * of nested inline elements — by rendering each case twice, once with
 * flattenable wrappers and once with the same wrappers pinned, and asserting
 * the two agree. Stated as a pair rather than an absolute so the invariant is
 * the assertion, not a number that drifts with font metrics.
 */

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

test('bounding rects are unchanged by flattening', () => {
  const flatOuter = createRef<HostInstance>();
  const flatBold = createRef<HostInstance>();
  const pinnedOuter = createRef<HostInstance>();
  const pinnedBold = createRef<HostInstance>();
  const root = Fantom.createRoot();

  const body = (
    outer: {current: HostInstance | null},
    bold: {current: HostInstance | null},
  ) => (
    <View
      ref={outer}
      collapsable={false}
      style={{display: 'block', alignSelf: 'flex-start'}}>
      {'aaa '}
      {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
      <b ref={bold}>bold</b>
      {' tail'}
    </View>
  );

  Fantom.runTask(() => {
    root.render(
      <View collapsable={false}>
        {/* Prop-less wrappers: these flatten away entirely. */}
        <View>
          <View>{body(flatOuter, flatBold)}</View>
        </View>
        {/* The same shape with every wrapper pinned into the hierarchy. */}
        <View collapsable={false}>
          <View collapsable={false}>{body(pinnedOuter, pinnedBold)}</View>
        </View>
      </View>,
    );
  });

  // FIRST prove the premise: the flattenable half really did flatten, or the
  // comparison below is two identical trees agreeing about nothing. Four
  // wrappers were authored (two per half) and only the two pinned ones may
  // survive, alongside the two run containers and the outer container.
  const logs = root.takeMountingManagerLogs();
  expect(viewCreateCount(logs)).toBe(5);

  const flat = rectOf(flatBold);
  const pinned = rectOf(pinnedBold);

  // The element has a real box at all — guards the geometry pass skipping a
  // run that DOES carry an element.
  expect(flat.width).toBeGreaterThan(0);
  expect(flat.x - rectOf(flatOuter).x).toBe(pinned.x - rectOf(pinnedOuter).x);
  expect(flat.width).toBe(pinned.width);
  expect(flat.height).toBe(pinned.height);
});

test('DOM events still target and bubble through flattened ancestors', () => {
  const events: Array<string> = [];
  const boldRef = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // Prop-less wrappers between the handler and the element: all flatten.
      <View>
        <View>
          <View
            collapsable={false}
            style={{display: 'block', width: 400}}
            onClick={() => {
              events.push('container');
            }}>
            {'before '}
            {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
            <b
              ref={boldRef}
              onClick={() => {
                events.push('bold');
              }}>
              press me
            </b>
            {' after'}
          </View>
        </View>
      </View>,
    );
  });

  // Premise: the two wrappers between the handler and the element really are
  // gone from the mounted hierarchy — only the run container survives.
  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(1);

  const bold = ensureInstance(boldRef.current, ReactNativeElement);
  Fantom.runOnUIThread(() => {
    Fantom.dispatchNativeEvent(bold, 'click');
  });
  Fantom.runWorkLoop();

  // Target first, then the ancestor — the flattened wrappers are not in the
  // mounted hierarchy and must not appear in, or interrupt, the path.
  expect(events).toEqual(['bold', 'container']);
});

test('nested inline elements keep their own styles under a flattened ancestor', () => {
  const flatEm = createRef<HostInstance>();
  const pinnedEm = createRef<HostInstance>();
  const root = Fantom.createRoot();

  // <span> sets a size, <b> nests inside it, <em> nests inside that. Each
  // level contributes, so the innermost box is only right if the whole chain
  // resolved — through wrappers that are gone by mount time.
  const body = (em: {current: HostInstance | null}) => (
    <View
      collapsable={false}
      style={{display: 'block', alignSelf: 'flex-start'}}>
      {'x '}
      {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
      <span style={{fontSize: 24}}>
        {'s '}
        {/* $FlowExpectedError[not-a-component] intrinsic <b> tag */}
        <b>
          {'b '}
          {/* $FlowExpectedError[not-a-component] intrinsic <em> tag */}
          <em ref={em}>deep</em>
        </b>
      </span>
    </View>
  );

  Fantom.runTask(() => {
    root.render(
      <View collapsable={false}>
        <View>
          <View>{body(flatEm)}</View>
        </View>
        <View collapsable={false}>
          <View collapsable={false}>{body(pinnedEm)}</View>
        </View>
      </View>,
    );
  });

  // Premise, as above: the flattenable half flattened.
  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(5);

  const flat = rectOf(flatEm);
  const pinned = rectOf(pinnedEm);

  // Inherited 24pt through span -> b -> em makes the box taller than the
  // 14pt default; if the chain had broken it would collapse to default size.
  expect(flat.height).toBeGreaterThan(0);
  expect(flat.height).toBe(pinned.height);
  expect(flat.width).toBe(pinned.width);
});
