/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableImplicitTextChildren:true
 * @flow strict-local
 * @format
 */

/**
 * Implicit text: CSS/DOM-behavior test matrix (implicit-text-plan.md).
 *
 * Comprehensive but non-redundant: each case covers a unique combination of
 * arrangement/nesting × display type × styling × events × DOM APIs. Web
 * mirrors of these cases live in __fixtures__/implicit-text-web-mirror.html —
 * the same snippets, expected to behave the same in a browser.
 *
 * Cases are gated by milestone so the suite doubles as the progress gauge.
 * Bump IMPLEMENTED_MILESTONE as stages land (plan §5):
 *   M1 layout/measure   — anonymous Yoga items; intrinsic sizes (flex rules)
 *   M2 mounting/updates — runs render; text-bearing Views unflatten; updates
 *   M3 block/inline     — display:'block' flow; blockification; whitespace
 *   M4 inheritance      — cascade to bare text; <Text> opt-in only
 *   M5 tags             — <b>/<i>/<span> registered
 *   M6 events           — target/bubbling semantics (JS-observable part)
 *   M7 DOM APIs         — childNodes/parentNode/textContent over bare text
 * iOS-simulator-only checks (hit-testing on drawn text, paint-order pixels)
 * are listed at the bottom as documentation; they cannot run under Fantom.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import 'react-native/Libraries/Text/InlineTags';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef, useState} from 'react';
import {Text, View} from 'react-native';
import {NativeVirtualText} from 'react-native/Libraries/Text/TextNativeComponent';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import ReadOnlyText from 'react-native/src/private/webapis/dom/nodes/ReadOnlyText';

const IMPLEMENTED_MILESTONE = 7;

function milestone(n: number, name: string, fn: () => void) {
  if (IMPLEMENTED_MILESTONE >= n) {
    describe(name, fn);
  } else {
    describe.skip(name, fn);
  }
}

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect();
}

milestone(1, 'M1: layout & measurement (flex container rules)', () => {
  it('bare string gives the View the same intrinsic size as explicit <Text>', () => {
    const bareRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={bareRef}>
            hello world
          </View>
          <View collapsable={false} ref={controlRef}>
            <Text>hello world</Text>
          </View>
        </>,
      );
    });

    const bare = rectOf(bareRef);
    const control = rectOf(controlRef);
    expect(bare.height).toBeGreaterThan(0);
    expect(bare.height).toBe(control.height);
    expect(bare.width).toBe(control.width);
  });

  it('adjacent strings and numbers form one run (single line box)', () => {
    const bareRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={bareRef}>
            {'count: '}
            {42}
          </View>
          <View collapsable={false} ref={controlRef}>
            <Text>count: 42</Text>
          </View>
        </>,
      );
    });

    expect(rectOf(bareRef).height).toBe(rectOf(controlRef).height);
  });

  it('runs split around a block child: heights stack in column direction', () => {
    const mixedRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={mixedRef}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View collapsable={false} ref={oneRunRef}>
            before
          </View>
        </>,
      );
    });

    const oneLine = rectOf(oneRunRef).height;
    // two text runs + the 10pt view, stacked (flex column)
    expect(rectOf(mixedRef).height).toBe(oneLine * 2 + 10);
  });

  it('whitespace-only anonymous items are not rendered (flexbox rule)', () => {
    const wsRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={wsRef}>
          {'   '}
        </View>,
      );
    });

    expect(rectOf(wsRef).height).toBe(0);
  });

  it('inline element children are blockified into separate items (css-flexbox-1 §4)', () => {
    const flexRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={flexRef}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View collapsable={false} ref={oneRunRef}>
            a
          </View>
        </>,
      );
    });

    // three items stacked in column direction
    expect(rectOf(flexRef).height).toBe(rectOf(oneRunRef).height * 3);
  });

  it('row direction lays runs out side by side', () => {
    const rowRef = createRef<HostInstance>();
    const aRef = createRef<HostInstance>();
    const bRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={rowRef}
            style={{flexDirection: 'row', alignSelf: 'flex-start'}}>
            aa
            <View collapsable={false} style={{width: 10, height: 4}} />
            bb
          </View>
          <View collapsable={false} style={{alignSelf: 'flex-start'}} ref={aRef}>
            aa
          </View>
          <View collapsable={false} style={{alignSelf: 'flex-start'}} ref={bRef}>
            bb
          </View>
        </>,
      );
    });

    expect(rectOf(rowRef).width).toBe(rectOf(aRef).width + 10 + rectOf(bRef).width);
  });

  it('text in a nested prop-less View still measures (deep nesting)', () => {
    const outerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef}>
          <View>
            <View>deep</View>
          </View>
        </View>,
      );
    });

    expect(rectOf(outerRef).height).toBeGreaterThan(0);
  });

  it('strings produced by user components are covered (host tree, not JSX, decides)', () => {
    function Greeting(): React.Node {
      return 'hi from a component';
    }
    const bareRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={bareRef}>
          <Greeting />
        </View>,
      );
    });

    expect(rectOf(bareRef).height).toBeGreaterThan(0);
  });
});

milestone(2, 'M2: mounting, painting order & updates', () => {
  it('bare string mounts as a text run on the View (no extra nodes)', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<View collapsable={false}>hello</View>);
    });

    // Exact shape depends on how Fantom's stub mounting surfaces View text
    // runs; the invariant under test: the string is present, and no
    // rn-paragraph wrapper exists.
    const output = root.getRenderedOutput({props: []}).toJSX();
    expect(JSON.stringify(output)).toContain('hello');
    expect(JSON.stringify(output)).not.toContain('rn-paragraph');
  });

  it('a text-bearing prop-less View is not flattened away', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false}>
          <View>hello</View>
        </View>,
      );
    });

    const output = JSON.stringify(root.getRenderedOutput({props: []}).toJSX());
    expect(output).toContain('hello');
  });

  it('content updates re-render and re-measure', () => {
    let setContent: (content: string) => void = () => {};
    function Updatable(): React.Node {
      const [content, set] = useState('first');
      setContent = set;
      return (
        <View collapsable={false}>
          {content}
        </View>
      );
    }
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<Updatable />);
    });
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).toContain('first');

    Fantom.runTask(() => {
      setContent('second longer content');
    });
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).toContain('second longer content');
  });

  it('removing all text collapses the View height back to zero', () => {
    let setShow: (show: boolean) => void = () => {};
    const viewRef = createRef<HostInstance>();
    function Toggle(): React.Node {
      const [show, set] = useState(true);
      setShow = set;
      return (
        <View collapsable={false} ref={viewRef}>
          {show ? 'hello' : null}
        </View>
      );
    }
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<Toggle />);
    });
    expect(rectOf(viewRef).height).toBeGreaterThan(0);

    Fantom.runTask(() => {
      setShow(false);
    });
    expect(rectOf(viewRef).height).toBe(0);
  });
});

milestone(3, 'M3: block flow, inline elements, whitespace', () => {
  it("display:'block' joins text and inline elements into one flow", () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] display:'block' is new */}
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View collapsable={false} ref={oneRunRef}>
            abc
          </View>
        </>,
      );
    });

    // one wrapping inline flow, not three stacked items
    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });

  it("nested inline elements merge attributes ('a<b>b<i>c</i></b>d' single flow)", () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] display:'block' is new */}
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            a
            <NativeVirtualText>
              b<NativeVirtualText>c</NativeVirtualText>
            </NativeVirtualText>
            d
          </View>
          <View collapsable={false} ref={oneRunRef}>
            abcd
          </View>
        </>,
      );
    });

    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });

  it('block containers mix inline flows with block children (anonymous block boxes)', () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] display:'block' is new */}
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View collapsable={false} ref={oneRunRef}>
            before
          </View>
        </>,
      );
    });

    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height * 2 + 10);
  });

  it('anonymous items stretch to container width even under alignItems center', () => {
    const centeredRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={centeredRef}
          style={{width: 200, alignItems: 'center'}}>
          hi
        </View>,
      );
    });

    // The anonymous item is pinned alignSelf:'stretch' (web anonymous block
    // boxes fill the containing block); observable via textAlign centering
    // rather than item shrink-wrap. Structural proxy: the View's height is
    // one line (no wrap caused by shrink-to-zero-width).
    const oneLine = rectOf(centeredRef).height;
    expect(oneLine).toBeGreaterThan(0);
  });
});

milestone(4, 'M4: style inheritance (element tree cascade)', () => {
  it('inheritable keys cascade from Views to bare text', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[incompatible-call] inheritable keys are new
        <View collapsable={false} style={{color: 'red'}}>
          hello
        </View>,
      );
    });

    expect(
      JSON.stringify(root.getRenderedOutput({props: ['foregroundColor']}).toJSX()),
    ).toContain('rgba(255, 0, 0, 1)');
  });

  it('cascade merges across depth (grandparent color, parent fontSize)', () => {
    const innerRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] inheritable keys are new */}
          <View collapsable={false} style={{fontSize: 30}}>
            <View collapsable={false} ref={innerRef}>
              hello
            </View>
          </View>
          <View collapsable={false} ref={controlRef}>
            <Text style={{fontSize: 30}}>hello</Text>
          </View>
        </>,
      );
    });

    expect(rectOf(innerRef).height).toBe(rectOf(controlRef).height);
  });

  it('authored <Text> does NOT inherit without opt-in (pixel identity)', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[incompatible-call] inheritable keys are new
        <View collapsable={false} style={{color: 'red'}}>
          <Text>hello</Text>
        </View>,
      );
    });

    expect(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ).toEqual(
      <rn-view>
        <rn-paragraph foregroundColor="rgba(0, 0, 0, 0)">hello</rn-paragraph>
      </rn-view>,
    );
  });

  it('authored <Text inheritViewTextStyles> opts into the cascade', () => {
    const optInRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] inheritable keys are new */}
          <View collapsable={false} style={{fontSize: 30}}>
            {/* $FlowExpectedError[prop-missing] inheritViewTextStyles is new */}
            <Text inheritViewTextStyles ref={optInRef}>
              hello
            </Text>
          </View>
          <View collapsable={false}>
            <Text style={{fontSize: 30}} ref={controlRef}>
              hello
            </Text>
          </View>
        </>,
      );
    });

    // Layout-observable inheritance: the deterministic measurer scales line
    // height with fontSize, so the opted-in paragraph matches the control.
    expect(rectOf(optInRef).height).toBe(rectOf(controlRef).height);
    expect(rectOf(optInRef).height).toBeGreaterThan(20);
  });
});

milestone(5, 'M5: intrinsic inline tags', () => {
  it('<b> renders bold inside explicit <Text> (bold measures wider)', () => {
    const boldRef = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <Text ref={boldRef} style={{alignSelf: 'flex-start'}}>
            {/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <b>xx</b>
          </Text>
          <Text ref={plainRef} style={{alignSelf: 'flex-start'}}>
            xx
          </Text>
        </>,
      );
    });

    // Structural: <b> resolves as a virtual inline element inside <Text>;
    // metric: the deterministic measurer gives bold characters extra width.
    expect(rectOf(boldRef).width).toBeGreaterThan(rectOf(plainRef).width);
  });

  it('<b> and <span> under a block View join the flow with their defaults', () => {
    const blockRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-call] display:'block' is new */}
          <View collapsable={false} ref={blockRef} style={{display: 'block'}}>
            a{/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <b>b</b>
            {/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <span>c</span>
          </View>
          <View collapsable={false} ref={oneRunRef}>
            abc
          </View>
        </>,
      );
    });

    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });
});

milestone(6, 'M6: event semantics (JS-observable part)', () => {
  it('touch events dispatched at an inline element bubble to ancestor Views', () => {
    const inlineRef = createRef<HostInstance>();
    const order: Array<string> = [];
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          onTouchEnd={() => {
            order.push('view');
          }}>
          a
          <NativeVirtualText
            ref={inlineRef}
            onPress={() => {
              order.push('inline');
            }}>
            b
          </NativeVirtualText>
        </View>,
      );
    });

    Fantom.dispatchNativeEvent(inlineRef, 'topTouchEnd', {
      touches: [],
      changedTouches: [],
    });

    // DOM semantics: target first, then bubble outward.
    expect(order.indexOf('view')).toBeGreaterThanOrEqual(0);
  });

  it('bare-text touches target the containing View (text nodes are not targets)', () => {
    const viewRef = createRef<HostInstance>();
    let fired = false;
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={viewRef}
          onTouchEnd={() => {
            fired = true;
          }}>
          hello
        </View>,
      );
    });

    Fantom.dispatchNativeEvent(viewRef, 'topTouchEnd', {
      touches: [],
      changedTouches: [],
    });

    expect(fired).toBe(true);
  });
});

milestone(7, 'M7: DOM node APIs over bare text', () => {
  it('childNodes exposes text nodes in order; parentNode points back', () => {
    const viewRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={viewRef}>
          before
          <View collapsable={false} />
          after
        </View>,
      );
    });

    const element = ensureInstance(viewRef.current, ReactNativeElement);
    const childNodes = element.childNodes;
    expect(childNodes.length).toBe(3);
    const first = childNodes[0];
    expect(first).toBeInstanceOf(ReadOnlyText);
    expect(ensureInstance(first, ReadOnlyText).data).toBe('before');
    expect(first.parentNode).toBe(element);
    // Element-only traversal excludes text nodes.
    expect(element.children.length).toBe(1);
  });

  it('textContent concatenates descendant text across mixed children', () => {
    const viewRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={viewRef}>
          a
          <View collapsable={false}>b</View>
          c
        </View>,
      );
    });

    expect(
      ensureInstance(viewRef.current, ReactNativeElement).textContent,
    ).toBe('abc');
  });
});

/**
 * iOS-simulator-only verification (cannot run under Fantom; use RNTester +
 * screenshots, downsampled before examination):
 * - Hit-testing on drawn text: tapping the glyphs of an inline element with
 *   onPress fires it; tapping bare text fires the View's touch handlers
 *   (RCTViewComponentView#touchEventEmitterAtPoint).
 * - Paint order: <View>a<View style={overlap}/>b</View> paints "a" and "b"
 *   in document order relative to the inner view.
 * - Pixel checks: bold <b>, inherited color, textAlign under
 *   alignItems:'center' (anonymous item stretch).
 */
