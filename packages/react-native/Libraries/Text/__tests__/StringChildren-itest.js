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
 * String children: the many ways a bare string reaches a <View>, and the
 * edge cases that must render (or render nothing) without error.
 *
 * Companion to ImplicitText-itest.js (the CSS/DOM behavior matrix); this file
 * focuses on *sources* of string children (JSX shapes, transparent wrappers,
 * falsy guards, dynamics) rather than layout/inheritance semantics.
 *
 * Assertions use toJSX() text presence (resilient to exact mounting shape).
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function renderToText(element: React.MixedElement): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '';
}

function heightOf(element: React.MixedElement): number {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[incompatible-type] cloneElement to attach a ref
      React.cloneElement(element, {ref, collapsable: false}),
    );
  });
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect()
    .height;
}

describe('string children: JSX sources', () => {
  it('string literal renders', () => {
    expect(renderToText(<View collapsable={false}>hello</View>)).toContain(
      'hello',
    );
  });

  it('string expression renders', () => {
    expect(renderToText(<View collapsable={false}>{'hello'}</View>)).toContain(
      'hello',
    );
  });

  it('number child renders as text', () => {
    expect(renderToText(<View collapsable={false}>{42}</View>)).toContain('42');
  });

  it('the number 0 renders "0" (not dropped as falsy)', () => {
    // React renders 0 as text; only null/undefined/false/'' are skipped.
    expect(renderToText(<View collapsable={false}>{0}</View>)).toContain('0');
  });

  it('template literal renders interpolated text', () => {
    const who = 'world';
    expect(
      renderToText(<View collapsable={false}>{`hi ${who}`}</View>),
    ).toContain('hi world');
  });

  it('adjacent string children coalesce into one run', () => {
    const out = renderToText(
      <View collapsable={false}>
        {'a'} {'b'}
      </View>,
    );
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('literal text interleaved with an interpolation', () => {
    const name = 'RN';
    expect(
      renderToText(<View collapsable={false}>hello {name}!</View>),
    ).toContain('hello');
  });

  it('array of strings renders each', () => {
    const out = renderToText(
      <View collapsable={false}>{['a', 'b', 'c']}</View>,
    );
    expect(out).toContain('a');
    expect(out).toContain('c');
  });

  it('.map() producing strings renders', () => {
    const items = [{label: 'one'}, {label: 'two'}];
    expect(
      renderToText(<View collapsable={false}>{items.map(i => i.label)}</View>),
    ).toContain('two');
  });

  it('ternary yielding a string renders the chosen branch', () => {
    const cond: boolean = true;
    expect(
      renderToText(<View collapsable={false}>{cond ? 'yes' : 'no'}</View>),
    ).toContain('yes');
  });
});

describe('string children: transparent wrappers', () => {
  it('React.Fragment child (string inside <>...</>) renders', () => {
    expect(
      renderToText(
        <View collapsable={false}>
          <>{'hello'}</>
        </View>,
      ),
    ).toContain('hello');
  });

  it('nested fragments render', () => {
    expect(
      renderToText(
        <View collapsable={false}>
          <>
            <>{'deep'}</>
          </>
        </View>,
      ),
    ).toContain('deep');
  });

  it('a component that returns a string renders', () => {
    const StrComp = () => 'from-component';
    expect(
      renderToText(
        <View collapsable={false}>
          <StrComp />
        </View>,
      ),
    ).toContain('from-component');
  });

  it('a component that returns a number renders', () => {
    const NumComp = () => 7;
    expect(
      renderToText(
        <View collapsable={false}>
          <NumComp />
        </View>,
      ),
    ).toContain('7');
  });

  it('a component that returns a fragment of strings renders', () => {
    const FragComp = () => (
      <>
        {'x'}
        {'y'}
      </>
    );
    const out = renderToText(
      <View collapsable={false}>
        <FragComp />
      </View>,
    );
    expect(out).toContain('x');
    expect(out).toContain('y');
  });

  it('React.memo component returning a string renders', () => {
    const Memoized = React.memo(() => 'memoized');
    expect(
      renderToText(
        <View collapsable={false}>
          <Memoized />
        </View>,
      ),
    ).toContain('memoized');
  });

  it('children passed through a wrapper component render', () => {
    const Wrapper = ({children}: {children: React.Node}) => (
      <View collapsable={false}>{children}</View>
    );
    expect(renderToText(<Wrapper>passed-through</Wrapper>)).toContain(
      'passed-through',
    );
  });
});

describe('string children: falsy/empty guards (render nothing, never crash)', () => {
  it('null child renders an empty View', () => {
    expect(() =>
      renderToText(<View collapsable={false}>{null}</View>),
    ).not.toThrow();
    expect(heightOf(<View>{null}</View>)).toBe(0);
  });

  it('undefined child renders empty', () => {
    expect(heightOf(<View>{undefined}</View>)).toBe(0);
  });

  it('false child renders empty', () => {
    expect(heightOf(<View>{false}</View>)).toBe(0);
  });

  it('empty string renders empty', () => {
    expect(heightOf(<View>{''}</View>)).toBe(0);
  });

  it('short-circuit guard when false renders nothing', () => {
    const show: boolean = false;
    expect(heightOf(<View>{show && 'hidden'}</View>)).toBe(0);
  });

  it('short-circuit guard when true renders the string', () => {
    const show: boolean = true;
    expect(
      renderToText(<View collapsable={false}>{show && 'shown'}</View>),
    ).toContain('shown');
  });
});

describe('string children: composition & interleaving', () => {
  it('bare string alongside an explicit <Text> sibling', () => {
    const out = renderToText(
      <View collapsable={false}>
        bare
        <Text>explicit</Text>
      </View>,
    );
    expect(out).toContain('bare');
    expect(out).toContain('explicit');
  });

  it('string between two block <View> siblings', () => {
    const out = renderToText(
      <View collapsable={false}>
        <View collapsable={false} />
        between
        <View collapsable={false} />
      </View>,
    );
    expect(out).toContain('between');
  });

  it('deeply nested Views each with a string', () => {
    const out = renderToText(
      <View collapsable={false}>
        outer
        <View collapsable={false}>inner</View>
      </View>,
    );
    expect(out).toContain('outer');
    expect(out).toContain('inner');
  });
});

describe('string children: content specifics', () => {
  it('multi-line string renders', () => {
    expect(
      renderToText(<View collapsable={false}>{'line1\nline2'}</View>),
    ).toContain('line1');
  });

  it('unicode / emoji string renders', () => {
    expect(
      renderToText(<View collapsable={false}>{'café 🎉'}</View>),
    ).toContain('café');
  });

  it('a non-empty string gives the View non-zero height', () => {
    expect(heightOf(<View>hello</View>)).toBeGreaterThan(0);
  });
});

describe('string children: dynamics', () => {
  it('updating the string re-renders the new text', () => {
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(<View collapsable={false}>before</View>);
    });
    let out = JSON.stringify(root.getRenderedOutput({props: []}).toJSX());
    expect(out).toContain('before');

    Fantom.runTask(() => {
      root.render(<View collapsable={false}>after</View>);
    });
    out = JSON.stringify(root.getRenderedOutput({props: []}).toJSX());
    expect(out).toContain('after');
    expect(out).not.toContain('before');
  });

  it('toggling a string child off then on', () => {
    const root = Fantom.createRoot();
    const render = (show: boolean) =>
      Fantom.runTask(() => {
        root.render(<View collapsable={false}>{show ? 'visible' : null}</View>);
      });
    render(true);
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).toContain('visible');
    render(false);
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).not.toContain('visible');
    render(true);
    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()),
    ).toContain('visible');
  });
});
