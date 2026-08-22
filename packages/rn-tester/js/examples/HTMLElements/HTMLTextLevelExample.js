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
 * HTML text-level semantics — §4.5, §4.6 links, §4.7 edits.
 *
 * The demo content lives in `docs/textLevelDocs.js` as a SHARED DOCUMENT (see
 * groupingDocs.js for the rules): the same module renders here through the
 * element catalog and unchanged into the comparison report's web column. This
 * file is the RNTester chrome plus the one thing a document cannot honestly
 * hold — the interactive click counter, which is appended device-side after
 * the anchors section.
 */

import {ATTRIBUTE_GAP, DOC_SECTIONS, INTRO} from './docs/textLevelDocs';
import {SECONDARY_COLOR, TERTIARY_COLOR} from './themed';
import * as React from 'react';
import {useState} from 'react';
import {ScrollView, Text} from 'react-native';

import '@react-native/expo-intrinsics-poc';

function Section({children}) {
  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <Text style={{fontSize: 13, color: SECONDARY_COLOR, marginBottom: 4}}>
        {INTRO}
      </Text>
      <Text style={{fontSize: 12, color: TERTIARY_COLOR, marginBottom: 8}}>
        {ATTRIBUTE_GAP}
      </Text>
      {children}
    </ScrollView>
  );
}

/*
 * Device-only: a live counter proving `onClick` dispatches on an anchor. A
 * counter is state, and state is exactly what the shared documents exclude —
 * the browser column would show a number nothing ever incremented.
 */
function ClickCounter() {
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <div style={{fontSize: 16, marginTop: 8}}>
        <a href="https://example.com" onClick={() => setClicks(n => n + 1)}>
          Tap this link
        </a>
        {' to count a click.'}
      </div>
      <Text
        style={{
          fontSize: 13,
          color: SECONDARY_COLOR,
        }}>{`link clicks: ${clicks}`}</Text>
    </>
  );
}

export default {
  title: 'HTML: text-level semantics',
  category: 'UI',
  description:
    'The elements that mark up a run of text inside a sentence — §4.5 text-level ' +
    'semantics, §4.6 links and §4.7 edits.',
  examples: DOC_SECTIONS.map(([name, title, Component]) => ({
    name,
    title,
    render: () => (
      <Section>
        <Component />
        {name === 'anchors' ? <ClickCounter /> : null}
      </Section>
    ),
  })),
};
