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
 * These are the block-level elements: each generates a box, stacks vertically,
 * and takes its margins from the user-agent stylesheet. The thing worth showing
 * is the part that is invisible until it goes wrong — the *spacing between
 * them*, which comes from margin collapsing rather than from adding gaps, and
 * which is why a heading followed by a paragraph looks right without anyone
 * setting a single value.
 *
 * `@noflow`: the intrinsics have no JSX types, and a `$FlowFixMe` per element
 * would bury the markup this file exists to demonstrate.
 */

import {
  CARD_COLOR,
  SECONDARY_COLOR,
  SEPARATOR_COLOR,
  TERTIARY_COLOR,
} from './themed';
import * as React from 'react';
import {ScrollView, Text, View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

const LABEL = {
  fontSize: 12,
  color: SECONDARY_COLOR,
  marginTop: 18,
  marginBottom: 2,
};
const NOTE = {fontSize: 11, color: TERTIARY_COLOR, marginBottom: 6};
const FRAME = {
  borderWidth: 1,
  borderColor: SEPARATOR_COLOR,
  borderRadius: 6,
  padding: 10,
  // The card a case sits on. This was a literal white, which in dark mode put
  // white-on-white text inside every frame — the elements render, but nothing
  // is legible, so the screen reads as an engine failure rather than a demo
  // background that never learned about dark mode.
  backgroundColor: CARD_COLOR,
};

function Case({title, note, children}) {
  return (
    <View>
      <Text style={LABEL}>{title}</Text>
      {note != null ? <Text style={NOTE}>{note}</Text> : null}
      <View style={FRAME}>{children}</View>
    </View>
  );
}

function Headings() {
  return (
    <Case
      title="<h1>–<h6> and <hgroup> — §4.3 headings"
      note="Each level has its own size and margins from the user-agent sheet; the gap between a heading and the text under it is one collapsed margin, not two.">
      <h1>Heading level 1</h1>
      <p>A paragraph after the first-level heading.</p>
      <h2>Heading level 2</h2>
      <p>A paragraph after the second-level heading.</p>
      <h3>Heading level 3</h3>
      <h4>Heading level 4</h4>
      <h5>Heading level 5</h5>
      <h6>Heading level 6</h6>
      <hgroup>
        <h2>A title</h2>
        <p>and its subheading, grouped so they read as one heading</p>
      </hgroup>
    </Case>
  );
}

function Sections() {
  return (
    <Case
      title="<section>, <article>, <nav>, <aside>, <header>, <footer>, <main>, <address>, <search>"
      note="These carry meaning rather than appearance — none of them change how a box looks, which is the point. Borders are added here only so the nesting is visible.">
      <article style={{borderWidth: 1, borderColor: '#0a84ff', padding: 8}}>
        <header>
          <h3>An article</h3>
          <p style={{color: SECONDARY_COLOR}}>with a header of its own</p>
        </header>
        <section style={{borderWidth: 1, borderColor: '#34c759', padding: 8}}>
          <h4>A section inside it</h4>
          <p>Sections group related content within the article.</p>
        </section>
        <aside style={{borderWidth: 1, borderColor: '#ff9500', padding: 8}}>
          An aside — tangentially related content.
        </aside>
        <footer style={{color: SECONDARY_COLOR}}>The article's footer.</footer>
      </article>

      <nav style={{marginTop: 8}}>
        <a href="https://example.com/one">First</a>
        {'   '}
        <a href="https://example.com/two">Second</a>
        {'   '}
        <a href="https://example.com/three">Third</a>
      </nav>

      <address style={{marginTop: 8}}>
        Contact <a href="https://example.com/author">the author</a>.
      </address>
    </Case>
  );
}

function Paragraphs() {
  return (
    <Case
      title="<p> and <hr> — §4.4 paragraphs and thematic breaks"
      note="Adjacent paragraph margins collapse: the gap between these two is one margin, not the sum of both.">
      <p>
        The first paragraph, long enough to wrap onto a second line so that the
        line spacing inside it can be compared with the gap between it and the
        next one.
      </p>
      <p>
        The second paragraph. The space above it is a single collapsed margin —
        which is why the rhythm looks right without anyone choosing a number.
      </p>
      <hr />
      <p>A third paragraph, after a thematic break.</p>
    </Case>
  );
}

function Preformatted() {
  return (
    <Case
      title="<pre> — preserved whitespace"
      note="The one place in HTML where spaces and newlines in the source are kept exactly.">
      <pre>{`function greet(name) {
  return \`Hello, \${name}\`; // a deliberately long trailing comment that overflows the container
}`}</pre>
    </Case>
  );
}

function Quotes() {
  return (
    <Case
      title="<blockquote cite> — a block quotation"
      note="Indented by the user-agent sheet, and takes a cite URL for where the quotation came from.">
      <blockquote cite="https://example.com/source">
        <p>
          A long quotation is a block, not a run of text: it gets its own box
          and its own indentation.
        </p>
        <footer>
          — <cite>Someone worth quoting</cite>
        </footer>
      </blockquote>
    </Case>
  );
}

function Lists() {
  return (
    <Case
      title="<ul>, <ol>, <li>, <menu> — lists and their markers"
      note="Markers are generated by the list container, so list-style-type and start are honoured rather than typed into the content.">
      <ul>
        <li>An unordered item</li>
        <li>
          Another, long enough to wrap so the second line lines up under the
          first rather than under the bullet
        </li>
        <li>
          A nested list:
          <ul>
            <li>inner one</li>
            <li>inner two</li>
          </ul>
        </li>
      </ul>

      <ol>
        <li>First</li>
        <li>Second</li>
        <li>Third</li>
      </ol>

      <ol start={98}>
        <li>Starts at ninety-eight</li>
        <li>Ninety-nine</li>
        <li>One hundred</li>
      </ol>

      <ul style={{listStyleType: 'square'}}>
        <li>A square marker</li>
        <li>from list-style-type</li>
      </ul>

      <ol style={{listStyleType: 'lower-roman'}}>
        <li>Roman</li>
        <li>numerals</li>
        <li>as markers</li>
      </ol>

      <menu>
        <li>A menu is a list of commands</li>
        <li>and lays out like an unordered one</li>
      </menu>
    </Case>
  );
}

function DescriptionLists() {
  return (
    <Case
      title="<dl>, <dt>, <dd> — description lists"
      note="Terms and their descriptions; a term may have several descriptions and vice versa.">
      <dl>
        <dt>Inline formatting context</dt>
        <dd>The box that lays out a run of text.</dd>
        <dt>Block formatting context</dt>
        <dd>A box whose children stack vertically.</dd>
        <dd>Also where margin collapsing is contained.</dd>
      </dl>
    </Case>
  );
}

function Figures() {
  return (
    <Case
      title="<figure> and <figcaption> — self-contained content with a caption"
      note="The caption belongs to the figure, and the figure can be moved without losing it.">
      <figure>
        <View
          style={{
            height: 60,
            backgroundColor: '#0a84ff',
            borderRadius: 6,
          }}
        />
        <figcaption>
          Figure 1. A box standing in for an illustration.
        </figcaption>
      </figure>
    </Case>
  );
}

function Divisions() {
  return (
    <Case
      title="<div> — a box with no meaning of its own"
      note="The element to reach for when nothing more specific applies — and the one that shows plain block stacking.">
      <div
        style={{backgroundColor: SEPARATOR_COLOR, padding: 8, borderRadius: 4}}>
        A div with a background.
      </div>
      <div
        style={{backgroundColor: SEPARATOR_COLOR, padding: 8, borderRadius: 4}}>
        Another one, stacked beneath it.
      </div>
      <div
        style={{display: 'flex', flexDirection: 'row', gap: 8, marginTop: 8}}>
        <div
          style={{
            flex: 1,
            backgroundColor: '#34c759',
            padding: 8,
            borderRadius: 4,
          }}>
          display: flex
        </div>
        <div
          style={{
            flex: 1,
            backgroundColor: '#30b0c7',
            padding: 8,
            borderRadius: 4,
          }}>
          on the container
        </div>
      </div>
    </Case>
  );
}

const INTRO =
  'Block-level elements: each generates a box and stacks vertically. The ' +
  'spacing between them comes from the user-agent stylesheet and from margin ' +
  'collapsing, not from gaps set here \u2014 which is why the rhythm holds ' +
  'without anyone choosing a number.';

function Section({children}) {
  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <Text style={{fontSize: 13, color: SECONDARY_COLOR}}>{INTRO}</Text>
      {children}
    </ScrollView>
  );
}

const SECTIONS = [
  ['headings', 'Headings and hgroup', Headings],
  ['sections', 'Sectioning elements', Sections],
  ['paragraphs', 'Paragraphs and thematic breaks', Paragraphs],
  ['pre', 'Preformatted text', Preformatted],
  ['quotes', 'Block quotations', Quotes],
  ['lists', 'Lists and markers', Lists],
  ['descriptions', 'Description lists', DescriptionLists],
  ['figures', 'Figures and captions', Figures],
  ['divisions', 'Divisions', Divisions],
];

export default {
  title: 'HTML: sections & grouping',
  category: 'UI',
  description:
    'Block-level elements \u2014 \u00a74.3 sections and \u00a74.4 grouping content: headings, ' +
    'paragraphs, lists, quotes, figures and the sectioning elements.',
  examples: SECTIONS.map(([name, title, Component]) => ({
    name,
    title,
    render: () => (
      <Section>
        <Component />
      </Section>
    ),
  })),
};
