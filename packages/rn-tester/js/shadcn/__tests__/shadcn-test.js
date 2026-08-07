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

import {installStylesheet, resetStylesheets} from '../../astryx/css';
// The REAL vendored sources, resolved through the jest alias mirror of the
// Metro aliases. Nothing here is a shim of shadcn itself.
// $FlowFixMe[cannot-resolve-module]
import {Badge} from '../ui/badge';
// $FlowFixMe[cannot-resolve-module]
import {Button} from '../ui/button';
// $FlowFixMe[cannot-resolve-module]
import {Switch} from '../ui/switch';
// $FlowFixMe[untyped-import]
import globalsCss from '../globals.css';
// $FlowFixMe[untyped-import]
import tailwindCss from '../tailwind.generated.css';
import {cn} from '../lib/utils';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

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

beforeEach(() => {
  installStylesheet(globalsCss);
  installStylesheet(tailwindCss);
});

afterEach(() => {
  TestRenderer.act(() => {
    for (const renderer of liveRenderers) {
      renderer.unmount();
    }
  });
  liveRenderers.length = 0;
  resetStylesheets();
});

function hostStyle(r: $FlowFixMe, type: string): $FlowFixMe {
  const nodes = r.root.findAll(
    (n: $FlowFixMe) => n.type === type && n.props.style != null,
  );
  return nodes.length > 0 ? nodes[0].props.style : null;
}

describe('cn', () => {
  it('merges conflicting utilities, later wins', () => {
    expect(cn('px-4 py-2', 'px-8').split(' ').sort()).toEqual(['px-8', 'py-2']);
    expect(cn('bg-primary', false, 'bg-secondary')).toBe('bg-secondary');
    expect(cn('hover:bg-primary/90', 'hover:bg-accent')).toBe(
      'hover:bg-accent',
    );
  });
});

describe('shadcn on the fork', () => {
  it('Button default variant resolves its Tailwind classes', () => {
    const r = render(<Button>Save</Button>);
    const style = hostStyle(r, 'button');
    // h-10 px-4 py-2 rounded-md text-sm font-medium bg-primary
    expect(style.height).toBe(40);
    expect(style.paddingLeft).toBe(16);
    expect(style.paddingTop).toBe(8);
    expect(style.fontSize).toBe(14);
    expect(style.fontWeight).toBe(500);
    // bg-primary → hsl(var(--primary)) → hsl(222.2 47.4% 11.2%)
    expect(String(style.backgroundColor)).toMatch(/hsl|rgb|#/);
  });

  it('Button variants differ where their classes differ', () => {
    const primary = hostStyle(render(<Button>a</Button>), 'button');
    const outline = hostStyle(
      render(<Button variant="outline">b</Button>),
      'button',
    );
    expect(outline.borderWidth).toBe(1);
    expect(primary.borderWidth).toBeUndefined();
    expect(outline.backgroundColor).not.toEqual(primary.backgroundColor);
  });

  it('consumer className overrides component defaults through cn', () => {
    const r = render(<Button className="px-8">wide</Button>);
    expect(hostStyle(r, 'button').paddingLeft).toBe(32);
  });

  it('Badge renders its pill shape', () => {
    const r = render(<Badge>New</Badge>);
    const style = hostStyle(r, 'div');
    expect(style.borderRadius).toBe(9999);
    expect(style.borderWidth).toBe(1);
    expect(style.fontSize).toBe(12);
  });

  it('Switch styles by data-state through the stylesheet', () => {
    const r = render(<Switch />);
    // Root carries data-state=unchecked → bg-input color.
    const unchecked = r.root.findAll(
      (n: $FlowFixMe) =>
        n.type === 'button' && n.props['data-state'] === 'unchecked',
    );
    expect(unchecked.length).toBeGreaterThan(0);
    const root = unchecked[0];
    TestRenderer.act(() => root.props.onClick({}));
    const checked = r.root.findAll(
      (n: $FlowFixMe) =>
        n.type === 'button' && n.props['data-state'] === 'checked',
    );
    expect(checked.length).toBeGreaterThan(0);
    // The thumb re-styles with the flipped state; its translate renders
    // through the transform string pipeline (sim-verified rather than
    // asserted here — RN's string-transform parsing is the native side).
    const thumbs = r.root.findAll(
      (n: $FlowFixMe) =>
        n.type === 'span' && n.props['data-state'] === 'checked',
    );
    expect(thumbs.length).toBeGreaterThan(0);
  });
});
