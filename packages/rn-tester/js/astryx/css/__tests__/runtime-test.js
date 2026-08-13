/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

// The runtime's jsx() is called directly — exactly what compiled intrinsic
// JSX does — so the whole path (descriptor context, matching, resolution,
// interaction wiring) runs without needing the babel importSource alias in
// jest.
import {jsx} from '../../jsx-runtime';
import {installStylesheet, resetStylesheets} from '../index';
import {Appearance} from 'react-native';
import TestRenderer from 'react-test-renderer';

function div(props: {[string]: unknown}): $FlowFixMe {
  return jsx('div', props);
}

const liveRenderers: Array<$FlowFixMe> = [];

function render(element: $FlowFixMe): $FlowFixMe {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  liveRenderers.push(renderer);
  return renderer;
}

function hostStyle(renderer: $FlowFixMe, type: string): $FlowFixMe {
  const node = renderer.root.findAll(
    (n: $FlowFixMe) => n.type === type && n.props.style != null,
  );
  return node.length > 0 ? node[0].props.style : null;
}

afterEach(() => {
  // Mounted renderers subscribe to the css version: unmount them before the
  // environment changes under them, then reset the sheets.
  TestRenderer.act(() => {
    for (const renderer of liveRenderers) {
      renderer.unmount();
    }
  });
  liveRenderers.length = 0;
  resetStylesheets();
  jest.restoreAllMocks();
});

describe('stylesheets on intrinsic elements', () => {
  it('resolves matched declarations through the value pipeline', () => {
    installStylesheet(`
      :root { --pad: 8px }
      .card { padding: var(--pad); background-color: rgb(255, 0, 0) }
    `);
    const r = render(div({className: 'card'}));
    const style = hostStyle(r, 'div');
    expect(style.paddingTop).toBe(8);
    expect(style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('lets inline style beat matched rules', () => {
    installStylesheet('.card { opacity: 0.5; padding: 4px }');
    const r = render(div({className: 'card', style: {opacity: 1}}));
    const style = hostStyle(r, 'div');
    expect(style.opacity).toBe(1);
    expect(style.paddingTop).toBe(4);
  });

  it('lets an inline style beat a matched rule that spells the edge differently', () => {
    // A reset states the shorthand, which expands to the four physical edges;
    // the element states the axis. Merging by key keeps both, and Yoga then
    // prefers `padding-top` to the vertical axis — so without the mask the
    // RESET wins, which is the cascade upside down. Tailwind preflight's
    // `button { padding: 0 }` under Astryx's `paddingBlock` is exactly this,
    // and it flattened every card in the transitions demo.
    installStylesheet('.reset { padding: 0 }');
    const r = render(
      div({className: 'reset', style: {paddingBlock: 12, paddingInline: 16}}),
    );
    const style = hostStyle(r, 'div');
    expect(style.paddingBlock).toBe(12);
    expect(style.paddingInline).toBe(16);
    expect(style.paddingTop).toBeUndefined();
    expect(style.paddingLeft).toBeUndefined();
  });

  it('keeps the sides of a matched rule the inline style did not claim', () => {
    installStylesheet('.reset { padding: 0 }');
    const r = render(div({className: 'reset', style: {paddingLeft: 4}}));
    const style = hostStyle(r, 'div');
    expect(style.paddingLeft).toBe(4);
    expect(style.paddingTop).toBe(0);
    expect(style.paddingRight).toBe(0);
    expect(style.paddingBottom).toBe(0);
  });

  it('matches descendant selectors through the element chain', () => {
    installStylesheet('.card .title { font-weight: 700 }');
    const r = render(
      div({
        className: 'card',
        children: div({className: 'title', children: 'x'}),
      }),
    );
    const styled = r.root.findAll(
      (n: $FlowFixMe) => n.type === 'div' && n.props.style?.fontWeight != null,
    );
    expect(styled).toHaveLength(1);
    // And the OUTER div (no matching rule) got no fontWeight.
    expect(styled[0].props.children).toBe('x');
  });

  it('applies :hover rules through automatic interaction tracking', () => {
    installStylesheet('.btn { opacity: 0.5 } .btn:hover { opacity: 1 }');
    const r = render(div({className: 'btn'}));
    const before = hostStyle(r, 'div');
    expect(before.opacity).toBe(0.5);

    const node = r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    expect(typeof node.props.onPointerEnter).toBe('function');
    TestRenderer.act(() => {
      node.props.onPointerEnter();
    });
    expect(hostStyle(r, 'div').opacity).toBe(1);
    TestRenderer.act(() => {
      node.props.onPointerLeave();
    });
    expect(hostStyle(r, 'div').opacity).toBe(0.5);
  });

  it('does not attach interaction handlers without state-gated candidates', () => {
    installStylesheet('.plain { opacity: 1 }');
    const r = render(div({className: 'plain'}));
    const node = r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    expect(node.props.onPointerEnter).toBeUndefined();
  });

  it('flips .dark variables with the platform scheme', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    installStylesheet(`
      :root { --fg: rgb(0, 0, 0) }
      .dark { --fg: rgb(255, 255, 255) }
      .text { color: var(--fg) }
    `);
    const r = render(div({className: 'text'}));
    expect(hostStyle(r, 'div').color).toBe('rgb(255, 255, 255)');
  });

  it('applies dark-variant utility rules via the virtual ancestor', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    installStylesheet(
      '.dark .dark\\:bg-black { background-color: rgb(0, 0, 0) }',
    );
    const r = render(div({className: 'dark:bg-black'}));
    expect(hostStyle(r, 'div').backgroundColor).toBe('rgb(0, 0, 0)');
  });

  it('expands the animation shorthand and resolves registered keyframes', () => {
    installStylesheet(`
      @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      .animate-spin { animation: spin 1s linear infinite }
    `);
    const r = render(div({className: 'animate-spin'}));
    const style = hostStyle(r, 'div');
    expect(style.animationDuration).toBe('1s');
    expect(style.animationTimingFunction).toBe('linear');
    expect(style.animationIterationCount).toBe('infinite');
    const stops = JSON.parse(style.animationKeyframes);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({offset: 0, transform: 'rotate(0deg)'});
  });

  it('resolves an explicit inherit on an inherited property to a null reset', () => {
    // Preflight's `h1..h6 { font-size: inherit }` must DEFEAT the
    // user-agent heading size underneath it. The engine cannot reach the UA
    // layer, but RN can: a null style value cancels the merged prop and the
    // renderer's own text cascade supplies the inherited value — which is
    // what `inherit` computes to. Dropped instead, the UA size stood, and
    // an accordion trigger (an <h3> underneath) rendered at heading size.
    installStylesheet('.reset { font-size: inherit; padding: inherit }');
    const style = hostStyle(render(div({className: 'reset'})), 'div');
    expect(style.fontSize).toBe(null);
    // A non-inherited property has nothing to compute to here; it drops.
    expect('padding' in style).toBe(false);
  });

  it('keeps a cubic-bezier() whole through the animation shorthand', () => {
    // Tailwind's own animate-pulse. The bezier's commas are INSIDE the
    // function — a naive comma split cut the shorthand there and filed
    // "cubic-bezier(.4" under animationName.
    installStylesheet(`
      @keyframes pulse { 50% { opacity: .5 } }
      .animate-pulse { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite }
    `);
    const r = render(div({className: 'animate-pulse'}));
    const style = hostStyle(r, 'div');
    expect(style.animationDuration).toBe('2s');
    expect(style.animationTimingFunction).toBe('cubic-bezier(.4,0,.6,1)');
    expect(style.animationIterationCount).toBe('infinite');
    expect(JSON.parse(style.animationKeyframes)).toEqual([
      {offset: 0.5, opacity: 0.5},
    ]);
  });

  it('keeps a cubic-bezier() whole through the transition shorthand', () => {
    installStylesheet(
      '.t2 { transition: transform .15s cubic-bezier(.4,0,.2,1), opacity 300ms }',
    );
    const style = hostStyle(render(div({className: 't2'})), 'div');
    expect(style.transitionProperty).toBe('transform, opacity');
    expect(style.transitionDuration).toBe('.15s, 300ms');
    expect(style.transitionTimingFunction).toBe(
      'cubic-bezier(.4,0,.2,1), ease',
    );
  });

  it('expands the transition shorthand into longhand lists', () => {
    installStylesheet('.t { transition: color 150ms ease-in, opacity 300ms }');
    const style = hostStyle(render(div({className: 't'})), 'div');
    expect(style.transitionProperty).toBe('color, opacity');
    expect(style.transitionDuration).toBe('150ms, 300ms');
    expect(style.transitionTimingFunction).toBe('ease-in, ease');
  });

  it('matches data attributes carried by the element', () => {
    installStylesheet('.x[data-state=open] { opacity: 1 } .x { opacity: 0 }');
    const closed = hostStyle(render(div({className: 'x'})), 'div');
    expect(closed.opacity).toBe(0);
    const open = hostStyle(
      render(div({className: 'x', 'data-state': 'open'})),
      'div',
    );
    expect(open.opacity).toBe(1);
  });

  it('leaves elements without className untouched by the engine', () => {
    installStylesheet('.styled { padding: 4px }');
    const r = render(div({children: 'plain', style: {margin: 1}}));
    const style = hostStyle(r, 'div');
    expect(style).toEqual({margin: 1});
  });
});
