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

// Pinned: the document's default font size is the platform's body size, which
// differs per platform, and nothing here is about the type size
const FONT_SIZE = 14;

// `display: contents` is upstream's; these cover its interaction with this
// fork's block and inline display handling and with text children, where the
// run is built from the element tree
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
    // Shrink-to-fit, so the row reports its content's width. Flattened, the two
    // 50pt boxes are items of the row: 100 across.
    const flattened = rectOf(ref => (
      <View ref={ref} style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
        <View style={{display: 'contents'}}>
          <View style={{width: 50, height: 20}} />
          <View style={{width: 50, height: 20}} />
        </View>
      </View>
    ));
    // Not flattened, the wrapper is one item and its column stacks them: 50 across
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
    // A flattened box around bare text: the text joins the parent's inline
    // formatting context
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

  // <span> is inline-level whatever its `display` says and joins a run without
  // `display: contents` being consulted; a block-level <div> that generates no
  // box must not interrupt the line either
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

  // Generating no box does not stop inheritance (css-display-3 §3.1). The
  // absolute height keeps the comparison from passing because neither side
  // applied the size.
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

  // A block-level child becomes a block-level box of the grandparent rather
  // than joining the line
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
