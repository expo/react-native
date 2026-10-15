/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import * as React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

// Test the template's interactions; native layout is checked in the simulator.
jest.mock('astryx-jsx/jsx-runtime', () => require('react/jsx-runtime'));
jest.mock(
  '@astryxdesign/core/Layout',
  () => ({
    HStack: 'HStack',
    VStack: 'VStack',
    StackItem: 'StackItem',
    LayoutContent: 'LayoutContent',
    Layout: ({header, content}) =>
      require('react').createElement('Layout', null, header, content),
  }),
  {virtual: true},
);
jest.mock(
  '@astryxdesign/core/Resizable',
  () => ({
    ResizeHandle: 'ResizeHandle',
    useResizable: () => ({size: 640, props: {}}),
  }),
  {virtual: true},
);
jest.mock(
  '@astryxdesign/core/Toolbar',
  () => ({
    Toolbar: ({startContent, endContent}) =>
      require('react').createElement('Toolbar', null, startContent, endContent),
  }),
  {virtual: true},
);
for (const [module, names] of Object.entries({
  Text: ['Text', 'Heading'],
  Chat: [
    'ChatComposer',
    'ChatComposerInput',
    'ChatLayout',
    'ChatMessage',
    'ChatMessageBubble',
    'ChatMessageList',
    'ChatMessageMetadata',
    'ChatSystemMessage',
    'ChatTokenizedText',
    'ChatToolCalls',
  ],
  Avatar: ['Avatar'],
  Card: ['Card'],
  ClickableCard: ['ClickableCard'],
  Section: ['Section'],
  Markdown: ['Markdown'],
  CodeBlock: ['CodeBlock'],
  Timestamp: ['Timestamp'],
  Token: ['Token'],
  Button: ['Button'],
  Icon: ['Icon'],
  Dialog: ['Dialog', 'DialogHeader'],
  DropdownMenu: ['DropdownMenu'],
  MoreMenu: ['MoreMenu'],
})) {
  jest.doMock(
    '@astryxdesign/core/' + module,
    () => Object.fromEntries(names.map(name => [name, name])),
    {virtual: true},
  );
}

let Template;
beforeAll(() => {
  Template = require('../templates/ai-chat/page').default;
});

function renderAt(width) {
  let renderer;
  const viewport = {offsetWidth: width};
  act(() => {
    renderer = TestRenderer.create(<Template />, {
      createNodeMock: () => viewport,
    });
  });
  renderer.viewport = viewport;
  return renderer;
}

function artifactPanels(renderer) {
  return renderer.root.findAllByProps({className: 'ai-chat-artifact-panel'});
}

function openArtifact(renderer) {
  act(() => {
    renderer.root
      .findByProps({label: 'Open JWT Token Refresh: Design & Rollout'})
      .props.onClick();
  });
}

test('unfolding keeps the transcript alone until the document is requested', () => {
  const renderer = renderAt(382);
  renderer.viewport.offsetWidth = 1440;
  act(() => renderer.update(<Template />));
  expect(artifactPanels(renderer)).toHaveLength(0);
  expect(renderer.root.findByType('Dialog').props.isOpen).toBe(false);
});

test('a wide launch also keeps the transcript alone, then opens the requested panel', () => {
  const renderer = renderAt(1440);
  expect(artifactPanels(renderer)).toHaveLength(0);
  openArtifact(renderer);
  expect(artifactPanels(renderer)).toHaveLength(1);
  expect(renderer.root.findByType('Dialog').props.isOpen).toBe(false);
  act(() => {
    renderer.root.findByProps({label: 'Close document'}).props.onClick();
  });
  expect(artifactPanels(renderer)).toHaveLength(0);
  openArtifact(renderer);
  expect(artifactPanels(renderer)).toHaveLength(1);
});

test('the unfolded Duo opens its requested document as a dialog', () => {
  const renderer = renderAt(867);
  openArtifact(renderer);
  expect(artifactPanels(renderer)).toHaveLength(0);
  expect(renderer.root.findByType('Dialog').props.isOpen).toBe(true);
  act(() => {
    renderer.root.findByType('DialogHeader').props.onOpenChange(false);
  });
  expect(renderer.root.findByType('Dialog').props.isOpen).toBe(false);
  openArtifact(renderer);
  expect(renderer.root.findByType('Dialog').props.isOpen).toBe(true);
});
