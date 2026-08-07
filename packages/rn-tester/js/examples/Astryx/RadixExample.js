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
// Metro aliases, exactly as vendored shadcn sources will.
// $FlowFixMe[cannot-resolve-module] resolved by metro.config.js
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
import radixCss from './radix-demo.css';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView} from 'react-native';

installStylesheet(radixCss);

function Demo(): React.Node {
  const [lastAction, setLastAction] = useState('none');
  return (
    <div className="rx-page">
      <div className="rx-row">
        <span className="rx-title">Dialog</span>
        {'\n'}
        <Dialog.Root>
          <Dialog.Trigger className="rx-btn">Open dialog</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="rx-overlay" />
            <Dialog.Content className="rx-panel">
              <Dialog.Title>A real Radix dialog</Dialog.Title>
              <Dialog.Description>
                Portaled to the top layer, focus-trapped, dismissable.
              </Dialog.Description>
              <Dialog.Close className="rx-btn">Close</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="rx-row">
        <span className="rx-title">Popover</span>
        {'\n'}
        <Popover.Root>
          <Popover.Trigger className="rx-btn">Anchor me</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="rx-panel" side="bottom" align="start">
              Anchored under the trigger.
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="rx-row">
        <span className="rx-title">DropdownMenu (last: {lastAction})</span>
        {'\n'}
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
      </div>

      <div className="rx-row">
        <span className="rx-title">Switch + ToggleGroup + Tabs</span>
        {'\n'}
        <Switch.Root className="rx-switch">
          <Switch.Thumb className="rx-thumb" />
        </Switch.Root>
        {'\n'}
        <ToggleGroup.Root type="single" defaultValue="b">
          <ToggleGroup.Item className="rx-toggle" value="a">
            A
          </ToggleGroup.Item>
          <ToggleGroup.Item className="rx-toggle" value="b">
            B
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        {'\n'}
        <Tabs.Root defaultValue="one">
          <Tabs.List>
            <Tabs.Trigger className="rx-toggle" value="one">
              One
            </Tabs.Trigger>
            <Tabs.Trigger className="rx-toggle" value="two">
              Two
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content className="rx-tabpanel" value="one">
            First panel.
          </Tabs.Content>
          <Tabs.Content className="rx-tabpanel" value="two">
            Second panel.
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

function RadixExample(): React.Node {
  // No local TopLayerHost: overlays present into the APP-ROOT host
  // (RNTesterAppShared). A host nested inside this scrolling screen would
  // measure zero height, and its content would paint outside its bounds —
  // visible but untouchable, since hit-testing respects bounds.
  return (
    <ScrollView style={{flex: 1}}>
      <Demo />
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
