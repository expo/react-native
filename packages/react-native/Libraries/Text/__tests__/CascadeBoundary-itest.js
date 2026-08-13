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

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef, useState} from 'react';
import {Text, View} from 'react-native';
// The element catalog, for the cross-model test below.
import '@react-native/expo-intrinsics-poc';

/*
 * Inheritance boundaries: CSS `all` (css-cascade-4 §3.2), scoped to the
 * inherited text set — the only cascading properties this renderer has.
 *
 * `all: 'initial'` makes an element an inheritance root, the way the old
 * world's <Text> roots were: the cascade below it restarts from the initial
 * values and nothing below can observe an ancestor's inheritable styles. The
 * boundary is also pure engine relief — an inheritable change above one never
 * needs to walk in (SubtreeHasCascadeDependents stops at boundaries).
 */

function renderedColors(root: Fantom.Root): string {
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['foregroundColor']}).toJSX(),
    ) ?? ''
  );
}

const RED = 'rgba(255, 0, 0, 1)';

function rectOf(ref: {current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}
const BLUE = 'rgba(0, 0, 255, 1)';

test('an ancestor color does not cross an all:initial boundary', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all: 'initial'}}>
          isolated
        </View>
      </View>,
    );
  });

  expect(renderedColors(root)).not.toContain(RED);
});

test('text outside the boundary still inherits', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {'inherits '}
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all: 'initial'}}>
          isolated
        </View>
      </View>,
    );
  });

  expect(renderedColors(root)).toContain(RED);
});

test("the boundary's own inheritable props still style its subtree", () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all: 'initial', color: 'blue'}}>
          <View collapsable={false}>fresh start, then blue</View>
        </View>
      </View>,
    );
  });

  const colors = renderedColors(root);
  expect(colors).toContain(BLUE);
  expect(colors).not.toContain(RED);
});

test('an ancestor color CHANGE does not cross the boundary either', () => {
  // The update path is separately load-bearing: the boundary must stop the
  // re-cascade walk, not just the initial values.
  let setColor: string => void = () => {};
  function Tree(): React.Node {
    const [color, set] = useState('blue');
    setColor = set;
    return (
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all: 'initial'}}>
          isolated
        </View>
      </View>
    );
  }
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<Tree />);
  });
  Fantom.runTask(() => {
    setColor('red');
  });

  expect(renderedColors(root)).not.toContain(RED);
});

test('removing the boundary lets the cascade back in', () => {
  let setAll: (?string) => void = () => {};
  function Tree(): React.Node {
    const [all, set] = useState<?string>('initial');
    setAll = set;
    return (
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all}}>
          toggled
        </View>
      </View>
    );
  }
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<Tree />);
  });
  expect(renderedColors(root)).not.toContain(RED);

  Fantom.runTask(() => {
    setAll(null);
  });
  expect(renderedColors(root)).toContain(RED);
});

test('<Text> is a boundary by default: user-agent all:initial', () => {
  // Inherited color does not surface in a paragraph's own props, so the
  // boundary is asserted the observable way: an inherited fontSize would
  // change the measured height, and with the default boundary it must not.
  const boundedRef = createRef<HostInstance>();
  const controlRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View collapsable={false} style={{fontSize: 30}}>
          <Text ref={boundedRef}>boundary probe</Text>
        </View>
        <Text ref={controlRef}>boundary probe</Text>
      </>,
    );
  });

  expect(rectOf(boundedRef).height).toBe(rectOf(controlRef).height);
});

test("<Text style={{all: 'unset'}}> removes the boundary and inherits", () => {
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
            boundary probe
          </Text>
        </View>
        <Text ref={controlRef} style={{fontSize: 30}}>
          boundary probe
        </Text>
      </>,
    );
  });

  expect(rectOf(optInRef).height).toBe(rectOf(controlRef).height);
});

test('a catalog <p> still inherits: DOM elements are web elements', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red', display: 'block'}}>
        {/* $FlowExpectedError[not-a-component] catalog element */}
        <p>the DOM side keeps html.css semantics</p>
      </View>,
    );
  });

  expect(renderedColors(root)).toContain(RED);
});

test('a catalog <p> does not style a root <Text> inside it either', () => {
  // The boundary is on the Text itself, so it holds against ANY ancestor —
  // DOM elements included. <p style={{fontSize}}> must not reach the Text.
  const boundedRef = createRef<HostInstance>();
  const controlRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        <View collapsable={false} style={{display: 'block'}}>
          {/* $FlowExpectedError[not-a-component] catalog element */}
          <p style={{fontSize: 30}}>
            <Text ref={boundedRef}>boundary probe</Text>
          </p>
        </View>
        <Text ref={controlRef}>boundary probe</Text>
      </>,
    );
  });

  expect(rectOf(boundedRef).height).toBe(rectOf(controlRef).height);
});

test("an inline element inside a run can be a boundary: <span style={{all: 'initial'}}>", () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red', display: 'block'}}>
        {/* $FlowExpectedError[not-a-component] catalog element */}
        <span>red span</span>
        {/* $FlowExpectedError[not-a-component] catalog element */}
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <span style={{all: 'initial'}}>reset span</span>
      </View>,
    );
  });

  const colors = renderedColors(root);
  // The un-reset sibling inherits red; the reset one carries no inherited
  // color at all (a default-colored fragment omits the prop entirely).
  expect(colors).toContain(`"${RED}","children":"red span"`);
  expect(colors).not.toContain(`"${RED}","children":"reset span"`);
});

test('a nested <Text> can reset too: any element, one property', () => {
  // Fantom's deterministic text layout scales HEIGHTS with fontSize but not
  // character advances, so each case is its own single-line paragraph and the
  // paragraph heights carry the signal: a reset nested Text collapses the
  // line back to the default size; an un-reset one keeps the inherited 30pt.
  const resetParagraphRef = createRef<HostInstance>();
  const inheritedParagraphRef = createRef<HostInstance>();
  const defaultParagraphRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        <Text style={{fontSize: 30}} ref={inheritedParagraphRef}>
          <Text>nested probe</Text>
        </Text>
        <Text style={{fontSize: 30}} ref={resetParagraphRef}>
          {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
          <Text style={{all: 'initial'}}>nested probe</Text>
        </Text>
        <Text ref={defaultParagraphRef}>nested probe</Text>
      </>,
    );
  });

  expect(rectOf(inheritedParagraphRef).height).toBeGreaterThan(
    rectOf(defaultParagraphRef).height,
  );
  expect(rectOf(resetParagraphRef).height).toBe(
    rectOf(defaultParagraphRef).height,
  );
});

/*
 * `all: 'revert'` rolls the author declaration back to the user-agent origin
 * (css-cascade-4 §7.3). The renderer's native UA origin is exactly one
 * declaration — root <Text>'s `all: 'initial'` (the UACascadeBoundary trait)
 * — so `revert` keeps root <Text>'s boundary and resolves to unset (inherit)
 * everywhere else. It is NOT a synonym for `initial`: on a plain View the two
 * must behave differently, and the tests below pin each side of that.
 */

test("all: 'revert' on a View is not a boundary: no UA declaration to revert to", () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all: 'revert'}}>
          inherits anyway
        </View>
      </View>,
    );
  });

  // Contrast with the all:'initial' test above: same tree shape, opposite
  // outcome — reverting where the UA declares nothing means inherit.
  expect(renderedColors(root)).toContain(RED);
});

test("all: 'revert' on a root <Text> keeps the UA boundary", () => {
  // Height-equality tests must compare IDENTICAL strings: deterministic text
  // layout scales heights with fontSize but not character advances, so a
  // longer string can wrap and turn one 14pt line into two — a height signal
  // that has nothing to do with the boundary under test.
  const revertedRef = createRef<HostInstance>();
  const controlRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View collapsable={false} style={{fontSize: 30}}>
          {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
          <Text style={{all: 'revert'}} ref={revertedRef}>
            boundary probe
          </Text>
        </View>
        <Text ref={controlRef}>boundary probe</Text>
      </>,
    );
  });

  expect(rectOf(revertedRef).height).toBe(rectOf(controlRef).height);
});

test("all: 'inherit' on a root <Text> opts in, exactly like 'unset'", () => {
  // Scoped to inherited properties, `inherit` and `unset` resolve the same
  // way — and both are author declarations that defeat the UA boundary.
  const optInRef = createRef<HostInstance>();
  const controlRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
        <View collapsable={false} style={{fontSize: 30}}>
          {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
          <Text style={{all: 'inherit'}} ref={optInRef}>
            boundary probe
          </Text>
        </View>
        <Text ref={controlRef} style={{fontSize: 30}}>
          boundary probe
        </Text>
      </>,
    );
  });

  expect(rectOf(optInRef).height).toBe(rectOf(controlRef).height);
});

test("updating 'revert' to 'initial' turns the boundary ON", () => {
  // The two keywords resolve differently on a View, and the resolution also
  // runs on the props-update path (the clone constructor), not just at
  // construction — this exercises that path across the difference.
  let setAll: string => void = () => {};
  function Tree(): React.Node {
    const [all, set] = useState('revert');
    setAll = set;
    return (
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red'}}>
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <View collapsable={false} style={{all}}>
          toggled
        </View>
      </View>
    );
  }
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<Tree />);
  });
  expect(renderedColors(root)).toContain(RED);

  Fantom.runTask(() => {
    setAll('initial');
  });
  expect(renderedColors(root)).not.toContain(RED);
});

test("a nested <Text style={{all: 'revert'}}> inherits: virtual text has no UA declaration", () => {
  // Root <Text>'s UA `all: 'initial'` lives on ParagraphShadowNode; a nested
  // <Text> is virtual text inside the paragraph, so there is nothing to
  // revert to and the inherited 30pt stands. Same height fixture as the
  // nested-reset test above, opposite outcome.
  const revertParagraphRef = createRef<HostInstance>();
  const inheritedParagraphRef = createRef<HostInstance>();
  const defaultParagraphRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        <Text style={{fontSize: 30}} ref={revertParagraphRef}>
          {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
          <Text style={{all: 'revert'}}>nested probe</Text>
        </Text>
        <Text style={{fontSize: 30}} ref={inheritedParagraphRef}>
          <Text>nested probe</Text>
        </Text>
        <Text ref={defaultParagraphRef}>nested probe</Text>
      </>,
    );
  });

  expect(rectOf(revertParagraphRef).height).toBe(
    rectOf(inheritedParagraphRef).height,
  );
  expect(rectOf(revertParagraphRef).height).toBeGreaterThan(
    rectOf(defaultParagraphRef).height,
  );
});

test("an inline <span style={{all: 'revert'}}> inherits mid-run", () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] inheritable keys are new
      <View collapsable={false} style={{color: 'red', display: 'block'}}>
        {/* $FlowExpectedError[not-a-component] catalog element */}
        {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
        <span style={{all: 'revert'}}>revert span</span>
      </View>,
    );
  });

  // Contrast with the all:'initial' span test above: reverting an inline
  // element with no UA `all` declaration leaves the inherited red in force.
  expect(renderedColors(root)).toContain(`"${RED}","children":"revert span"`);
});
