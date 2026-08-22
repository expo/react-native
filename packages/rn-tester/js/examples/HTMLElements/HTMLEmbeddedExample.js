/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * HTML embedded content — §4.8.
 *
 * `<img>` is the one embedded element implemented, and the interesting thing
 * about it is not that it draws a picture: it is that it is an **inline
 * replaced element**. It sits inside a run of text as a single atomic box,
 * shifting the line's height and baseline the way a letter would, which a
 * block-level `<Image>` cannot do. Most of this screen is about that.
 *
 * The element is backed by `expo-image` when the Expo runtime is present, and
 * falls back to the framework's own image machinery otherwise. Both are reached
 * through the same tag and lay out identically — but only because the box type
 * is declared in the user-agent stylesheet, which is the one place that reaches
 * every backing. Relying on the shadow node's `InlineReplaced` trait is what
 * this screen originally caught: the framework's image shadow node declares it,
 * a plain view shadow node cannot, and an `expo-image`-backed `<img>` was
 * silently laying out as a block.
 *
 * The demo content lives in `docs/embeddedDocs.js` as a SHARED DOCUMENT (see
 * groupingDocs.js for the rules): the same module renders here through the
 * element catalog and unchanged into the comparison report's web column. This
 * file is the RNTester chrome plus the one section a document cannot honestly
 * hold — the load and error events, which need listeners and somewhere to put
 * what they report.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

import {DOC_SECTIONS, INTRO} from './docs/embeddedDocs';
import {Case} from './docs/groupingDocs';
import {CARD_COLOR, SECONDARY_COLOR, SEPARATOR_COLOR} from './themed';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView, Text} from 'react-native';

import '@react-native/expo-intrinsics-poc';

const WIDE = 'https://reactnative.dev/img/logo-og.png';
const BROKEN = 'https://reactnative.dev/img/this-does-not-exist.png';

const REPORT = {fontFamily: 'Menlo', fontSize: 11, marginTop: 6};

function Section({children}) {
  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <Text style={{fontSize: 13, color: SECONDARY_COLOR, lineHeight: 18}}>
        {INTRO}
      </Text>
      {children}
    </ScrollView>
  );
}

/*
 * Device-only: the load lifecycle. Both cases are a list of events that only
 * exists once something has fired, which is precisely what the shared
 * documents exclude — rendered into the web column they would show a report of
 * events no browser had dispatched. The browser side of this route is a real
 * hand-written page instead (text-conformance/img-events.html), with real
 * listeners on a real `<img>`.
 */
function Loading() {
  const [events, setEvents] = useState([]);
  const [errored, setErrored] = useState(false);
  const record = name => () => setEvents(e => [...e, name]);

  return (
    <div>
      <Case
        title="Load events"
        note="loadstart, load and loadend fire as the image is fetched — the same lifecycle the DOM exposes.">
        <img
          src={WIDE}
          style={{width: 200, height: 60}}
          onLoadStart={record('loadstart')}
          onLoad={record('load')}
          onLoadEnd={record('loadend')}
        />
        <div style={{...REPORT, color: '#0a84ff'}}>
          {events.length === 0 ? 'waiting…' : events.join(' → ')}
        </div>
      </Case>

      <Case
        title="A broken image fires error"
        note="What a browser would draw as a broken-image icon. Here the error is reported and it is the app's to handle — which is what most apps want anyway.">
        <img
          src={BROKEN}
          style={{
            width: 120,
            height: 80,
            backgroundColor: CARD_COLOR,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: SEPARATOR_COLOR,
          }}
          onError={() => setErrored(true)}
        />
        <div style={{...REPORT, color: errored ? '#ff3b30' : '#8e8e93'}}>
          {errored ? 'error fired' : 'no error yet'}
        </div>
      </Case>
    </div>
  );
}

/*
 * The document's sections with the device-only one spliced back into the place
 * it has always held. The names are the deep-link routes and the screenshot
 * keys, so they are preserved exactly — including `loading`, which has no
 * section in the document.
 */
const SECTIONS = DOC_SECTIONS.flatMap(section =>
  section[0] === 'sizing'
    ? [section, ['loading', 'Load and error events', Loading]]
    : [section],
);

export default {
  title: 'HTML: embedded content',
  category: 'UI',
  description:
    '§4.8 embedded content — <img> as an inline replaced element: how it flows, ' +
    'how it is sized and fitted, and its load lifecycle.',
  examples: SECTIONS.map(([name, title, Component]) => ({
    name,
    title,
    fullBleed: true,
    render: () => (
      <Section>
        <Component />
      </Section>
    ),
  })),
};
