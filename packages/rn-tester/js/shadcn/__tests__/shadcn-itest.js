/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../../astryx/document-shim';
import '../../astryx/dom-compat';

import type {Stylesheet} from '../../astryx/css';

import {installStylesheet, removeStylesheet} from '../../astryx/css';
import {jsx} from '../../astryx/jsx-runtime';
import {computedStyleForInstance} from '../../astryx/native-css/engine';
// $FlowFixMe[untyped-import]
import globalsCss from '../globals.css';
// $FlowFixMe[untyped-import]
import tailwindCss from '../tailwind.generated.css';
// The REAL vendored sources, resolved through the Metro aliases. Nothing here
// is a shim of shadcn itself.
// $FlowFixMe[cannot-resolve-module]
import {Badge} from '../ui/badge';
// $FlowFixMe[cannot-resolve-module]
import {Button} from '../ui/button';
// $FlowFixMe[cannot-resolve-module]
import {Switch} from '../ui/switch';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

// A ref to an element, which the test calls the DOM's methods of
function elementRef(): {current: $FlowFixMe} {
  return React.createRef();
}

const liveRoots: Array<$FlowFixMe> = [];
let sheets: Array<Stylesheet> = [];

// The element `ref` points at once `element` has rendered
function render(element: unknown, ref: {current: $FlowFixMe}): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element as $FlowFixMe);
  });
  liveRoots.push(root);
  if (ref.current == null) {
    throw new Error('nothing rendered');
  }
  return ref.current;
}

beforeEach(() => {
  sheets = [installStylesheet(globalsCss), installStylesheet(tailwindCss)];
});

afterEach(() => {
  for (const root of liveRoots) {
    Fantom.runTask(() => root.destroy());
  }
  liveRoots.length = 0;
  for (const sheet of sheets) {
    removeStylesheet(sheet);
  }
  sheets = [];
});

// Ground truth measured in real Safari (safaridriver, 402px viewport) with
// these exact class strings and this exact stylesheet pair. Numbers that
// drift from these are fidelity regressions, not preferences.
describe('web fidelity', () => {
  // One element with these classes, in a block as on a page
  function elementFor(tag: string, classes: string): $FlowFixMe {
    const ref = elementRef();
    return render(
      jsx('div', {children: jsx(tag, {ref, className: classes})}),
      ref,
    );
  }

  // CSSOM's resolved values, with `width` and `height` the used size
  function styleFor(tag: string, classes: string): $FlowFixMe {
    return global.getComputedStyle(elementFor(tag, classes));
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
    expect(row.minHeight).toBe('44px');
    expect(row.height).toBe('44px');
    expect(row.alignItems).toBe('center');
  });

  it('Alert box spacing matches Safari', () => {
    // Safari: alert h=72 with padding 16 on all sides; the <h5> title sits
    // exactly 16px below the alert's top (no UA margin survives) and carries
    // 4px below it.
    const alert = styleFor('div', 'relative w-full rounded-lg border p-4');
    expect(alert.paddingTop).toBe('16px');
    expect(alert.paddingLeft).toBe('16px');
    const title = styleFor(
      'h5',
      'mb-1 font-medium leading-none tracking-tight',
    );
    expect(title.marginTop).toBe('0px');
    expect(title.marginBottom).toBe('4px');
  });

  it('Card spacing matches Safari', () => {
    // Safari: header padding 24, title→description gap 6 (space-y-1.5),
    // content padding 0/24/24.
    const title = elementRef();
    const description = elementRef();
    const header = elementRef();
    render(
      jsx('div', {
        ref: header,
        className: 'flex flex-col space-y-1.5 p-6',
        children: [
          jsx(
            'h3',
            {
              ref: title,
              className: 'text-2xl font-semibold leading-none tracking-tight',
              children: 'Title',
            },
            'title',
          ),
          jsx(
            'p',
            {
              ref: description,
              className: 'text-sm text-muted-foreground',
              children: 'Description',
            },
            'description',
          ),
        ],
      }),
      header,
    );
    expect(global.getComputedStyle(header.current).paddingTop).toBe('24px');
    expect(
      description.current.getBoundingClientRect().top -
        title.current.getBoundingClientRect().bottom,
    ).toBe(6);
    const content = styleFor('div', 'p-6 pt-0');
    expect(content.paddingTop).toBe('0px');
    expect(content.paddingBottom).toBe('24px');
  });

  it('Switch and Checkbox sizes match Safari', () => {
    // Safari: switch root 44×24 with a 20×20 thumb; checkbox 16×16.
    const root = styleFor(
      'button',
      'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2',
    );
    expect([root.width, root.height]).toEqual(['44px', '24px']);
    const thumb = styleFor(
      'div',
      'pointer-events-none block h-5 w-5 rounded-full',
    );
    expect([thumb.width, thumb.height]).toEqual(['20px', '20px']);
    // The size the sheets resolve: a button that keeps the user agent's
    // display is given no box of its own (`cssBox`), so its used size is not
    // yet 16×16
    const checkbox: $FlowFixMe = computedStyleForInstance(
      elementFor('button', 'peer h-4 w-4 shrink-0 rounded-sm border'),
    );
    expect([checkbox.width, checkbox.height]).toEqual([16, 16]);
  });

  it('Button metrics match Safari', () => {
    // Safari: h=40, padding 8px 16px, font 14/20.
    const button = styleFor('button', 'inline-flex h-10 px-4 py-2 text-sm');
    expect(button.height).toBe('40px');
    expect(button.paddingLeft).toBe('16px');
    expect(button.paddingTop).toBe('8px');
    expect(button.fontSize).toBe('14px');
    expect(button.lineHeight).toBe('20px');
  });
});

describe('shadcn on the fork', () => {
  // The resolved style of the element a component renders and refers to
  function styleOf(element: $FlowFixMe): $FlowFixMe {
    const ref = elementRef();
    return global.getComputedStyle(
      render(React.cloneElement(element, {ref}), ref),
    );
  }

  it('Button default variant resolves its Tailwind classes', () => {
    const style = styleOf(<Button>Save</Button>);
    // h-10 px-4 py-2 rounded-md text-sm font-medium bg-primary
    expect(style.height).toBe('40px');
    expect(style.paddingLeft).toBe('16px');
    expect(style.paddingTop).toBe('8px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');
    // bg-primary → hsl(var(--primary)) → hsl(222.2 47.4% 11.2%)
    expect(style.backgroundColor).toBe('rgba(15, 23, 42, 1)');
  });

  it('Button variants differ where their classes differ', () => {
    const primary = styleOf(<Button>a</Button>);
    const outline = styleOf(<Button variant="outline">b</Button>);
    expect(outline.borderTopWidth).toBe('1px');
    expect(primary.borderTopWidth).toBe('0px');
    expect(outline.backgroundColor).not.toEqual(primary.backgroundColor);
  });

  it('consumer className overrides component defaults through cn', () => {
    expect(styleOf(<Button className="px-8">wide</Button>).paddingLeft).toBe(
      '32px',
    );
  });

  it('Badge renders its pill shape', () => {
    const style = styleOf(<Badge>New</Badge>);
    expect(style.borderTopLeftRadius).toBe('9999px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.fontSize).toBe('12px');
  });

  it('Switch styles by data-state through the stylesheet', () => {
    const ref = elementRef();
    const root = render(<Switch ref={ref} />, ref);
    // Root carries data-state=unchecked → bg-input color.
    expect(root.getAttribute('data-state')).toBe('unchecked');
    const thumb = root.childNodes[0];
    const uncheckedColor = global.getComputedStyle(root).backgroundColor;
    const uncheckedLeft = thumb.getBoundingClientRect().left;
    Fantom.runTask(() => {
      root.click();
    });
    expect(root.getAttribute('data-state')).toBe('checked');
    expect(global.getComputedStyle(root).backgroundColor).not.toBe(
      uncheckedColor,
    );
    // The thumb re-styles with the flipped state: translate-x-5
    expect(thumb.getAttribute('data-state')).toBe('checked');
    expect(thumb.getBoundingClientRect().left - uncheckedLeft).toBe(20);
  });
});
