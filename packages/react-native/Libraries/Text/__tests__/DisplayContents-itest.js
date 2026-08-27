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

/*
 * The type size these measurements were calibrated against.
 *
 * Stated rather than inherited: the document's default font size is the
 * platform's own body size (17pt on iOS, 16sp on Android) rather than React
 * Native's historical 14, so a fixture that leaves it unset measures a
 * different number of points on each platform and moved the day that default
 * did. Nothing here is about the type size, so pinning it is what keeps these
 * assertions about the property they name.
 */
const FONT_SIZE = 14;

// `display: contents` is upstream's, and already in this fork. What was not
// covered is whether it survives this fork's OWN display handling (block and
// inline) and composes with text children — which is where a flattened box is
// most likely to go wrong, since the run is built from the element tree.
function rectOf(render: ({current: HostInstance | null}) => React.Node) {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} style={{width: 400, fontSize: FONT_SIZE}}>
        {render(ref)}
      </View>,
    );
  });
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

describe('display: contents', () => {
  it('flattens the box: children become flex items of the grandparent', () => {
    // Shrink-to-fit, so the row reports its CONTENT's width rather than the
    // 400 its parent would otherwise stretch it to.
    // Flattened, the two 50pt boxes are items of the row: 100 across.
    const flattened = rectOf(ref => (
      <View ref={ref} style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
        <View style={{display: 'contents'}}>
          <View style={{width: 50, height: 20}} />
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    // Not flattened, the wrapper is ONE item and its own column stacks them,
    // so the row is only 50 across. That difference is the whole property.
    const nested = rectOf(ref => (
      <View ref={ref} style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
        <View>
          <View style={{width: 50, height: 20}} />
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    expect(nested.width).toBe(50);
    expect(flattened.width).toBe(100);
  });

  it('a contents box has no box of its own', () => {
    const wrapper = rectOf(ref => (
      <View style={{flexDirection: 'row'}}>
        <View ref={ref} style={{display: 'contents'}}>
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    // A generated box would be 50x20; a flattened one contributes nothing.
    expect(wrapper.width).toBe(0);
    expect(wrapper.height).toBe(0);
  });

  it('composes with text children: text inside contents still joins the run', () => {
    // The interesting interaction for this fork — a flattened box around bare
    // text. On the web the text joins the parent's inline formatting context.
    const box = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{display: 'contents'}}>{'bb'}</span>
      </div>
    ));
    // 4 characters at 10pt each, on one line, if the text joined the run.
    expect(box.width).toBe(40);
    expect(box.height).toBe(20);
  });

  // The case above passes for a reason that does not generalise: <span> is
  // inline-level whatever its `display` says, so it joins a run without
  // `display: contents` being consulted at all. A <div> is block-level, and a
  // box that generates no box must not interrupt the line either.
  it('a block-level contents box does not interrupt the line', () => {
    const box = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
        <div style={{display: 'contents'}}>{'bb'}</div>
      </div>
    ));
    expect(box.width).toBe(40);
    expect(box.height).toBe(20);
  });

  it('nested contents boxes are transparent all the way down', () => {
    const box = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
        <div style={{display: 'contents'}}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div style={{display: 'contents'}}>{'bb'}</div>
        </div>
      </div>
    ));
    expect(box.width).toBe(40);
    expect(box.height).toBe(20);
  });

  // Generating no box does not stop the element inheriting to its children,
  // so text it wraps is styled by it exactly as an inline box would style it
  // (css-display-3 §3.1). Stated as a comparison AND an absolute height: the
  // comparison is the property under test, the height keeps it from passing
  // because neither side applied the size.
  it('a contents box styles the text it wraps, like an inline box', () => {
    const viaContents = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
        <div style={{display: 'contents', fontSize: FONT_SIZE * 2}}>{'bb'}</div>
      </div>
    ));
    const viaSpan = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span style={{fontSize: FONT_SIZE * 2}}>{'bb'}</span>
      </div>
    ));
    // A 28pt line, not the 20pt one the surrounding 14pt type would give.
    expect(viaContents.height).toBe(34);
    expect(viaContents.height).toBe(viaSpan.height);
  });

  // Transparency is for inline content only. Hoisting a block-level child into
  // a line is not what the spec asks for — it becomes a block-level box of the
  // grandparent, which is what Yoga's own hoisting already does.
  it('a block-level child inside a contents box still breaks the line', () => {
    const box = rectOf(ref => (
      // $FlowExpectedError[not-a-component] intrinsic <div> tag
      <div ref={ref} style={{alignSelf: 'flex-start'}}>
        {'aa'}
        {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
        <div style={{display: 'contents'}}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div>{'bb'}</div>
        </div>
      </div>
    ));
    expect(box.width).toBe(20);
    expect(box.height).toBe(40);
  });
});
