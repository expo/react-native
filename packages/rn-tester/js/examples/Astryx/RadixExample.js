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

import type {RNTesterModule} from '../../types/RNTesterTypes';

import {installStylesheet} from '../../astryx/css';
// The point of this screen: these imports go through the '@radix-ui/*'
// Metro aliases, exactly as vendored shadcn sources do.
// $FlowFixMe[cannot-resolve-module] resolved by metro.config.js
import * as Accordion from '@radix-ui/react-accordion';
// $FlowFixMe[cannot-resolve-module]
import * as Checkbox from '@radix-ui/react-checkbox';
// $FlowFixMe[cannot-resolve-module]
import * as Dialog from '@radix-ui/react-dialog';
// $FlowFixMe[cannot-resolve-module]
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
// $FlowFixMe[cannot-resolve-module]
import * as Popover from '@radix-ui/react-popover';
// $FlowFixMe[cannot-resolve-module]
import * as Switch from '@radix-ui/react-switch';
// $FlowFixMe[cannot-resolve-module]
import * as Tabs from '@radix-ui/react-tabs';
// $FlowFixMe[cannot-resolve-module]
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {DemoHeader, DemoSection} from './DemoSection';
import radixCss from './radix-demo.css';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView} from 'react-native';

installStylesheet(radixCss);

function RadixExample(): React.Node {
  const [lastAction, setLastAction] = useState('none');
  const [checked, setChecked] = useState(false);
  return (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <DemoHeader title="Radix Primitives">
        Every import below is `@radix-ui/react-*`, resolved by Metro to shims
        implementing each package's public API over the fork's top layer, anchor
        positioning and focus trap. Styling is entirely `[data-state]` rules in
        radix-demo.css — the way shadcn styles Radix.
      </DemoHeader>

      <DemoSection
        title="Dialog"
        description="Portaled into the top layer, focus-trapped, dismissable by the overlay or by Close."
        code={`import * as Dialog from '@radix-ui/react-dialog';

<Dialog.Root>
  <Dialog.Trigger className="rx-btn">Open dialog</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay className="rx-overlay" />
    <Dialog.Content className="rx-panel">
      <Dialog.Title>A real Radix dialog</Dialog.Title>
      <Dialog.Close className="rx-btn">Close</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

/* radix-demo.css — the state is styled, never set in JS */
.rx-btn[data-state='open'] { opacity: 0.75; }`}>
        <div className="rx-row">
          <Dialog.Root>
            <Dialog.Trigger className="rx-btn">Open dialog</Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="rx-overlay" />
              <Dialog.Content className="rx-panel">
                <span className="rx-title">A real Radix dialog</span>
                {'\n'}
                <span className="rx-caption">
                  Top layer, focus-trapped, light-dismiss.
                </span>
                {'\n'}
                <Dialog.Close className="rx-btn">Close</Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </DemoSection>

      <DemoSection
        title="Popover"
        description="Anchored to its trigger by the fork's CSS anchor positioning, with flip and viewport clamping."
        code={`<Popover.Root>
  <Popover.Trigger className="rx-btn">Anchor me</Popover.Trigger>
  <Popover.Portal>
    <Popover.Content className="rx-panel" side="bottom" align="start">
      Anchored under the trigger.
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>`}>
        <div className="rx-row">
          <Popover.Root>
            <Popover.Trigger className="rx-btn">Anchor me</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="rx-panel" side="bottom" align="start">
                <span className="rx-caption">Anchored under the trigger.</span>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </DemoSection>

      <DemoSection
        title="DropdownMenu"
        description={`Items select and close through the root. Last action: ${lastAction}.`}
        code={`<DropdownMenu.Root>
  <DropdownMenu.Trigger className="rx-btn">Menu</DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content className="rx-panel">
      <DropdownMenu.Item className="rx-item"
        onSelect={() => setLastAction('copy')}>Copy</DropdownMenu.Item>
      <DropdownMenu.Item className="rx-item"
        onSelect={() => setLastAction('share')}>Share</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>`}>
        <div className="rx-row">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="rx-btn">Menu</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="rx-panel">
                <DropdownMenu.Item
                  className="rx-item"
                  onSelect={() => setLastAction('copy')}>
                  Copy
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="rx-item"
                  onSelect={() => setLastAction('share')}>
                  Share
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span className="rx-caption">last: {lastAction}</span>
        </div>
      </DemoSection>

      <DemoSection
        title="Switch and Checkbox"
        description="State machines whose entire styling surface is data-state — including the thumb's transition, which the renderer runs natively."
        code={`<Switch.Root className="rx-switch" checked={checked}
  onCheckedChange={setChecked}>
  <Switch.Thumb className="rx-thumb" />
</Switch.Root>

/* radix-demo.css */
.rx-switch[data-state='checked'] { background-color: var(--rx-ok); }
.rx-thumb  { transition: transform 150ms ease; }
.rx-thumb[data-state='checked'] { transform: translateX(22px); }`}>
        <div className="rx-row">
          <Switch.Root
            className="rx-switch"
            checked={checked}
            onCheckedChange={setChecked}>
            <Switch.Thumb className="rx-thumb" />
          </Switch.Root>
          <Checkbox.Root
            className="rx-toggle"
            checked={checked}
            onCheckedChange={setChecked}>
            {checked ? '✓' : ' '}
          </Checkbox.Root>
          <span className="rx-caption">{checked ? 'on' : 'off'}</span>
        </div>
      </DemoSection>

      <DemoSection
        title="ToggleGroup and Tabs"
        description="Single-select groups: exclusive selection, with the active item styled by [data-state]."
        code={`<ToggleGroup.Root className="rx-row" type="single" defaultValue="b">
  <ToggleGroup.Item className="rx-toggle" value="a">A</ToggleGroup.Item>
  <ToggleGroup.Item className="rx-toggle" value="b">B</ToggleGroup.Item>
</ToggleGroup.Root>

.rx-toggle[data-state='on'] { background-color: var(--rx-accent); }`}>
        <div className="rx-row">
          <ToggleGroup.Root className="rx-row" type="single" defaultValue="b">
            <ToggleGroup.Item className="rx-toggle" value="a">
              A
            </ToggleGroup.Item>
            <ToggleGroup.Item className="rx-toggle" value="b">
              B
            </ToggleGroup.Item>
            <ToggleGroup.Item className="rx-toggle" value="c">
              C
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
        <Tabs.Root defaultValue="one">
          <div className="rx-row">
            <Tabs.List className="rx-row">
              <div className="rx-row">
                <Tabs.Trigger className="rx-toggle" value="one">
                  One
                </Tabs.Trigger>
                <Tabs.Trigger className="rx-toggle" value="two">
                  Two
                </Tabs.Trigger>
              </div>
            </Tabs.List>
          </div>
          <Tabs.Content className="rx-tabpanel" value="one">
            First panel — only the active panel mounts.
          </Tabs.Content>
          <Tabs.Content className="rx-tabpanel" value="two">
            Second panel — the first one unmounted.
          </Tabs.Content>
        </Tabs.Root>
      </DemoSection>

      <DemoSection
        title="Accordion"
        description="Single type with the collapsible escape hatch: pressing the open item closes it."
        code={`<Accordion.Root type="single" collapsible>
  <Accordion.Item value="a">
    <Accordion.Trigger className="rx-item">Is it accessible?</Accordion.Trigger>
    <Accordion.Content className="rx-tabpanel">
      The shims carry the aria surface.
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>`}>
        <Accordion.Root type="single" collapsible={true}>
          <Accordion.Item value="a">
            <Accordion.Trigger className="rx-item">
              Is it accessible?
            </Accordion.Trigger>
            <Accordion.Content className="rx-tabpanel">
              Yes — the shims carry the aria surface.
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="b">
            <Accordion.Trigger className="rx-item">
              Does it animate?
            </Accordion.Trigger>
            <Accordion.Content className="rx-tabpanel">
              Opening is instant: the renderer cannot animate height yet.
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </DemoSection>
    </ScrollView>
  );
}

export default {
  title: 'Radix Primitives',
  category: 'UI',
  description:
    'Radix UI primitives on the fork: @radix-ui/* imports resolved to shims ' +
    'over the top layer, anchor positioning, and the stylesheet engine.',
  examples: [
    {
      title: 'Radix Primitives',
      render(): React.Node {
        return <RadixExample />;
      },
    },
  ],
} as RNTesterModule;
