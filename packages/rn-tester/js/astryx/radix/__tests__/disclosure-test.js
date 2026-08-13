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
  AccordionContent,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from '../disclosure';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

function render(element: $FlowFixMe): $FlowFixMe {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  return renderer;
}

function byClass(r: $FlowFixMe, cls: string): $FlowFixMe {
  const all = r.root.findAll((n: $FlowFixMe) => n.props?.className === cls);
  return all[all.length - 1];
}

function countHostByClass(r: $FlowFixMe, cls: string): number {
  // Composite fibers match even when they render null; more than one match
  // means the intrinsic wrapper (real render) exists too.
  return r.root.findAll((n: $FlowFixMe) => n.props?.className === cls).length;
}

describe('Tabs', () => {
  function App(): React.Node {
    return (
      <TabsRoot defaultValue="one">
        <TabsList>
          <TabsTrigger className="t1" value="one">
            One
          </TabsTrigger>
          <TabsTrigger className="t2" value="two">
            Two
          </TabsTrigger>
        </TabsList>
        <TabsContent className="c1" value="one">
          first
        </TabsContent>
        <TabsContent className="c2" value="two">
          second
        </TabsContent>
      </TabsRoot>
    );
  }

  it('selects, shows only the active panel, and switches', () => {
    const r = render(<App />);
    expect(byClass(r, 't1').props['data-state']).toBe('active');
    expect(byClass(r, 't1').props['aria-selected']).toBe('true');
    expect(countHostByClass(r, 'c1')).toBeGreaterThan(1);
    expect(countHostByClass(r, 'c2')).toBe(1);
    TestRenderer.act(() => byClass(r, 't2').props.onClick({}));
    expect(byClass(r, 't2').props['data-state']).toBe('active');
    expect(byClass(r, 't1').props['data-state']).toBe('inactive');
    expect(countHostByClass(r, 'c2')).toBeGreaterThan(1);
    expect(countHostByClass(r, 'c1')).toBe(1);
  });
});

describe('Collapsible', () => {
  it('toggles content mount and data-state', () => {
    const r = render(
      <CollapsibleRoot>
        <CollapsibleTrigger className="trig">More</CollapsibleTrigger>
        <CollapsibleContent className="body">hidden</CollapsibleContent>
      </CollapsibleRoot>,
    );
    expect(countHostByClass(r, 'body')).toBe(1);
    TestRenderer.act(() => byClass(r, 'trig').props.onClick({}));
    expect(countHostByClass(r, 'body')).toBeGreaterThan(1);
    expect(byClass(r, 'trig').props['data-state']).toBe('open');
  });
});

describe('Accordion', () => {
  function App({collapsible = false}: {collapsible?: boolean}): React.Node {
    return (
      <AccordionRoot type="single" collapsible={collapsible}>
        <AccordionItem className="i1" value="a">
          <AccordionTrigger className="tr1">A</AccordionTrigger>
          <AccordionContent className="ct1">alpha</AccordionContent>
        </AccordionItem>
        <AccordionItem className="i2" value="b">
          <AccordionTrigger className="tr2">B</AccordionTrigger>
          <AccordionContent className="ct2">beta</AccordionContent>
        </AccordionItem>
      </AccordionRoot>
    );
  }

  it('single type is exclusive', () => {
    const r = render(<App />);
    TestRenderer.act(() => byClass(r, 'tr1').props.onClick({}));
    expect(countHostByClass(r, 'ct1')).toBeGreaterThan(1);
    TestRenderer.act(() => byClass(r, 'tr2').props.onClick({}));
    expect(countHostByClass(r, 'ct1')).toBe(1);
    expect(countHostByClass(r, 'ct2')).toBeGreaterThan(1);
    expect(byClass(r, 'i2').props['data-state']).toBe('open');
  });

  it('non-collapsible keeps one open; collapsible closes on re-press', () => {
    const strict = render(<App />);
    TestRenderer.act(() => byClass(strict, 'tr1').props.onClick({}));
    TestRenderer.act(() => byClass(strict, 'tr1').props.onClick({}));
    expect(countHostByClass(strict, 'ct1')).toBeGreaterThan(1);

    const loose = render(<App collapsible={true} />);
    TestRenderer.act(() => byClass(loose, 'tr1').props.onClick({}));
    TestRenderer.act(() => byClass(loose, 'tr1').props.onClick({}));
    expect(countHostByClass(loose, 'ct1')).toBe(1);
  });
});
