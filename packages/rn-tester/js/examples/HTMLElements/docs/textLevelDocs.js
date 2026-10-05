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
 * The text-level semantics demo as a SHARED DOCUMENT — see groupingDocs.js
 * for the rules: intrinsic tags only, CSS-spelled styles, literal colours,
 * nothing stateful. The one interactive case (the anchor click counter) lives
 * in the RNTester screen, appended after the document's static anchors case,
 * because a counter is exactly what a browser column cannot honestly show.
 */

import {Case, DOC_COLORS} from './groupingDocs';
import * as React from 'react';

const PROSE = {fontSize: 16, lineHeight: 24, color: '#1c1c1e'};

/* The grouping Case frames content in a card; prose cases read better bare,
 * so this wraps the shared Case with the prose defaults on a plain div. */
function ProseCase({title, note, children}) {
  return (
    <Case title={title} note={note}>
      <div style={PROSE}>{children}</div>
    </Case>
  );
}

function Emphasis() {
  return (
    <div>
      <ProseCase
        title="<em> and <strong> — stress and importance"
        note="Nested importance is meaningful in HTML: <strong> inside <strong> is stronger still.">
        Some <em>emphasised</em> words and some <strong>important</strong> ones,
        with{' '}
        <strong>
          importance <strong>nested inside importance</strong>
        </strong>
        , all flowing in one paragraph so the wrapping is visible when the line
        runs past the edge of the screen.
      </ProseCase>

      <ProseCase
        title="<i> and <b> — a different voice, and drawn attention"
        note="Not synonyms for italic and bold: <i> is alternate voice or mood, <b> is attention without extra importance.">
        The word <i>Bildungsroman</i> is in another language, the ship was
        called <i>Endurance</i>, and the key term here is <b>keyword</b> —
        visually bold, but carrying no more importance than the rest of the
        sentence.
      </ProseCase>

      <ProseCase
        title="<mark> — relevance in another context"
        note="What a search result highlights. It says 'relevant to why you are looking', not 'important'.">
        Searching for <mark>inline</mark> found this passage, where{' '}
        <mark>inline</mark> appears twice.
      </ProseCase>

      <ProseCase title="<small> — side comments and small print">
        Buy one, get one free <small>(while stocks last; terms apply)</small>.
      </ProseCase>
    </div>
  );
}

function Technical() {
  return (
    <div>
      <ProseCase
        title="<code>, <var>, <samp>, <kbd> — computer text"
        note="Four different things: source, a variable, output, and user input.">
        Call <code>useState()</code> and store it in <var>count</var>; the
        program prints <samp>ready</samp>. Press <kbd>Esc</kbd> to cancel, or{' '}
        <kbd>
          <kbd>Ctrl</kbd> + <kbd>C</kbd>
        </kbd>{' '}
        to copy — a nested {'<kbd>'} is how the spec writes a chord.
      </ProseCase>

      <ProseCase title="<sub> and <sup> — subscript and superscript">
        Water is H<sub>2</sub>O, the second power is x<sup>2</sup>, and the
        footnote marker looks like this<sup>1</sup>. Baselines shift without
        changing the line height around them.
      </ProseCase>
    </div>
  );
}

function Annotations() {
  return (
    <div>
      <ProseCase
        title="<abbr title> — an abbreviation with its expansion"
        note="Not built yet: the title attribute is dropped before it reaches the native side, so nothing announces it. The element itself is real; the annotation is not carried.">
        The <abbr title="HyperText Markup Language">HTML</abbr> spec and the{' '}
        <abbr title="World Wide Web Consortium">W3C</abbr> disagree less often
        than people think.
      </ProseCase>

      <ProseCase
        title="<dfn> — the defining instance of a term"
        note="Marks where a term is defined, not every place it is used.">
        An <dfn>inline formatting context</dfn> is the box that lays out a run
        of text; every element on this screen lives inside one.
      </ProseCase>

      <ProseCase
        title="<cite> — the title of a work"
        note="A work, not a person: the spec is explicit that a citation is not the author.">
        As <cite>The Design of Everyday Things</cite> puts it, affordances are
        about perceived possibility.
      </ProseCase>

      <ProseCase
        title="<q cite> — an inline quotation"
        note="The marks are generated, as a browser generates them from the UA sheet — and they alternate by nesting depth, which is what CSS's quotes property means and why a quote inside a quote takes singles. There is no CSS content here, so they are produced as real text children; the cite attribute is still dropped.">
        She replied{' '}
        <q cite="https://example.com/interview">the boxes are the point</q> and
        went back to work. Nested:{' '}
        <q>
          she added <q>and the lines too</q> before leaving
        </q>
        .
      </ProseCase>

      <ProseCase
        title="<time datetime> and <data value> — machine-readable values"
        note="Not built yet: the text renders, but datetime and value are dropped, so the machine-readable half of both elements is currently missing.">
        Published <time datetime="2026-08-21">yesterday</time>, priced at{' '}
        <data value="1499">£14.99</data>.
      </ProseCase>

      <ProseCase title="<output> — the result of a calculation">
        Two plus two is <output>4</output>.
      </ProseCase>
    </div>
  );
}

function Edits() {
  return (
    <div>
      <ProseCase
        title="<del> and <ins> — §4.7 edits"
        note="The line-through and underline are real UA styling. Not built yet: datetime and cite are dropped, so the record of when and why is not carried.">
        The meeting is at{' '}
        <del datetime="2026-08-20T09:00" cite="https://example.com/changelog">
          nine
        </del>{' '}
        <ins datetime="2026-08-20T09:05" cite="https://example.com/changelog">
          ten
        </ins>{' '}
        o'clock.
      </ProseCase>

      <ProseCase
        title="<s> — no longer accurate"
        note="Different from <del>: <s> is content that has stopped being correct, not an edit to the document.">
        <s>Sold out</s> Back in stock.
      </ProseCase>

      <ProseCase title="<u> — a non-textual annotation">
        A deliberately <u>misspeled</u> word, marked the way a spell-checker
        would.
      </ProseCase>
    </div>
  );
}

function Anchors() {
  return (
    <ProseCase
      title="<a href> — §4.6 links"
      note="Only an anchor with an href is a link: it takes the link style, becomes focusable for assistive technology, and highlights while pressed.">
      Read <a href="https://example.com">the documentation</a> first, or{' '}
      <a>this placeholder anchor</a> which has no href and so is none of those
      things.
    </ProseCase>
  );
}

function SpansAndBreaks() {
  return (
    <div>
      <ProseCase
        title="<span> — no meaning, just a hook for styling"
        note="The element to reach for when nothing more specific applies.">
        A sentence with <span style={{color: '#af52de'}}>a coloured run</span>,{' '}
        <span style={{backgroundColor: '#ffd60a'}}>a highlighted run</span>, and{' '}
        <span style={{fontVariant: ['small-caps']}}>small caps</span> in it.
      </ProseCase>

      <ProseCase title="<br> — a line break that is part of the content">
        The Lion, the Witch
        <br />
        and the Wardrobe
        <br />— three lines, one paragraph.
      </ProseCase>
    </div>
  );
}

function StyledInlines() {
  return (
    <div>
      <ProseCase
        title="Text-level elements are styleable"
        note="They are real elements, not text effects: styling one restyles the run, and it still flows.">
        Ordinary text, then{' '}
        <em style={{color: '#ff3b30', fontStyle: 'normal', fontWeight: '700'}}>
          an em restyled to be red and bold instead of italic
        </em>
        , then{' '}
        <code
          style={{
            backgroundColor: DOC_COLORS.separator,
            borderRadius: 4,
            paddingInline: 4,
          }}>
          code with a background
        </code>
        , then more text that keeps flowing around them and wraps at the edge.
      </ProseCase>

      <ProseCase
        title="Inheritance"
        note="A text-level element inherits from its container and can override any part.">
        <div style={{fontSize: 18, color: '#0a84ff'}}>
          This paragraph sets a size and colour, and{' '}
          <strong>the strong run inherits both</strong> while adding weight, but{' '}
          <span style={{fontSize: 12}}>this span overrides the size</span>.
        </div>
      </ProseCase>
    </div>
  );
}

export const INTRO =
  'Every case shows the element mid-paragraph, because that is the only place ' +
  'its behaviour is visible: these elements are runs of text, not boxes, and ' +
  'they flow and wrap with the sentence around them.';

export const ATTRIBUTE_GAP =
  'One caveat throughout: the inline elements accept only a handful of native ' +
  'attributes, so title, datetime, cite and value are dropped before they reach ' +
  'the native side. What renders is real; the machine-readable annotations are ' +
  'not carried yet. Each affected case says so.';

export const DOC_SECTIONS = [
  ['emphasis', 'Emphasis and importance', Emphasis],
  ['technical', 'Computer text, sub and sup', Technical],
  ['annotations', 'Annotations and citations', Annotations],
  ['edits', 'Edits and corrections', Edits],
  ['anchors', 'Links', Anchors],
  ['spans', 'Spans and breaks', SpansAndBreaks],
  ['styling', 'Styling and inheritance', StyledInlines],
];
