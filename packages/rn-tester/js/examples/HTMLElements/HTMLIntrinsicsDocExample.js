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
 * The static half of the intrinsic-elements demo, as a document a browser can
 * be given too.
 *
 * The content lives in `docs/intrinsicsDocs.js` as a SHARED DOCUMENT: the same
 * module renders here through the fork's element catalog and, unchanged,
 * through `text-conformance/render-docs.js` into the comparison report's web
 * column. This file is only the RNTester chrome around it.
 *
 * `examples/TextChildren/IntrinsicElementsExample.js` keeps the rest of the
 * screen — the measured-rect cases, the external-module intrinsic, and the
 * click and event.target demos — and keeps them unchanged, because other
 * tooling reads the rects those cases publish.
 */

import {DOC_SECTIONS, INTRO} from './docs/intrinsicsDocs';
import {SECONDARY_COLOR} from './themed';
import * as React from 'react';
import {ScrollView, Text} from 'react-native';

import '@react-native/expo-intrinsics-poc';

function Section({children}) {
  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <Text style={{fontSize: 13, color: SECONDARY_COLOR}}>{INTRO}</Text>
      {children}
    </ScrollView>
  );
}

export default {
  title: 'HTML: intrinsics document',
  category: 'UI',
  description:
    'The static intrinsics cases — inline highlights, box decorations and ' +
    'inline flow inside a <div> — rendered from the document the browser ' +
    'column is rendered from.',
  examples: DOC_SECTIONS.map(([name, title, Component]) => ({
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
