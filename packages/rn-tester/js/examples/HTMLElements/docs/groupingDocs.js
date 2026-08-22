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
 * The sections-and-grouping demo as a SHARED DOCUMENT: one module, imported
 * unchanged by the RNTester screen and by the web renderer
 * (text-conformance/render-docs.js). The comparison's whole purpose is to see
 * how the SAME elements and styles behave in each engine, so the document may
 * use only what means the same thing in both:
 *
 *  - lowercase intrinsic tags (the fork's catalog on device, real HTML on
 *    web) — never `View`/`Text`;
 *  - CSS-spelled style keys from the RN/CSS intersection, with numbers as
 *    px; `border-style` stated EXPLICITLY wherever a border is drawn (CSS's
 *    initial border-style is `none`, RN's an implied `solid` — stating it is
 *    what keeps one stylesheet honest in both engines);
 *  - literal colours (the light palette; PlatformColor cannot cross);
 *  - no state, no handlers, no platform branches.
 */

import * as React from 'react';

export const DOC_COLORS = {
  card: '#ffffff',
  secondary: '#6d6d72',
  tertiary: '#8e8e93',
  separator: '#d1d1d6',
};

const LABEL = {
  fontSize: 12,
  color: DOC_COLORS.secondary,
  marginTop: 18,
  marginBottom: 2,
};
const NOTE = {fontSize: 11, color: DOC_COLORS.tertiary, marginBottom: 6};
/*
 * The case frame is a BLOCK `<div>`, and that is a load-bearing choice: the
 * old screens framed cases in a `View`, which is a FLEX container, and flex
 * items' margins never collapse — so the collapsing this screen exists to
 * demonstrate silently did not happen on device while the caption claimed it
 * did. A `<div>` is a block formatting context in every engine here.
 */
const FRAME = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: DOC_COLORS.separator,
  borderRadius: 6,
  padding: 10,
  backgroundColor: DOC_COLORS.card,
};

export function Case({title, note, children}) {
  return (
    <section>
      <p style={LABEL}>{title}</p>
      {note != null ? <p style={NOTE}>{note}</p> : null}
      <div style={FRAME}>{children}</div>
    </section>
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
      <article
        style={{
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: '#0a84ff',
          padding: 8,
        }}>
        <header>
          <h3>An article</h3>
          <p style={{color: DOC_COLORS.secondary}}>with a header of its own</p>
        </header>
        <section
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#34c759',
            padding: 8,
          }}>
          <h4>A section inside it</h4>
          <p>Sections group related content within the article.</p>
        </section>
        <aside
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#ff9500',
            padding: 8,
          }}>
          An aside — tangentially related content.
        </aside>
        <footer style={{color: DOC_COLORS.secondary}}>
          The article's footer.
        </footer>
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

/*
 * The `white-space` values a two-value model cannot express.
 *
 * `<pre>` is `white-space: pre`, so the property belongs beside it — and the
 * three below are the ones that separate a real implementation from a boolean:
 * each keeps a different pair of (collapse spaces, keep newlines, wrap).
 * Written with the same string every time, so the only thing varying is the
 * property.
 */
const WHITE_SPACE_SAMPLE =
  'two  spaces and a newline\nfollow this, then a deliberately long run of ' +
  'words to show whether the line wraps.';

const WHITE_SPACE_CASES = [
  // Collapses the spaces and the newline, yet still refuses to wrap — so this
  // is one long line running off the edge.
  {value: 'nowrap', why: 'one line, overflowing'},
  // Keeps the newline but collapses the run of spaces, and wraps.
  {value: 'pre-line', why: 'break kept, spaces collapsed'},
  // Keeps everything and still wraps — `pre` without the overflow.
  {value: 'pre-wrap', why: 'all kept, still wraps'},
];

function Preformatted() {
  return (
    <div>
      <Case
        title="<pre> — preserved whitespace"
        note="The one place in HTML where spaces and newlines in the source are kept exactly.">
        <pre>{`function greet(name) {
  return \`Hello, \${name}\`; // a deliberately long trailing comment that overflows the container
}`}</pre>
      </Case>

      {WHITE_SPACE_CASES.map(({value, why}) => (
        <Case
          key={value}
          title={`white-space: ${value}`}
          note={why}>
          {/* $FlowExpectedError[not-a-component] intrinsic <div> tag */}
          <div style={{whiteSpace: value}}>{WHITE_SPACE_SAMPLE}</div>
        </Case>
      ))}
    </div>
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
        <div
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
        style={{
          backgroundColor: DOC_COLORS.separator,
          padding: 8,
          borderRadius: 4,
        }}>
        A div with a background.
      </div>
      <div
        style={{
          backgroundColor: DOC_COLORS.separator,
          padding: 8,
          borderRadius: 4,
        }}>
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

export const INTRO =
  'Block-level elements: each generates a box and stacks vertically. The ' +
  'spacing between them comes from the user-agent stylesheet and from margin ' +
  'collapsing, not from gaps set here — which is why the rhythm holds ' +
  'without anyone choosing a number.';

export const DOC_SECTIONS = [
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
