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
import '../../document-shim';
import '../../dom-compat';

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
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function render(element: React.MixedElement): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return root;
}

// The rendered element a selector matches, null when none does
function query(root: $FlowFixMe, selector: string): $FlowFixMe {
  return root.document.querySelector(selector);
}

function press(root: $FlowFixMe, selector: string): void {
  Fantom.dispatchNativeEvent(query(root, selector), 'click');
}

function state(root: $FlowFixMe, selector: string): ?string {
  return query(root, selector).getAttribute('data-state');
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
    const root = render(<App />);
    expect(state(root, '.t1')).toBe('active');
    expect(query(root, '.t1').getAttribute('aria-selected')).toBe('true');
    expect(query(root, '.c1')).not.toBeNull();
    expect(query(root, '.c2')).toBeNull();
    press(root, '.t2');
    expect(state(root, '.t2')).toBe('active');
    expect(state(root, '.t1')).toBe('inactive');
    expect(query(root, '.c2')).not.toBeNull();
    expect(query(root, '.c1')).toBeNull();
  });
});

describe('Collapsible', () => {
  it('toggles content mount and data-state', () => {
    const root = render(
      <CollapsibleRoot>
        <CollapsibleTrigger className="trig">More</CollapsibleTrigger>
        <CollapsibleContent className="body">hidden</CollapsibleContent>
      </CollapsibleRoot>,
    );
    expect(query(root, '.body')).toBeNull();
    press(root, '.trig');
    expect(query(root, '.body')).not.toBeNull();
    expect(state(root, '.trig')).toBe('open');
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
    const root = render(<App />);
    press(root, '.tr1');
    expect(query(root, '.ct1')).not.toBeNull();
    press(root, '.tr2');
    expect(query(root, '.ct1')).toBeNull();
    expect(query(root, '.ct2')).not.toBeNull();
    expect(state(root, '.i2')).toBe('open');
  });

  it('non-collapsible keeps one open; collapsible closes on re-press', () => {
    const strict = render(<App />);
    press(strict, '.tr1');
    press(strict, '.tr1');
    expect(query(strict, '.ct1')).not.toBeNull();

    const loose = render(<App collapsible={true} />);
    press(loose, '.tr1');
    press(loose, '.tr1');
    expect(query(loose, '.ct1')).toBeNull();
  });
});
