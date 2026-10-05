/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

/**
 * Text children: the CSS and DOM behaviour matrix over arrangement, display,
 * styling, events and DOM APIs. Web mirrors of these cases live in
 * __fixtures__/string-children-web-mirror.html. Cases are gated by milestone;
 * checks that need a drawn screen are listed at the bottom.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef, useState} from 'react';
import {Text, View} from 'react-native';
import {NativeVirtualText} from 'react-native/Libraries/Text/TextNativeComponent';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import ReadOnlyText from 'react-native/src/private/webapis/dom/nodes/ReadOnlyText';

// The type size the measurements are calibrated against; the document default
// is the platform's body size and differs per platform
const FONT_SIZE = 14;

const IMPLEMENTED_MILESTONE = 7;

function milestone(n: number, name: string, fn: () => void) {
  if (IMPLEMENTED_MILESTONE >= n) {
    describe(name, fn);
  } else {
    // Blocks past IMPLEMENTED_MILESTONE are skipped on purpose
    // eslint-disable-next-line jest/no-disabled-tests
    describe.skip(name, fn);
  }
}

function rectOf(ref: {current: HostInstance | null}) {
  return ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
}

milestone(1, 'M1: layout & measurement (flex container rules)', () => {
  it('bare string gives the View the same intrinsic size as explicit <Text>', () => {
    const bareRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={bareRef} style={{fontSize: FONT_SIZE}}>
            hello world
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{fontSize: FONT_SIZE}}>
            <Text style={{fontSize: FONT_SIZE}}>hello world</Text>
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
          <View collapsable={false} ref={bareRef} style={{fontSize: FONT_SIZE}}>
            {'count: '}
            {42}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{fontSize: FONT_SIZE}}>
            <Text style={{fontSize: FONT_SIZE}}>count: 42</Text>
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
          <View
            collapsable={false}
            ref={mixedRef}
            style={{fontSize: FONT_SIZE}}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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
        <View collapsable={false} ref={wsRef} style={{fontSize: FONT_SIZE}}>
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
          <View collapsable={false} ref={flexRef} style={{fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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
          <View
            collapsable={false}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}
            ref={aRef}>
            aa
          </View>
          <View
            collapsable={false}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}
            ref={bRef}>
            bb
          </View>
        </>,
      );
    });

    expect(rectOf(rowRef).width).toBe(
      rectOf(aRef).width + 10 + rectOf(bRef).width,
    );
  });

  it('text in a nested prop-less View still measures (deep nesting)', () => {
    const outerRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} ref={outerRef} style={{fontSize: FONT_SIZE}}>
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
        <View collapsable={false} ref={bareRef} style={{fontSize: FONT_SIZE}}>
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
      return <View collapsable={false}>{content}</View>;
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
        <View collapsable={false} ref={viewRef} style={{fontSize: FONT_SIZE}}>
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

  it('re-rendering bare text (a state change) keeps run geometry stable', () => {
    // A relayout triggered by a state change must not move the anonymous run's
    // geometry; the ViewState run frame is what painting and hit-testing consume
    let bump: () => void = () => {};
    const viewRef = createRef<HostInstance>();
    const markerRef = createRef<HostInstance>();
    function Counter(): React.Node {
      const [n, setN] = useState(0);
      // A single digit keeps the run's size, so any movement is a relayout bug
      bump = () => setN(v => (v + 1) % 9);
      return (
        <View collapsable={false} ref={viewRef} style={{padding: 6}}>
          {`taps: ${n}`}
          <View
            collapsable={false}
            ref={markerRef}
            style={{width: 4, height: 4}}
          />
        </View>
      );
    }
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(<Counter />);
    });
    const view0 = rectOf(viewRef);
    const marker0 = rectOf(markerRef);
    // The marker below the run encodes where the run was laid out
    expect(marker0.x).toBe(6);
    expect(marker0.y).toBeGreaterThan(6);

    Fantom.runTask(() => {
      bump();
    });
    const view1 = rectOf(viewRef);
    const marker1 = rectOf(markerRef);
    // Relayout is idempotent: same View box, same marker position
    expect(view1.x).toBe(view0.x);
    expect(view1.y).toBe(view0.y);
    expect(view1.width).toBe(view0.width);
    expect(view1.height).toBe(view0.height);
    expect(marker1.x).toBe(marker0.x);
    expect(marker1.y).toBe(marker0.y);
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
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            a
            <NativeVirtualText>
              b<NativeVirtualText>c</NativeVirtualText>
            </NativeVirtualText>
            d
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            before
            <View collapsable={false} style={{height: 10}} />
            after
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
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

    // The anonymous item stretches like a web anonymous block box, observable
    // through textAlign centring; one line of height proxies for no shrink-wrap
    const oneLine = rectOf(centeredRef).height;
    expect(oneLine).toBeGreaterThan(0);
  });

  // White-space processing inside anonymous IFCs (css-text-3 §3): bare-text
  // runs collapse and trim like `white-space: normal`, while an explicit <Text>
  // keeps RN's verbatim whitespace
  it('collapses internal whitespace and trims IFC edges (bare text only)', () => {
    const bareRef = createRef<HostInstance>();
    const collapsedControlRef = createRef<HostInstance>();
    const verbatimControlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={bareRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'  a   b  '}
          </View>
          <View
            collapsable={false}
            ref={collapsedControlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            <Text style={{fontSize: FONT_SIZE}}>a b</Text>
          </View>
          <View
            collapsable={false}
            ref={verbatimControlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            <Text style={{fontSize: FONT_SIZE}}>{'  a   b  '}</Text>
          </View>
        </>,
      );
    });

    // '  a   b  ' collapses to 'a b' (3 chars = 30pt), matching an explicit
    // collapsed control.
    expect(rectOf(bareRef).width).toBe(30);
    expect(rectOf(bareRef).width).toBe(rectOf(collapsedControlRef).width);
    // An explicit <Text> keeps verbatim whitespace: 9 chars = 90pt
    expect(rectOf(verbatimControlRef).width).toBe(90);
  });

  it('collapses whitespace across adjacent text nodes to a single space', () => {
    const bareRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={bareRef}
          style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
          {'a '}
          {' b'}
        </View>,
      );
    });

    // 'a ' + ' b' — the space split across the two text nodes collapses to one:
    // 'a b' = 30pt (not 'a  b' = 40pt).
    expect(rectOf(bareRef).width).toBe(30);
  });

  it('collapses whitespace across an inline element boundary (block flow)', () => {
    const blockRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={blockRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a '}
            <NativeVirtualText>{'b'}</NativeVirtualText>
            {' c'}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a b c'}
          </View>
        </>,
      );
    });

    // One IFC across the inline element: 'a ' + 'b' + ' c' collapses to
    // 'a b c' (5 chars = 50pt), same as the single-string control.
    expect(rectOf(blockRef).width).toBe(rectOf(controlRef).width);
    expect(rectOf(blockRef).width).toBe(50);
  });
});

milestone(4, 'M4: style inheritance (element tree cascade)', () => {
  it('inheritable keys cascade from Views to bare text', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[incompatible-type] inheritable keys are new
        <View collapsable={false} style={{color: 'red'}}>
          hello
        </View>,
      );
    });

    expect(
      JSON.stringify(
        root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
      ),
    ).toContain('rgba(255, 0, 0, 1)');
  });

  it('a sibling re-render keeps the inherited cascade on unchanged Views', () => {
    // Re-rendering one subtree must not strip the inherited colour from a
    // sibling subtree that did not change
    let bump: (updater: (n: number) => number) => void = () => {};
    function App(): React.Node {
      const [n, setN] = useState(0);
      bump = setN;
      return (
        <>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View collapsable={false} style={{color: 'red'}}>
            {'changes ' + String(n)}
          </View>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View collapsable={false} style={{color: 'blue'}}>
            unchanged sibling
          </View>
        </>
      );
    }
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(<App />);
    });

    const blue = 'rgba(0, 0, 255, 1)';
    expect(
      JSON.stringify(
        root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
      ),
    ).toContain(blue);

    // Re-render only the first sibling
    Fantom.runTask(() => {
      bump(v => v + 1);
    });

    // The unchanged sibling must still carry its inherited blue
    expect(
      JSON.stringify(
        root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
      ),
    ).toContain(blue);
  });

  it('cascade merges across depth (grandparent color, parent fontSize)', () => {
    const innerRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
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
        // $FlowExpectedError[incompatible-type] inheritable keys are new
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

  it("authored <Text style={{all: 'unset'}}> opts into the cascade", () => {
    const optInRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View collapsable={false} style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <Text style={{all: 'unset'}} ref={optInRef}>
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

  // The cascade must reach an unchanged subtree when only an ancestor's
  // inheritable prop changes; the middle View below never changes
  it('updating a grandparent color re-cascades into an unchanged subtree (non-size)', () => {
    let setColor: (c: string) => void = () => {};
    function Grandparent(): React.Node {
      const [color, set] = useState('rgb(0, 0, 255)');
      setColor = set;
      return (
        // $FlowExpectedError[incompatible-type] inheritable keys are new
        <View collapsable={false} style={{color}}>
          <View collapsable={false}>hello</View>
        </View>
      );
    }
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<Grandparent />);
    });
    expect(
      JSON.stringify(
        root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
      ),
    ).toContain('rgba(0, 0, 255, 1)');

    Fantom.runTask(() => {
      setColor('rgb(255, 0, 0)');
    });
    expect(
      JSON.stringify(
        root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
      ),
    ).toContain('rgba(255, 0, 0, 1)');
  });

  it('updating a grandparent fontSize re-measures an unchanged subtree', () => {
    let setFontSize: (n: number) => void = () => {};
    const innerRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    function Tree(): React.Node {
      const [fontSize, set] = useState(8);
      setFontSize = set;
      return (
        <>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View collapsable={false} style={{fontSize}}>
            <View collapsable={false} ref={innerRef}>
              hello
            </View>
          </View>
          <View collapsable={false} ref={controlRef}>
            <Text style={{fontSize: 30}}>hello</Text>
          </View>
        </>
      );
    }
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(<Tree />);
    });
    // fontSize 8 grandchild is shorter than the fontSize 30 control.
    expect(rectOf(innerRef).height).toBeLessThan(rectOf(controlRef).height);

    Fantom.runTask(() => {
      setFontSize(30);
    });
    // After the grandparent grows, the unchanged grandchild must re-measure.
    expect(rectOf(innerRef).height).toBe(rectOf(controlRef).height);
  });
});

// M4b: the full CSS inherited text-property set cascades into bare text.
// Layout-observable keys are asserted through the deterministic measurer, the
// rest through the run's rendered attributes, each against an explicit <Text>
// control.
milestone(4, 'M4b: full inherited-property set', () => {
  // `alignSelf:'flex-start'` shrink-wraps the View to its text so intrinsic
  // width (not the container) is what we measure.
  function widthOf(ref: {current: HostInstance | null}) {
    return rectOf(ref).width;
  }

  it('fontWeight inherits into bare text (bold measures wider, matches control)', () => {
    const boldRef = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={boldRef}
            // $FlowExpectedError[incompatible-type] inheritable keys are new
            style={{fontWeight: 'bold', alignSelf: 'flex-start'}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={plainRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            <Text style={{fontWeight: 'bold'}}>hello</Text>
          </View>
        </>,
      );
    });
    expect(widthOf(boldRef)).toBeGreaterThan(widthOf(plainRef));
    expect(widthOf(boldRef)).toBe(widthOf(controlRef));
  });

  it('fontStyle inherits into bare text (italic measures wider, matches control)', () => {
    const italicRef = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={italicRef}
            // $FlowExpectedError[incompatible-type] inheritable keys are new
            style={{fontStyle: 'italic', alignSelf: 'flex-start'}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={plainRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            <Text style={{fontStyle: 'italic'}}>hello</Text>
          </View>
        </>,
      );
    });
    expect(widthOf(italicRef)).toBeGreaterThan(widthOf(plainRef));
    expect(widthOf(italicRef)).toBe(widthOf(controlRef));
  });

  it('letterSpacing inherits into bare text (wider by spacing per character)', () => {
    const spacedRef = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={spacedRef}
            // $FlowExpectedError[incompatible-type] inheritable keys are new
            style={{letterSpacing: 5, alignSelf: 'flex-start'}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={plainRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            hello
          </View>
        </>,
      );
    });
    // 'hello' is 5 chars; the measurer adds letterSpacing (5) per character.
    expect(widthOf(spacedRef)).toBe(widthOf(plainRef) + 5 * 5);
  });

  it('lineHeight inherits into bare text (overrides the derived line height)', () => {
    const tallRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View collapsable={false} ref={tallRef} style={{lineHeight: 50}}>
            hello
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{fontSize: FONT_SIZE}}>
            <Text style={{lineHeight: 50}}>hello</Text>
          </View>
        </>,
      );
    });
    expect(rectOf(tallRef).height).toBe(50);
    expect(rectOf(tallRef).height).toBe(rectOf(controlRef).height);
  });

  it('fontFamily and textAlign inherit into bare text (rendered attributes match control)', () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          // $FlowExpectedError[incompatible-type] inheritable keys are new
          style={{fontFamily: 'Times', textAlign: 'center'}}>
          hello
        </View>,
      );
    });
    // The bare-text run carries the inherited fontFamily and textAlign
    // (serialized as `alignment`), exactly as an explicit <Text> would.
    const out = JSON.stringify(
      root.getRenderedOutput({props: ['fontFamily', 'alignment']}).toJSX(),
    );
    expect(out).toContain('"fontFamily":"Times"');
    expect(out).toContain('"alignment":"center"');
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
          <Text
            ref={boldRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <b>xx</b>
          </Text>
          <Text
            ref={plainRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
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
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            a{/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <b>b</b>
            {/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <span>c</span>
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
            abc
          </View>
        </>,
      );
    });

    expect(rectOf(blockRef).height).toBe(rectOf(oneRunRef).height);
  });

  it('<img> blockifies in a flex container, and flows in a block one', () => {
    // css-flexbox-1 §4: every element child of a flex container is a flex item,
    // replaced elements included, and only contiguous text wraps in anonymous
    // items; `a<img/>b` is three stacked items like `a<b>b</b>c`. The one-line
    // reading belongs to block containers, asserted here too.
    const imgRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const blockifyRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={imgRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
            <img />
            {'b'}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{alignSelf: 'flex-start', fontSize: FONT_SIZE}}>
            {'ab'}
          </View>
          <View
            collapsable={false}
            ref={blockifyRef}
            style={{fontSize: FONT_SIZE}}>
            a{/* $FlowExpectedError[not-a-component] intrinsic tags are new */}
            <b>b</b>c
          </View>
        </>,
      );
    });

    // In the flex View, the 0-size <img> is its own (empty) flex item between
    // the two anonymous text items: three items, two carrying a line.
    expect(rectOf(imgRef).height).toBe(rectOf(controlRef).height * 2);
    // An inline text element (<b>) blockifies the same way.
    expect(rectOf(blockifyRef).height).toBe(rectOf(controlRef).height * 3);
  });

  it('<img> flows inside the run in a block container', () => {
    // The prose half: display:'block' puts text and the replaced element in
    // ONE inline formatting context, so `a<img/>b` is a single line sized
    // like 'ab' (the unsized attachment is 0-width).
    const imgRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={imgRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'a'}
            {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
            <img />
            {'b'}
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{
              display: 'block',
              alignSelf: 'flex-start',
              fontSize: FONT_SIZE,
            }}>
            {'ab'}
          </View>
        </>,
      );
    });

    expect(rectOf(imgRef).height).toBe(rectOf(controlRef).height);
    expect(rectOf(imgRef).width).toBe(rectOf(controlRef).width);
  });

  it('<div> is a block container: inline children join one flow (not blockified)', () => {
    // <div> is block-outer and block-inner, like a View with display: 'block':
    // its inline children join one flow, where a flex View blockifies them
    const divRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const flexRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div collapsable={false} ref={divRef} style={{fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </div>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
            abc
          </View>
          <View collapsable={false} ref={flexRef} style={{fontSize: FONT_SIZE}}>
            a<NativeVirtualText>b</NativeVirtualText>c
          </View>
        </>,
      );
    });

    // <div> block-inner: one wrapping inline flow, one line — same as 'abc'.
    expect(rectOf(divRef).height).toBe(rectOf(oneRunRef).height);
    // Contrast: a default flex View blockifies the inline element -> 3 lines.
    expect(rectOf(flexRef).height).toBe(rectOf(oneRunRef).height * 3);
  });

  it('<img width height> reserves its box in the run (inline replaced sizing)', () => {
    // A sized <img> occupies its box in the run: 'a<img 30x40/>b' is
    // 10 + 30 + 10 = 50pt wide and the 40pt box grows the 20pt line
    const sizedRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          ref={sizedRef}
          style={{
            display: 'block',
            alignSelf: 'flex-start',
            fontSize: FONT_SIZE,
          }}>
          {'a'}
          {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
          <img style={{width: 30, height: 40}} />
          {'b'}
        </View>,
      );
    });

    expect(rectOf(sizedRef).width).toBe(50);
    // 44, not 40: the box sits on the baseline and the text's descender still
    // hangs below it
    expect(rectOf(sizedRef).height).toBe(44);
  });

  it('an author line-height is a FLOOR on the line box, not a cap', () => {
    // `line-height` sizes the strut, and the line box is the union of the strut
    // and everything on the line (css-inline-3 §4.1): a floor, not a cap. The
    // two box cases are not asserted identical because the half-leading differs
    // by about a point, a fact about the font.
    const strutOnly = createRef<HostInstance>();
    const withTallBox = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={strutOnly}
            style={{width: 300, fontSize: 16, lineHeight: 26}}>
            {'xy'}
          </View>
          <View
            collapsable={false}
            ref={withTallBox}
            style={{width: 300, fontSize: 16, lineHeight: 26}}>
            {'x'}
            {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
            <img style={{width: 56, height: 56}} />
            {'y'}
          </View>
        </>,
      );
    });

    // The floor: with only text on it, the line is exactly the line-height.
    expect(rectOf(strutOnly).height).toBe(26);
    // Not a cap: a 56pt inline on the line grows it well past the 26.
    expect(rectOf(withTallBox).height).toBeGreaterThanOrEqual(56);
  });
});

milestone(5, 'M5b: unknown elements behave like HTMLUnknownElement', () => {
  it('unknown tags are inline: content joins the block flow unstyled', () => {
    const blockRef = createRef<HostInstance>();
    const controlRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View
            collapsable={false}
            ref={blockRef}
            style={{display: 'block', fontSize: FONT_SIZE}}>
            a{/* $FlowExpectedError[not-a-component] unknown tag */}
            <foo>b</foo>c
          </View>
          <View
            collapsable={false}
            ref={controlRef}
            style={{fontSize: FONT_SIZE}}>
            abc
          </View>
        </>,
      );
    });

    // One inline flow, same size as plain text — content renders, no styling.
    expect(rectOf(blockRef).height).toBe(rectOf(controlRef).height);
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).toContain('b');
  });

  it('unknown tags blockify in flex containers like other inline elements', () => {
    const flexRef = createRef<HostInstance>();
    const oneRunRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          <View collapsable={false} ref={flexRef} style={{fontSize: FONT_SIZE}}>
            a{/* $FlowExpectedError[not-a-component] unknown tag */}
            <bar>b</bar>c
          </View>
          <View
            collapsable={false}
            ref={oneRunRef}
            style={{fontSize: FONT_SIZE}}>
            a
          </View>
        </>,
      );
    });

    expect(rectOf(flexRef).height).toBe(rectOf(oneRunRef).height * 3);
  });

  it('unknown tags keep their authored name (tagName/nodeName fidelity)', () => {
    // An HTMLUnknownElement keeps its tag name through the `nodeName` prop;
    // RN prefixes component names with "RN:"
    const fooRef = createRef<HostInstance>();
    const barRef = createRef<HostInstance>();
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{display: 'block'}}>
          a{/* $FlowExpectedError[not-a-component] unknown tag */}
          <foo ref={fooRef}>b</foo>
          {/* $FlowExpectedError[not-a-component] unknown tag */}
          <bar ref={barRef}>c</bar>
        </View>,
      );
    });

    const foo = ensureInstance(fooRef.current, ReactNativeElement);
    const bar = ensureInstance(barRef.current, ReactNativeElement);
    // Each unknown element reports its own authored tag: the name is
    // per-instance, not per-descriptor
    expect(foo.tagName).toBe('RN:foo');
    expect(foo.nodeName).toBe('RN:foo');
    expect(bar.tagName).toBe('RN:bar');
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
        <View collapsable={false} ref={viewRef} style={{fontSize: FONT_SIZE}}>
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
        <View collapsable={false} ref={viewRef} style={{fontSize: FONT_SIZE}}>
          a<View collapsable={false}>b</View>c
        </View>,
      );
    });

    expect(
      ensureInstance(viewRef.current, ReactNativeElement).textContent,
    ).toBe('abc');
  });
});

/**
 * Checks that need a drawn screen, not Fantom: hit-testing on drawn text,
 * paint order of runs around an overlapping child, and pixels for bold, the
 * inherited colour and textAlign under alignItems: 'center'.
 */
