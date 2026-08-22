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

import type {RNTesterModule} from '../../types/RNTesterTypes';

import {
  ThemingNote,
  pinnedLightSurface,
  usePublishRects,
} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {useRef} from 'react';
import {Text, View} from 'react-native';

// Text inheritance and `all` boundaries (text-inheritance-boundaries.md),
// exercised on-device: root <Text>'s user-agent boundary, the opt-ins
// (`unset`/`inherit`), `revert`'s per-element resolution against the UA
// origin, and `initial` isolation on Views. Every case publishes its rect to
// globalThis.__displayVerify for CDP assertions
// (scripts/cascade-cdp-verify.js) — heights carry the signal, and every
// compared pair renders the IDENTICAL string so line wrapping can never fake
// a result.

const PROBE = 'boundary probe';

function Case({
  label,
  children,
}: {
  label: string,
  children: React.Node,
}): React.Node {
  return (
    <View style={{marginBottom: 8}}>
      <Text style={{fontSize: 11, opacity: 0.6}}>{label}</Text>
      {children}
    </View>
  );
}

function CascadeCases(): React.Node {
  const defaultText = useRef<React.ElementRef<typeof View> | null>(null);
  const unsetText = useRef<React.ElementRef<typeof View> | null>(null);
  const revertText = useRef<React.ElementRef<typeof View> | null>(null);
  const inheritText = useRef<React.ElementRef<typeof View> | null>(null);
  const textControl = useRef<React.ElementRef<typeof View> | null>(null);
  const text30Control = useRef<React.ElementRef<typeof View> | null>(null);
  const revertView = useRef<React.ElementRef<typeof View> | null>(null);
  const initialView = useRef<React.ElementRef<typeof View> | null>(null);
  const bareControl = useRef<React.ElementRef<typeof View> | null>(null);
  const bare30Control = useRef<React.ElementRef<typeof View> | null>(null);
  usePublishRects({
    cascDefaultText: defaultText,
    cascUnsetText: unsetText,
    cascRevertText: revertText,
    cascInheritText: inheritText,
    cascTextControl: textControl,
    cascText30Control: text30Control,
    cascRevertView: revertView,
    cascInitialView: initialView,
    cascBareControl: bareControl,
    cascBare30Control: bare30Control,
  });

  return (
    <View>
      <ThemingNote>
        {'These probes set no color on purpose — an unstyled <Text> is what ' +
          'the boundary is demonstrated on, so the surface is pinned light ' +
          'to keep them legible in either appearance.'}
      </ThemingNote>
      <View style={pinnedLightSurface()}>
        <Case label="default <Text> under fontSize:30 View (UA boundary holds)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            <Text ref={defaultText}>{PROBE}</Text>
          </View>
        </Case>
        <Case label="<Text all:'unset'> (opts into the cascade)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <Text style={{all: 'unset'}} ref={unsetText}>
              {PROBE}
            </Text>
          </View>
        </Case>
        <Case label="<Text all:'revert'> (rolls back TO the UA boundary)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <Text style={{all: 'revert'}} ref={revertText}>
              {PROBE}
            </Text>
          </View>
        </Case>
        <Case label="<Text all:'inherit'> (opts in, like unset)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <Text style={{all: 'inherit'}} ref={inheritText}>
              {PROBE}
            </Text>
          </View>
        </Case>
        <Case label="controls: default <Text> / fontSize:30 <Text>">
          <Text ref={textControl}>{PROBE}</Text>
          <Text style={{fontSize: 30}} ref={text30Control}>
            {PROBE}
          </Text>
        </Case>
        <Case label="bare run in <View all:'revert'> (no UA declaration → inherits)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <View style={{all: 'revert'}} ref={revertView}>
              {PROBE}
            </View>
          </View>
        </Case>
        <Case label="bare run in <View all:'initial'> (isolated)">
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}}>
            {/* $FlowExpectedError[incompatible-type] the `all` reset is new */}
            <View style={{all: 'initial'}} ref={initialView}>
              {PROBE}
            </View>
          </View>
        </Case>
        <Case label="controls: default bare run / fontSize:30 bare run">
          <View ref={bareControl}>{PROBE}</View>
          {/* $FlowExpectedError[incompatible-type] inheritable keys are new */}
          <View style={{fontSize: 30}} ref={bare30Control}>
            {PROBE}
          </View>
        </Case>
      </View>
    </View>
  );
}

export default {
  title: 'Cascade',
  description:
    "Text inheritance and `all` boundaries: root <Text>'s UA boundary, " +
    "unset/inherit opt-ins, revert's per-element UA-origin resolution. " +
    'Colors are deliberately unset here and the surface is pinned light — ' +
    'see the note on the screen.',
  examples: [
    {
      title: 'Inheritance boundaries',
      render: (): React.Node => <CascadeCases />,
    },
  ],
} as RNTesterModule;
