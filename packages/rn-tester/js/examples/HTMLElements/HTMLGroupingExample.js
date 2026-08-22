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
 * HTML sections and grouping content — §4.3 and §4.4.
 *
 * The demo content lives in `docs/groupingDocs.js` as a SHARED DOCUMENT: the
 * same module renders here through the fork's element catalog and, unchanged,
 * through `text-conformance/render-docs.js` into the comparison report's web
 * column. This file is only the RNTester chrome around it — the scroll view
 * and the screen registration. Anything demonstrative belongs in the document,
 * where both engines will render it; anything interactive or platform-aware
 * belongs here, where the comparison will never pretend the browser ran it.
 */

import {DOC_SECTIONS, INTRO} from './docs/groupingDocs';
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
  title: 'HTML: sections & grouping',
  category: 'UI',
  description:
    'Block-level elements — §4.3 sections and §4.4 grouping content: headings, ' +
    'paragraphs, lists, quotes, figures and the sectioning elements.',
  examples: DOC_SECTIONS.map(([name, title, Component]) => ({
    name,
    title,
    render: () => (
      <Section>
        <Component />
      </Section>
    ),
  })),
};
