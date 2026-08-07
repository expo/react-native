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
import demoCss from './css-stylesheets-demo.css';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView} from 'react-native';

/**
 * Real CSS, loaded from a real .css file: the sheet installs once per bundle
 * load, elements carry className, and everything else — selector matching,
 * the cascade, :root variables with a scheme-aware .dark override,
 * @keyframes into the renderer's animation engine, transitions, media
 * queries — is the stylesheet engine (js/astryx/css). Nothing on this
 * screen sets a `style` prop except the ScrollView wrapper.
 */
installStylesheet(demoCss);

function Demo(): React.Node {
  const [on, setOn] = useState(true);
  return (
    <div className="page">
      <div className="card">
        <span className="title">Stylesheet-driven styling</span>
        {'\n'}
        <span className="caption">
          Every style on this screen comes from css-stylesheets-demo.css —
          classes, variables, dark scheme, states, animation.
        </span>
      </div>

      <div className="card">
        <span className="title">Buttons: :active + transitions</span>
        {'\n'}
        <span className="caption">
          Press and hold; the opacity dip is a stylesheet transition.
        </span>
        {'\n'}
        <button className="btn" onClick={() => setOn(v => !v)}>
          Toggle the badge
        </button>
        {'\n'}
        <button className="btn" data-variant="outline">
          Outline variant ([data-variant])
        </button>
      </div>

      <div className="card">
        <span className="title">Attribute state</span>
        {'\n'}
        <span className="badge" data-state={on ? 'on' : 'off'}>
          {on ? 'on' : 'off'}
        </span>
      </div>

      <div className="card">
        <span className="title">@keyframes → renderer animation</span>
        {'\n'}
        <div className="pulse" />
      </div>

      <div className="card">
        <span className="title">Escaped Tailwind-shaped utility</span>
        {'\n'}
        <button className="hover:opacity-75 btn">press: opacity-75</button>
      </div>
    </div>
  );
}

function CSSStylesheetsExample(): React.Node {
  return (
    <ScrollView style={{flex: 1}}>
      <Demo />
    </ScrollView>
  );
}

export default {
  title: 'CSS Stylesheets',
  category: 'UI',
  description:
    'A .css file, parsed and cascaded by the fork: selectors, variables, ' +
    'dark scheme, pseudo-classes, @keyframes, @media.',
  examples: [
    {
      title: 'CSS Stylesheets',
      render(): React.Node {
        return <CSSStylesheetsExample />;
      },
    },
  ],
} as RNTesterModule;
