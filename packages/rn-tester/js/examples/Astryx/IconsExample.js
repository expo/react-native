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

// Astryx's real icon set, vendored UNMODIFIED — the same `<svg><path/></svg>`
// JSX the library ships, rendering through our SVG intrinsics.
// $FlowFixMe[cannot-resolve-module] vendored TypeScript (Metro transforms it)
import {defaultIcons} from '../../astryx/vendor/Icon/defaultIcons';
import {DemoContent} from '../TextChildren/TextChildrenShared';
import * as React from 'react';
import {View} from 'react-native';

// Registers the intrinsics (<div>, <svg>, <path>, …).
import '../../astryx/dom';

const ICON_NAMES: Array<string> = Object.keys(defaultIcons);

function IconGrid({size, color}: {size: number, color: string}): React.Node {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 14,
        alignItems: 'center',
      }}>
      {ICON_NAMES.map(name => (
        <View key={name} style={{width: size, height: size}}>
          {/* The icons are authored at `1em` and `currentColor`, so size and
              colour come from the surrounding context rather than the icon.
              `fontSize` supplies the em and `color` the currentColor. */}
          {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
          <svg
            {...(defaultIcons[name] as $FlowFixMe).props}
            fontSize={size}
            color={color}
          />
        </View>
      ))}
    </View>
  );
}

export default {
  title: 'Astryx icons',
  category: 'UI',
  description:
    "Astryx's own icon set rendering through the <svg>/<path>/<circle>/" +
    '<rect> intrinsics — the vendored source, unmodified.',
  examples: [
    {
      name: 'icons',
      title: 'The real Astryx icon set',
      description:
        'Every icon in Astryx’s default registry, drawn from the library’s ' +
        'own path data. They exercise the whole subset: relative commands, ' +
        'arcs, cubics, circles, rounded rects and the even-odd fill rule.',
      render: (): React.Node => (
        <DemoContent
          code={
            "import {defaultIcons} from '@astryxdesign/core'; // vendored\n" +
            '\n' +
            '// Each entry is plain SVG JSX, e.g. the close icon:\n' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"\n' +
            '     strokeWidth={1.5} width="1em" height="1em">\n' +
            '  <path d="M6 6l12 12M6 18L18 6" />\n' +
            '</svg>'
          }>
          <IconGrid size={28} color="#1c1e21" />
        </DemoContent>
      ),
    },
    {
      name: 'currentColor',
      title: 'currentColor and 1em, as authored',
      description:
        'The icons state no size and no colour of their own: they are 1em ' +
        'wide and painted with currentColor. Changing only the surrounding ' +
        'font size and colour rescales and recolours every one of them.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<svg … fontSize={16} color="#c0392b" />\n' +
            '<svg … fontSize={24} color="#2980b9" />\n' +
            '<svg … fontSize={40} color="#27ae60" />'
          }>
          <View style={{gap: 16}}>
            <IconGrid size={16} color="#c0392b" />
            <IconGrid size={24} color="#2980b9" />
            <IconGrid size={40} color="#27ae60" />
          </View>
        </DemoContent>
      ),
    },
    {
      name: 'shapes',
      title: 'The subset, one shape at a time',
      description:
        'What the intrinsics cover, in isolation: a stroked path, a filled ' +
        'path, a circle, a rounded rect and a line. Everything is reduced to ' +
        'a path in JavaScript and drawn by one native view.',
      render: (): React.Node => (
        <DemoContent
          code={
            '<svg viewBox="0 0 24 24" width={48} height={48}>\n' +
            '  <circle cx={12} cy={12} r={9} fill="#39c" />\n' +
            '  <rect x={6} y={6} width={12} height={12} rx={3} />\n' +
            '  <path d="M5 13l4 4L19 7" stroke="#fff" />\n' +
            '</svg>'
          }>
          <View style={{flexDirection: 'row', gap: 16, alignItems: 'center'}}>
            {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
            <svg viewBox="0 0 24 24" width={48} height={48}>
              {/* $FlowFixMe[not-a-component] intrinsic <path> tag */}
              <path
                d="M5 13l4 4L19 7"
                stroke="#c0392b"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
            <svg viewBox="0 0 24 24" width={48} height={48}>
              {/* $FlowFixMe[not-a-component] intrinsic <circle> tag */}
              <circle cx={12} cy={12} r={9} fill="#2980b9" />
            </svg>
            {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
            <svg viewBox="0 0 24 24" width={48} height={48}>
              {/* $FlowFixMe[not-a-component] intrinsic <rect> tag */}
              <rect x={4} y={4} width={16} height={16} rx={5} fill="#27ae60" />
            </svg>
            {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
            <svg viewBox="0 0 24 24" width={48} height={48}>
              {/* $FlowFixMe[not-a-component] intrinsic <line> tag */}
              <line
                x1={3}
                y1={21}
                x2={21}
                y2={3}
                stroke="#8e44ad"
                strokeWidth={3}
                strokeLinecap="round"
              />
            </svg>
            {/* The even-odd rule: a ring, not a disc. */}
            {/* $FlowFixMe[not-a-component] intrinsic <svg> tag */}
            <svg viewBox="0 0 24 24" width={48} height={48}>
              {/* $FlowFixMe[not-a-component] intrinsic <path> tag */}
              <path
                d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a5 5 0 110 10 5 5 0 010-10z"
                fill="#e67e22"
                fillRule="evenodd"
              />
            </svg>
          </View>
        </DemoContent>
      ),
    },
  ],
} as RNTesterModule;
