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

import {
  installStylesheet,
  resetStylesheets,
  resolveCssForElement,
  rootVariables,
} from '../../astryx/css';
import {resolveInherited} from '../../astryx/stylex-rn';
// $FlowFixMe[untyped-import]
import globalsCss from '../globals.css';
import {cn} from '../lib/utils';
// $FlowFixMe[untyped-import]
import tailwindCss from '../tailwind.generated.css';
// The REAL vendored sources, resolved through the jest alias mirror of the
// Metro aliases. Nothing here is a shim of shadcn itself.
// $FlowFixMe[cannot-resolve-module]
import {Badge} from '../ui/badge';
// $FlowFixMe[cannot-resolve-module]
import {Button} from '../ui/button';
// $FlowFixMe[cannot-resolve-module]
import {Switch} from '../ui/switch';
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

// Ground truth measured in real Safari (safaridriver, 402px viewport) with
// these exact class strings and this exact stylesheet pair. Numbers that
// drift from these are fidelity regressions, not preferences.
describe('web fidelity', () => {
  // Both passes, as an element renders: the eager resolution defers var()s
  // an ancestor might still supply, and the element's own inheritance pass
  // finishes them against the :root scope.
  function styleFor(tag: string, classes: string): $FlowFixMe {
    const resolution = resolveCssForElement(
      {
        tag,
        classes: classes.split(/\s+/).filter(Boolean),
        attributes: {},
        states: {},
        parent: null,
      } as $FlowFixMe,
      {},
    );
    const rootScope = new Map<string, unknown>();
    const rootVars = rootVariables();
    if (rootVars != null) {
      for (const key of Object.keys(rootVars)) {
        rootScope.set(key, rootVars[key]);
      }
    }
    return resolveInherited(resolution.style, resolution.vars, rootScope).style;
  }

  it('a touch row is tall enough to hold its controls hitSlop', () => {
    // hitSlop does not escape its ancestors: UIKit stops descending the view
    // tree as soon as a point falls outside a parent, so slop hanging outside
    // the row is slop that is never hit-tested. A switch (24pt) or checkbox
    // (16pt) in a row only as tall as itself therefore keeps the tiny touch
    // target it looks like it has, however much slop it declares. The row
    // states the 44pt minimum so the slop has somewhere to live; the controls
    // keep the sizes shadcn designed.
    const row = styleFor(
      'div',
      'flex flex-row flex-wrap items-center gap-4 min-h-11',
    );
    expect(row.minHeight).toBe(44);
    expect(row.alignItems).toBe('center');
  });

  it('Alert box spacing matches Safari', () => {
    // Safari: alert h=72 with padding 16 on all sides; the <h5> title sits
    // exactly 16px below the alert's top (no UA margin survives) and carries
    // 4px below it.
    const alert = styleFor('div', 'relative w-full rounded-lg border p-4');
    expect(alert.paddingTop).toBe(16);
    expect(alert.paddingLeft).toBe(16);
    const title = styleFor(
      'h5',
      'mb-1 font-medium leading-none tracking-tight',
    );
    expect(title.marginTop).toBe(0);
    expect(title.marginBottom).toBe(4);
  });

  it('Card spacing matches Safari', () => {
    // Safari: header padding 24, title→description gap 6 (space-y-1.5),
    // content padding 0/24/24.
    const header = styleFor('div', 'flex flex-col space-y-1.5 p-6');
    expect(header.paddingTop).toBe(24);
    expect(header.rowGap).toBe(6);
    const content = styleFor('div', 'p-6 pt-0');
    expect(content.paddingTop).toBe(0);
    expect(content.paddingBottom).toBe(24);
  });

  it('Switch and Checkbox sizes match Safari', () => {
    // Safari: switch root 44×24 with a 20×20 thumb; checkbox 16×16.
    const root = styleFor(
      'button',
      'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2',
    );
    expect(root.width).toBe(44);
    expect(root.height).toBe(24);
    const thumb = styleFor(
      'div',
      'pointer-events-none block h-5 w-5 rounded-full',
    );
    expect(thumb.width).toBe(20);
    expect(thumb.height).toBe(20);
    const checkbox = styleFor(
      'button',
      'peer h-4 w-4 shrink-0 rounded-sm border',
    );
    expect(checkbox.width).toBe(16);
    expect(checkbox.height).toBe(16);
  });

  it('Button metrics match Safari', () => {
    // Safari: h=40, padding 8px 16px, font 14/20.
    const button = styleFor('button', 'inline-flex h-10 px-4 py-2 text-sm');
    expect(button.height).toBe(40);
    expect(button.paddingLeft).toBe(16);
    expect(button.paddingTop).toBe(8);
    expect(button.fontSize).toBe(14);
    expect(button.lineHeight).toBe(20);
  });
});

describe('cn', () => {
  it('keeps utilities that merely share a prefix but not an axis', () => {
    // The regression that laid four inline badges out as full-width blocks:
    // `flex` is display, `flex-row` is flex-direction. Prefix-based grouping
    // dropped display:flex whenever a component's own classes met a
    // consumer className.
    expect(cn('flex flex-row gap-2').split(' ').sort()).toEqual([
      'flex',
      'flex-row',
      'gap-2',
    ]);
    expect(cn('p-6 pt-0').split(' ').sort()).toEqual(['p-6', 'pt-0']);
    expect(cn('text-sm text-muted-foreground').split(' ').sort()).toEqual([
      'text-muted-foreground',
      'text-sm',
    ]);
    expect(cn('border border-input').split(' ').sort()).toEqual([
      'border',
      'border-input',
    ]);
  });

  it('collapses utilities that DO share an axis', () => {
    expect(cn('flex grid')).toBe('grid');
    expect(cn('flex-row flex-col')).toBe('flex-col');
    expect(cn('absolute relative')).toBe('relative');
    expect(cn('text-sm text-lg')).toBe('text-lg');
  });

  it('keeps a ring width next to a ring colour', () => {
    // The collision that deleted every focus ring's WIDTH across the design
    // system: ring-2 is a width, ring-ring is a colour — one prefix, two
    // axes, the flex/flex-row shape again. The switch loses its offset the
    // same way (offset width and offset colour).
    expect(
      cn('focus-visible:ring-2 focus-visible:ring-ring').split(' ').sort(),
    ).toEqual(['focus-visible:ring-2', 'focus-visible:ring-ring']);
    expect(
      cn(
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )
        .split(' ')
        .sort(),
    ).toEqual([
      'focus-visible:ring-offset-2',
      'focus-visible:ring-offset-background',
    ]);
    // Same axis still collapses: widths against widths, colours against
    // colours, and the bare `ring` (the 3px default) IS a width.
    expect(cn('ring-2 ring-4')).toBe('ring-4');
    expect(cn('ring ring-0')).toBe('ring-0');
    expect(cn('ring-ring ring-blue-500')).toBe('ring-blue-500');
  });

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
        n.type === 'div' && n.props['data-state'] === 'checked',
    );
    expect(thumbs.length).toBeGreaterThan(0);
  });
});
