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
