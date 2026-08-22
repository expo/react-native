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
 * The intrinsic-elements demo as a SHARED DOCUMENT — see groupingDocs.js for
 * the rules: intrinsic tags only, CSS-spelled styles, literal colours, nothing
 * stateful.
 *
 * Only the STATIC half of the intrinsics screen crosses over. The cases that
 * publish measured rects, the external-module `<native-switch>` and the click
 * and event.target demos stay in
 * `examples/TextChildren/IntrinsicElementsExample.js`, where they belong:
 * their subject is behaviour or measurement, and a browser column rendered
 * from the same markup would show neither.
 *
 * The point of moving these particular cases is the highlight extent. How far
 * a background or a border reaches around an inline box — and how much room
 * the box then takes in the line — is a question with one right answer, and
 * until now the two devices could only be compared with each other. Here the
 * same markup goes through a real browser too, so "iOS and Android disagree"
 * becomes "one of them disagrees with the web".
 */

import {Case, DOC_COLORS} from './groupingDocs';
import * as React from 'react';

/* The root font size differs between the engines (16px web, 17pt iOS, 16sp
 * Android), and every extent measured here is a multiple of it. Stating the
 * size makes the runs the same length in all three, so a difference in the
 * highlight is a difference in the box model and not in the type. */
const PROSE = {fontSize: 16, lineHeight: 24, color: '#1c1c1e'};

function ProseCase({title, note, children}) {
  return (
    <Case title={title} note={note}>
      <div style={PROSE}>{children}</div>
    </Case>
  );
}

/*
 * The rows are a FIXED width on purpose. A shrink-to-fit row would grow with
 * the padding, so every row would be a different shape and nothing could be
 * lined up. Pinned, the three rows share their text, their text attributes and
 * their container width — everything a content-keyed text cache would key on
 * except the inline box itself — so the padding has to push `after` visibly to
 * the right, and three identical-looking rows are a false cache hit.
 */
const ROW_WIDTH = 260;
const HIGHLIGHT = '#ffe9a8';

function SpanHighlights() {
  return (
    <ProseCase
      title="<span> with a background — how far the highlight reaches"
      note="Three rows differing only in the span's inline padding: 0, 12 and 24. The painted highlight must grow by exactly twice the padding, start where 'before' ends, and push 'after' the same distance right. Nothing else on the row changes.">
      {[0, 12, 24].map(pad => (
        <div key={pad} style={{width: ROW_WIDTH, marginTop: 4}}>
          before
          <span style={{backgroundColor: HIGHLIGHT, paddingInline: pad}}>
            SPAN
          </span>
          after
        </div>
      ))}
    </ProseCase>
  );
}

/*
 * `border-style` and `outline-style` are both stated. CSS's initial value for
 * each is `none`, so a width alone draws nothing in a browser while React
 * Native implies `solid` — leave them out and the web column is honestly
 * blank while the devices show a box, which reads as a device bug that is not
 * there.
 */
const DECORATED = {
  paddingInline: 6,
  paddingBlock: 2,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#00aa77',
  outlineWidth: 1,
  outlineStyle: 'solid',
  outlineColor: '#ff9900',
  outlineOffset: 2,
};

function InlineBoxDecorations() {
  return (
    <div>
      <ProseCase
        title="An inline box carries the CSS box model"
        note="Inline-axis padding and border add to the advance; block-axis padding paints without changing the line height around it. The outline is drawn outside the border box and offset from it, and takes no space at all.">
        before <span style={DECORATED}>decorated inline</span> after.
      </ProseCase>

      <ProseCase
        title="A wrapped inline box is sliced — CSS2 §8.6"
        note="When the box breaks across lines it draws one fragment per line, and only the first fragment gets the leading edge and only the last the trailing one. The fragments in between are open at both ends.">
        wrapped:{' '}
        <span style={{...DECORATED, borderColor: '#0077aa'}}>
          this decorated inline box is deliberately long enough that it breaks
          across more than one line, so the leading edge should be drawn only on
          the first fragment and the trailing edge only on the last
        </span>{' '}
        done.
      </ProseCase>
    </div>
  );
}

function InlineFlow() {
  return (
    <div>
      <ProseCase
        title="<div> with inline elements — one wrapping paragraph"
        note="A div is block-outer and block-inner: bare text and the inline elements inside it join a single inline formatting context and wrap together, rather than each becoming its own box.">
        a <b>bold</b> <i>italic</i>
        <span> span and text flowing inline in one wrapping paragraph, </span>
        just like a web div.
      </ProseCase>

      <ProseCase
        title="<u> — an element with no core registry entry"
        note="Registered on demand through the lazy descriptor seam rather than compiled in, which is invisible here — and that is the claim: it flows and underlines exactly like the elements that are.">
        plain and <u>underlined</u> text
      </ProseCase>

      <ProseCase
        title="Colour and background on the runs themselves"
        note="The inline elements are real elements, so a style on one restyles the run and it keeps flowing.">
        a <b style={{color: '#00aa00'}}>bold green word</b>, a{' '}
        <span style={{backgroundColor: DOC_COLORS.separator}}>
          run with a background
        </span>
        , and plain text after it.
      </ProseCase>
    </div>
  );
}

export const INTRO =
  'The lowercase intrinsic tags with their web-standard display: the block ' +
  '<div>, and the inline <b>, <i>, <span> and <u> that flow inside it. The ' +
  'cases here are the static ones — what an inline box paints and how much ' +
  'room it takes — so a browser can be given the same markup and answer the ' +
  'same question.';

export const DOC_SECTIONS = [
  ['spans', 'Span highlights and the inline advance', SpanHighlights],
  ['decorations', 'Inline box decorations', InlineBoxDecorations],
  ['flow', 'Inline flow inside a div', InlineFlow],
];
