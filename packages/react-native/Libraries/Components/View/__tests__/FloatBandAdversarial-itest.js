/**
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/*
 * Floats that fit nowhere, and floats whose bands are degenerate.
 *
 * `findFloatBand` drops to the nearest float bottom ahead of it when a float
 * does not fit, and the loop is total only because such a bottom always
 * exists: the retry path is entered only when a float INTRUDES on the band,
 * and a float intruding on a band beginning at `top` ends below `top`. That is
 * an argument, not a test, so these are the inputs that would break it —
 * zero-height floats, floats wider than their container, and floats
 * overlapping at a single edge.
 *
 * What they assert is only that layout terminates and stays self-consistent: a
 * float that fits nowhere still gets a position, and every float still gets
 * recorded. The exact coordinates are not the point and are not pinned here;
 * `text-conformance` pins those against Safari.
 */
function rectsOf(
  children: React.Node,
  refs: Array<React$RefObject<HostInstance | null>>,
): Array<{x: number, y: number, width: number}> {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={{display: 'block', width: 300, overflow: 'hidden'}}>
        {children}
      </View>,
    );
  });
  const out = refs.map(r => {
    const b = ensureInstance(
      r.current,
      ReactNativeElement,
    ).getBoundingClientRect();
    return {x: b.x, y: b.y, width: b.width};
  });
  root.destroy();
  return out;
}

function refsFor(count: number): Array<React$RefObject<HostInstance | null>> {
  const refs = [];
  for (let i = 0; i < count; i++) {
    refs.push(createRef<HostInstance>());
  }
  return refs;
}

describe('a float that fits nowhere', () => {
  it('is still placed when it is wider than its container', () => {
    const refs = refsFor(2);
    const rects = rectsOf(
      [
        <View
          key="a"
          ref={refs[0]}
          style={{float: 'left', width: 200, height: 20}}
        />,
        // 400 in a 300 container: it cannot fit beside the first float and it
        // cannot fit on a line of its own either.
        <View
          key="b"
          ref={refs[1]}
          style={{float: 'left', width: 400, height: 20}}
        />,
      ],
      refs,
    );
    expect(rects[0]).toEqual({x: 0, y: 0, width: 200});
    // Below the first rather than beside it, and not at the origin — which is
    // where an unplaced float would have been left.
    expect(rects[1].y).toBeGreaterThan(0);
    expect(rects[1].x).toBe(0);
  });

  it('terminates when every float has zero height', () => {
    const refs = refsFor(3);
    const rects = rectsOf(
      [
        <View
          key="a"
          ref={refs[0]}
          style={{float: 'left', width: 200, height: 0}}
        />,
        <View
          key="b"
          ref={refs[1]}
          style={{float: 'left', width: 200, height: 0}}
        />,
        <View
          key="c"
          ref={refs[2]}
          style={{float: 'left', width: 200, height: 0}}
        />,
      ],
      refs,
    );
    // Zero-height bands touch only at an edge, which `floatIntrusion` treats
    // as no overlap — so each float sees an empty band and packs at the start.
    // Reaching this assertion at all is the result: the search returned.
    expect(rects).toHaveLength(3);
    for (const r of rects) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });

  it('terminates for a zero-height float behind a tall one', () => {
    const refs = refsFor(2);
    const rects = rectsOf(
      [
        <View
          key="a"
          ref={refs[0]}
          style={{float: 'left', width: 280, height: 40}}
        />,
        // No room beside the first, and no height of its own to drop past it
        // with.
        <View
          key="b"
          ref={refs[1]}
          style={{float: 'left', width: 100, height: 0}}
        />,
      ],
      refs,
    );
    expect(rects[0].width).toBe(280);
    expect(Number.isFinite(rects[1].y)).toBe(true);
  });
});
