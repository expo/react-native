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
import {DemoHeader, DemoSection} from './DemoSection';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView} from 'react-native';

/**
 * Real CSS, loaded from a real .css file: the sheet installs once per bundle
 * load, elements carry className, and everything else — selector matching,
 * the cascade, :root variables with a scheme-aware .dark override,
 * @keyframes into the renderer's animation engine, transitions, media
 * queries — is the stylesheet engine (js/astryx/css).
 */
installStylesheet(demoCss);

function Cards(): React.Node {
  return (
    <div>
      <div className="card">
        <span className="title">Descendant selectors</span>
        {'\n'}
        <span className="caption">
          `.card .title` and `.card .caption` match through the element tree;
          neither element names a font itself.
        </span>
      </div>
    </div>
  );
}

function Buttons({onPress}: {onPress: () => void}): React.Node {
  return (
    <div className="row">
      <button className="btn" onClick={onPress}>
        Press me
      </button>
      <button className="btn" data-variant="outline">
        Outline
      </button>
      <button className="btn active:opacity-75">Escaped utility</button>
    </div>
  );
}

function CSSStylesheetsExample(): React.Node {
  const [on, setOn] = useState(true);
  return (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <DemoHeader title="CSS Stylesheets">
        Every style below comes from css-stylesheets-demo.css, parsed and
        cascaded by the fork. Nothing on this screen sets a `style` prop.
      </DemoHeader>

      <DemoSection
        title="Variables, inheritance, descendant selectors"
        description="A :root block holds the tokens; a .dark block overrides them and flips with the OS appearance."
        code={`/* css-stylesheets-demo.css */
:root {
  --cs-surface-raised: rgb(242, 244, 247);
  --cs-ink: rgb(16, 24, 40);
  --cs-radius: 10px;
}
.dark { --cs-surface-raised: rgb(30, 34, 45); --cs-ink: rgb(242, 242, 247); }

.card { padding: 14px 16px; border-radius: var(--cs-radius);
        background-color: var(--cs-surface-raised); }
.card .title { font-weight: 700; color: var(--cs-ink); }

<div className="card">
  <span className="title">Descendant selectors</span>
</div>`}>
        <Cards />
      </DemoSection>

      <DemoSection
        title="Pseudo-classes, attributes, transitions"
        description="Press and hold: :active is tracked automatically because a matched rule gates on it. [data-variant] restyles without touching the class list."
        code={`.btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--cs-touch);   /* 44px — the iOS HIG minimum */
  padding: 0 18px;
  transition: opacity 150ms ease, background-color 150ms ease;
}
.btn:active { opacity: 0.7; }
.btn[data-variant='outline'] {
  background-color: var(--cs-surface);
  border: 1px solid var(--cs-accent);   /* shorthand → RN longhands */
  color: var(--cs-accent);
}
/* A Tailwind build emits escaped class names; they parse as authored: */
.active\\:opacity-75:active { opacity: 0.75; }

<button className="btn" data-variant="outline">Outline</button>`}>
        <Buttons onPress={() => setOn(v => !v)} />
      </DemoSection>

      <DemoSection
        title="Attribute state, driven from React"
        description="The badge's colour is chosen by [data-state]; React only flips the attribute."
        code={`.badge[data-state='on']  { background-color: rgb(18, 183, 106); }
.badge[data-state='off'] { background-color: rgb(152, 152, 159); }

<span className="badge" data-state={on ? 'on' : 'off'}>
  {on ? 'on' : 'off'}
</span>`}>
        <div className="row">
          <span className="badge" data-state={on ? 'on' : 'off'}>
            {on ? 'on' : 'off'}
          </span>
          <span className="caption">
            Toggled by the “Press me” button above.
          </span>
        </div>
      </DemoSection>

      <DemoSection
        title="@keyframes → the renderer's animation engine"
        description="Parsed out of the sheet and handed to the same native engine that runs CSS animations, off the JavaScript thread."
        code={`@keyframes demo-pulse {
  from { opacity: 1 }
  50%  { opacity: 0.35 }
  to   { opacity: 1 }
}
.pulse {
  width: 16px; height: 16px; border-radius: 8px;
  animation: demo-pulse 1.6s ease-in-out infinite;
}`}>
        <div className="row">
          <div className="pulse" />
          <span className="caption">Animating natively, right now.</span>
        </div>
      </DemoSection>

      <DemoSection
        title="@media"
        description="Evaluated against the window: this swatch widens at ≥700px, so it changes on rotation or on a tablet."
        code={`.swatch { width: 56px; height: 32px; }

@media (min-width: 700px) {
  .swatch { width: 120px; }
}`}>
        <div className="swatch" />
      </DemoSection>
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
