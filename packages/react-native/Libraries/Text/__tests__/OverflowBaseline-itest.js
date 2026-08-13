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
 * Puts a box with text in it on a line of text, and reports how far the box's
 * top sits from the line's — which is decided entirely by the box's baseline.
 */
function measure(boxStyle: $FlowFixMe) {
  const lineRef = createRef<HostInstance>();
  const boxRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        ref={lineRef}
        style={{display: 'block', alignSelf: 'flex-start'}}>
        {'ab'}
        <View ref={boxRef} collapsable={false} style={boxStyle}>
          {'cd'}
        </View>
      </View>,
    );
  });
  const line = rectOf(lineRef);
  const box = rectOf(boxRef);
  return {offset: box.y - line.y, lineHeight: line.height};
}

const BOX = {display: 'inline-block', paddingBlock: 10};

describe('overflow and the inline-block baseline (CSS2 §10.8.1)', () => {
  // With its content visible the box aligns by that content's baseline: the
  // inner text lands on the outer text's baseline, so the box's own top sits
  // flush with the line's.
  it('overflow: visible aligns to the content baseline', () => {
    expect(measure(BOX).offset).toBe(0);
    expect(measure(BOX).lineHeight).toBe(40);
  });

  // Clipped, the content's baseline is meaningless — it can be scrolled or
  // cropped out of sight — so the box aligns by its bottom edge instead. That
  // drops it lower on the line, and the line grows to cover the text's
  // descender below it.
  // The line height is what gives this away, not the box's offset: aligning by
  // the bottom edge makes the box's ascent the largest on the line either way,
  // so it sits at the line's top in both cases. What changes is how much room
  // is left BELOW it — with the box's bottom on the baseline, the text's
  // descender needs 4pt more line.
  it('overflow: hidden aligns by the bottom edge instead', () => {
    const clipped = measure({...BOX, overflow: 'hidden'});
    const visible = measure(BOX);
    expect(clipped.lineHeight).toBe(44);
    expect(clipped.lineHeight).toBeGreaterThan(visible.lineHeight);
  });

  it('overflow: scroll does it too — the rule is "not visible"', () => {
    const scrolled = measure({...BOX, overflow: 'scroll'});
    const clipped = measure({...BOX, overflow: 'hidden'});
    expect(scrolled.offset).toBe(clipped.offset);
    expect(scrolled.lineHeight).toBe(clipped.lineHeight);
  });

  it('a clipped box aligns exactly like one with no line boxes at all', () => {
    // Both routes in §10.8.1 lead to the bottom edge, so they must agree.
    const clipped = measure({...BOX, overflow: 'hidden'});
    const empty = measure({...BOX, height: 40, overflow: 'hidden'});
    expect(clipped.lineHeight).toBe(empty.lineHeight);
  });
});
