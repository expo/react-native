/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/DomElements';

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

function renderSpan(spanStyle: {...}) {
  const blockRef = createRef<HostInstance>();
  const spanRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        ref={blockRef}
        collapsable={false}
        style={{display: 'block', width: 400}}>
        {'aaa '}
        {/* $FlowExpectedError[not-a-component] intrinsic <span> tag */}
        <span ref={spanRef} style={spanStyle}>
          {'bbb'}
        </span>
        {' ccc'}
      </View>,
    );
  });
  return {block: rectOf(blockRef), span: rectOf(spanRef)};
}

describe('what an inline element reports as its box', () => {
  // getBoundingClientRect() reports the BORDER box. For a non-replaced inline
  // that means block-axis padding and borders count toward the reported box
  // even though CSS2 §10.6.1 says they do not grow the line box — the box
  // overflows the line rather than resizing it.
  it('includes block-axis padding in the reported height', () => {
    const bare = renderSpan({});
    const padded = renderSpan({paddingVertical: 8});

    expect(padded.span.height).toBe(bare.span.height + 16);
  });

  it('includes block-axis borders in the reported height', () => {
    const bare = renderSpan({});
    const bordered = renderSpan({borderWidth: 3, borderColor: '#333'});

    expect(bordered.span.height).toBe(bare.span.height + 6);
  });

  // The other half of §10.6.1: that padding must not change the line's height.
  // Together these pin the box as "overflows the line", not "grows it".
  it('block-axis padding does not grow the line box', () => {
    const bare = renderSpan({});
    const padded = renderSpan({paddingVertical: 8});

    expect(padded.block.height).toBe(bare.block.height);
  });

  it('the padded box starts above the bare one by the padding', () => {
    const bare = renderSpan({});
    const padded = renderSpan({paddingVertical: 8});

    expect(bare.span.y - padded.span.y).toBe(8);
  });
});
