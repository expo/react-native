/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

/**
 * A block with `overflow: auto` grows to its content instead of scrolling
 * inside the page; only an explicit `overflow-x: auto` scrolls, sideways, as
 * the content of a horizontal native scroll view, which takes the box's
 * sizing and paint while the element keeps its padding and its children's
 * layout. See DOM-CSS-LIMITATION(no-nested-vertical-scroll) in jsx-runtime.js.
 */

import {jsx} from '../jsx-runtime';
import TestRenderer from 'react-test-renderer';

function renderTree(element: $FlowFixMe): $FlowFixMe {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  const tree = renderer.toJSON();
  TestRenderer.act(() => renderer.unmount());
  return tree;
}

function find(node: $FlowFixMe, type: string): $FlowFixMe {
  if (node == null || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit != null) {
        return hit;
      }
    }
    return null;
  }
  // $FlowFixMe[invalid-compare] the test renderer's JSON is untyped
  if (node.type === type) {
    return node;
  }
  return find(node.children, type);
}

// A style prop as the renderer saw it, arrays and all, as one object
function flatten(style: $FlowFixMe): {[string]: $FlowFixMe} {
  const out: {[string]: $FlowFixMe} = {};
  for (const layer of [].concat(style ?? [])) {
    if (layer != null && typeof layer === 'object') {
      for (const key of Object.keys(layer)) {
        out[key] = layer[key];
      }
    }
  }
  return out;
}

describe('a block with overflow auto', () => {
  const page = jsx('div', {
    style: {
      overflow: 'auto',
      height: 320,
      maxHeight: 400,
      flex: 1,
      minHeight: 0,
      backgroundColor: 'rgb(1, 2, 3)',
      padding: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    },
    children: jsx('p', {children: 'row'}),
  });

  it('grows to its content instead of scrolling', () => {
    // A region of a phone page does not scroll on its own: the page does
    const tree = renderTree(page);
    expect(find(tree, 'native:scroll')).toBeNull();
    expect(find(tree, 'div')).not.toBeNull();
  });

  it('takes its height as a minimum and keeps its content height', () => {
    const tree = renderTree(page);
    const style = flatten(find(tree, 'div').props.style);
    expect(style.minHeight).toBe(320);
    expect(style.height).toBe(undefined);
    expect(style.maxHeight).toBe(undefined);
    expect(style.overflow).toBe(undefined);
    // `flex: 1; min-height: 0` let it give way to its siblings; it no longer does
    expect(style.flexShrink).toBe(0);
    expect(style.flexGrow).toBe(1);
    expect(style.flexBasis).toBe('auto');
    expect(style.flex).toBe(undefined);
    expect(style).toMatchObject({
      backgroundColor: 'rgb(1, 2, 3)',
      padding: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    });
  });
});

describe('a block with overflow-x auto', () => {
  const strip = jsx('div', {
    style: {
      overflowX: 'auto',
      flex: 1,
      minHeight: 0,
      backgroundColor: 'rgb(1, 2, 3)',
      padding: 8,
      display: 'flex',
      flexDirection: 'row',
      gap: 4,
    },
    children: jsx('p', {children: 'column'}),
  });

  it('renders as the content of a horizontal scroll view', () => {
    const tree = renderTree(strip);
    const scroll = find(tree, 'RCTScrollView');
    expect(scroll).not.toBeNull();
    expect(scroll.props.horizontal).toBe(true);
    expect(find(scroll, 'div')).not.toBeNull();
  });

  it('is a region of the page, not the page', () => {
    // No rubber band when the content fits, which is when the scroll view
    // would otherwise take a drag meant for the page
    const scroll = find(renderTree(strip), 'RCTScrollView');
    expect(scroll.props.alwaysBounceHorizontal).toBe(false);
    expect(scroll.props.alwaysBounceVertical).not.toBe(true);
  });

  it('gives the scroll view the box and keeps the layout on the element', () => {
    const tree = renderTree(strip);
    const scroll = find(tree, 'RCTScrollView');
    const viewport = flatten(scroll.props.style);
    expect(viewport).toMatchObject({
      flex: 1,
      minHeight: 0,
      backgroundColor: 'rgb(1, 2, 3)',
    });
    expect(viewport.padding).toBe(undefined);
    expect(viewport.overflowX).toBe(undefined);
    const content = flatten(find(scroll, 'div').props.style);
    expect(content).toMatchObject({
      padding: 8,
      display: 'flex',
      flexDirection: 'row',
      gap: 4,
    });
    expect(content.flex).toBe(undefined);
    expect(content.overflowX).toBe(undefined);
  });

  it('scrolls sideways and grows downward when both axes overflow', () => {
    const both = jsx('div', {
      style: {overflowX: 'auto', overflowY: 'auto', height: 200, width: 240},
      children: jsx('p', {children: 'cell'}),
    });
    const tree = renderTree(both);
    const scroll = find(tree, 'RCTScrollView');
    expect(scroll).not.toBeNull();
    expect(scroll.props.horizontal).toBe(true);
    const viewport = flatten(scroll.props.style);
    expect(viewport.minHeight).toBe(200);
    expect(viewport.height).toBe(undefined);
    expect(viewport.width).toBe(240);
  });

  it('does not scroll sideways for the overflow shorthand', () => {
    // `overflow: auto` names a region that scrolls down on the web; a
    // horizontal scroll view would measure its text without a width
    const card = jsx('div', {
      style: {overflow: 'auto', height: 200},
      children: jsx('p', {children: 'a paragraph that wraps'}),
    });
    const tree = renderTree(card);
    expect(find(tree, 'RCTScrollView')).toBeNull();
    expect(find(tree, 'native:scroll')).toBeNull();
    const style = flatten(find(tree, 'div').props.style);
    expect(style.minHeight).toBe(200);
    expect(style.overflowX).toBe(undefined);
  });
});

describe('a block that does not overflow', () => {
  it('leaves a block without overflow alone', () => {
    const tree = renderTree(
      jsx('div', {style: {padding: 8}, children: jsx('p', {children: 'x'})}),
    );
    expect(find(tree, 'native:scroll')).toBeNull();
    expect(find(tree, 'div')).not.toBeNull();
  });

  it('does not scroll a text-level element', () => {
    const tree = renderTree(
      jsx('span', {style: {overflow: 'auto'}, children: 'x'}),
    );
    expect(find(tree, 'native:scroll')).toBeNull();
  });
});
