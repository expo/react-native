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
 * The embedded-content demo as a SHARED DOCUMENT — see groupingDocs.js for the
 * rules: intrinsic tags only, CSS-spelled styles, literal colours, nothing
 * stateful.
 *
 * The claim this screen makes about `<img>` is a layout claim — that it is an
 * inline REPLACED element, an atomic box sitting on the line rather than a
 * block interrupting it — and a layout claim is only worth something if the
 * browser is handed the same markup to lay out. That is what this module is
 * for: every case below renders on device through the fork's catalog and,
 * unchanged, into the report's web column.
 *
 * What could not come along is the load lifecycle. `onLoad`/`onError` need
 * listeners and somewhere to put what they report, and state is exactly what a
 * shared document excludes; those cases stay in the RNTester screen, and the
 * web column for that route is a hand-written page with real listeners on it
 * (text-conformance/img-events.html).
 */

import {Case, DOC_COLORS} from './groupingDocs';
import * as React from 'react';

const LOGO = 'https://reactnative.dev/img/tiny_logo.png';
// A wide image, for the cases about fit and about choosing between files.
// Checked: `oss_logo.png` — the obvious name — is a 404, and a dead URL in a
// demo about images reads as a broken feature.
const WIDE = 'https://reactnative.dev/img/logo-og.png';

// No explicit `lineHeight`, so these cases show the line box the content
// itself produces. The "line-height and the line box" case covers what an
// author line-height does to it.
const PROSE = {fontSize: 16, color: '#1c1c1e'};

/*
 * The prose inside a case frame. Margins are stated on both sides rather than
 * left to the user-agent sheet: these paragraphs are the demo's own captions,
 * not part of what is being compared, so a UA margin difference showing up
 * here would be noise reported against a case about something else.
 */
const CAPTION = {
  fontSize: 13,
  lineHeight: 19,
  color: DOC_COLORS.secondary,
  marginTop: 0,
  marginBottom: 10,
};
const HINT = {
  fontSize: 11,
  color: DOC_COLORS.tertiary,
  marginTop: 0,
  marginBottom: 4,
};

const ROW_BOTTOM = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-end',
  gap: 12,
};
const ROW_CENTER = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
};

function InFlow() {
  return (
    <div>
      <Case
        title="An inline image flows with the text around it"
        note="It is part of the sentence, not a block interrupting it — the line wraps around it and the text continues on the same line.">
        <div style={PROSE}>
          The React Native logo{' '}
          <img src={LOGO} style={{width: 24, height: 24}} /> appears
          mid-sentence here, and the paragraph keeps flowing past it and wraps
          at the edge of the screen exactly as it would around a word.
        </div>
      </Case>

      <Case
        title="Its size changes the line box"
        note="A taller image makes the line taller. This is what makes it a replaced element rather than a picture pasted on top.">
        <div style={PROSE}>
          Small <img src={LOGO} style={{width: 16, height: 16}} /> then medium{' '}
          <img src={LOGO} style={{width: 32, height: 32}} /> then large{' '}
          <img src={LOGO} style={{width: 56, height: 56}} /> — each line grows
          to fit the tallest thing on it.
        </div>
      </Case>

      <Case
        title="Several images in one run"
        note="They flow and wrap like words, breaking onto the next line when they run out of room. The space between each one is a real text node — see the case below for why that matters.">
        <div style={PROSE}>
          {Array.from({length: 12}, (_, i) => (
            <React.Fragment key={i}>
              <img src={LOGO} style={{width: 28, height: 28}} />{' '}
            </React.Fragment>
          ))}
        </div>
      </Case>

      <Case
        title="A run of images with no text at all"
        note="Inline-level children alone establish an inline formatting context: a row of images with no text still flows as one line, exactly as in a browser.">
        <p style={CAPTION}>
          Inline-level children establish an inline formatting context whether
          or not there is text beside them, so both rows flow. They used not to:
          the rebuild that builds a run was triggered by inline TEXT alone, so a
          run made only of boxes was laid out as block children.
        </p>
        <p style={HINT}>no text node</p>
        <div style={PROSE}>
          {Array.from({length: 4}, (_, i) => (
            <img key={i} src={LOGO} style={{width: 28, height: 28}} />
          ))}
        </div>
        <p style={{...HINT, marginTop: 10}}>one space between each</p>
        <div style={PROSE}>
          {Array.from({length: 4}, (_, i) => (
            <React.Fragment key={i}>
              <img src={LOGO} style={{width: 28, height: 28}} />{' '}
            </React.Fragment>
          ))}
        </div>
      </Case>

      <Case
        title="Nested inside a text-level element"
        note="An inline box establishes no formatting context of its own, so the image is on the paragraph's line whether it is a direct child or three inline elements deep. An image in a link is part of the link and highlights with it.">
        <div style={PROSE}>
          Visit{' '}
          <a href="https://reactnative.dev">
            <img src={LOGO} alt="" style={{width: 20, height: 20}} />{' '}
            reactnative.dev
          </a>{' '}
          for the documentation. Three deep:{' '}
          <span>
            <b>
              <em>
                <img src={LOGO} alt="" style={{width: 20, height: 20}} />
              </em>
            </b>
          </span>{' '}
          still on the line.
        </div>
      </Case>
    </div>
  );
}

function Sizing() {
  return (
    <div>
      <Case
        title="Explicit width and height"
        note="Set through style, as everywhere else in this system.">
        <div style={ROW_BOTTOM}>
          <img src={LOGO} style={{width: 32, height: 32}} />
          <img src={LOGO} style={{width: 48, height: 48}} />
          <img src={LOGO} style={{width: 64, height: 64}} />
        </div>
      </Case>

      <Case
        title="Borders, radius and background"
        note="It is a styleable box like any other element.">
        <div style={ROW_CENTER}>
          <img
            src={LOGO}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 2,
              borderStyle: 'solid',
              borderColor: '#0a84ff',
            }}
          />
          <img
            src={LOGO}
            style={{
              width: 56,
              height: 56,
              borderRadius: 8,
              backgroundColor: '#ffd60a',
              padding: 6,
            }}
          />
          <img src={LOGO} style={{width: 56, height: 56, opacity: 0.4}} />
        </div>
      </Case>
    </div>
  );
}

function InFigure() {
  return (
    <Case
      title="In a <figure> with a <figcaption>"
      note="The combination §4.4 defines for an illustration and its caption.">
      <figure>
        <img src={WIDE} style={{width: 240, height: 72}} />
        <figcaption>
          Figure 1. The React Native logo, in a figure that owns its caption.
        </figcaption>
      </figure>
    </Case>
  );
}

function LineHeightAndTheLineBox() {
  return (
    <Case
      title="line-height sets a floor on the line box, not a cap"
      note="line-height sizes the strut; the line box is the union of the strut and everything on the line, so a taller inline grows it.">
      <p style={CAPTION}>
        A line box is the union of everything on it, so a tall inline makes the
        line taller even when `line-height` asks for less (css-inline-3 §4.1).
        Both rows below are the same height: the 56pt box decides it, not the
        line-height.
      </p>

      <p style={HINT}>lineHeight: 26 — smaller than the box</p>
      <div style={{fontSize: 16, lineHeight: 26}}>
        {'Small then medium then large and more words to force a wrap '}
        <div
          style={{
            display: 'inline-block',
            width: 56,
            height: 56,
            backgroundColor: '#ff3b30',
          }}
        />
        {' trailing text after the tall box to fill out the line'}
      </div>

      <p style={{...HINT, marginTop: 14}}>no lineHeight</p>
      <div style={{fontSize: 16}}>
        {'Small then medium then large and more words to force a wrap '}
        <div
          style={{
            display: 'inline-block',
            width: 56,
            height: 56,
            backgroundColor: '#34c759',
          }}
        />
        {' trailing text after the tall box to fill out the line'}
      </div>
    </Case>
  );
}

function Attributes() {
  return (
    <div>
      <Case
        title="src — the HTML attribute"
        note="A URL, as HTML writes it, rather than an RN source object. The object form still works for anything that needs it.">
        <div style={PROSE}>
          {'Written as '}
          <img src={LOGO} style={{width: 28, height: 28}} />
          {' <img src={…} />.'}
        </div>
      </Case>

      <Case
        title="width and height attributes"
        note="HTML calls these presentational hints: they act as if they came from the user-agent sheet, so any author style still wins. The third image proves it.">
        <div style={ROW_BOTTOM}>
          <img src={LOGO} width={24} height={24} />
          <img src={LOGO} width={48} height={48} />
          <img
            src={LOGO}
            width={48}
            height={48}
            style={{width: 72, height: 72}}
          />
        </div>
      </Case>

      <Case
        title="srcset — several files, and the user agent picks"
        note="The choice is made here, against the device pixel ratio, because a user agent is what makes it — and because neither platform accepts a srcset-shaped list. On a 2x screen or better this is the second file.">
        <img
          srcSet={`${LOGO} 1x, ${WIDE} 2x`}
          style={{width: 120, height: 60}}
        />
      </Case>

      <Case
        title="srcset with w descriptors, and sizes"
        note="A w descriptor only means something next to a layout width, so sizes is resolved against the viewport, multiplied by the pixel ratio, and the smallest file that still covers the box wins.">
        <img
          srcSet={`${LOGO} 200w, ${WIDE} 1200w`}
          sizes="(max-width: 600px) 100vw, 400px"
          style={{width: 200, height: 60}}
        />
      </Case>

      <Case
        title="object-fit, spelled as CSS spells it"
        note="One style property, translated to whichever prop the backing image view takes — contentFit for expo-image, resizeMode for the framework's own. Each box is 120×80 and only the fit differs.">
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 10,
            flexWrap: 'wrap',
          }}>
          {['cover', 'contain', 'fill', 'scale-down', 'none'].map(fit => (
            <div key={fit}>
              <img
                src={WIDE}
                style={{
                  width: 120,
                  height: 80,
                  objectFit: fit,
                  backgroundColor: DOC_COLORS.separator,
                  borderRadius: 4,
                }}
              />
              <p style={{...HINT, fontSize: 10, marginTop: 2, marginBottom: 0}}>
                {fit}
              </p>
            </div>
          ))}
        </div>
      </Case>

      <Case
        title="alt — three states, not two"
        note='Invisible on screen and the whole point of the attribute. Text names the image; alt="" declares it decorative and hides it from assistive technology entirely; absent makes no claim.'>
        <div style={ROW_CENTER}>
          <img
            src={LOGO}
            alt="The React Native logo"
            style={{width: 40, height: 40}}
          />
          <img src={LOGO} alt="" style={{width: 40, height: 40}} />
          <img src={LOGO} style={{width: 40, height: 40}} />
        </div>
        <p style={{...HINT, marginTop: 6, marginBottom: 0}}>
          named · decorative (hidden) · no claim
        </p>
      </Case>
    </div>
  );
}

function PictureAndSource() {
  return (
    <div>
      <Case
        title="<picture> chooses, <img> renders"
        note="The <source> children are read, never mounted — a source is a decision, not a view. The <img> inside is what draws, and is also the fallback when nothing matches.">
        <picture>
          <source srcSet={WIDE} type="image/webp" />
          <img src={LOGO} alt="Logo" style={{width: 200, height: 60}} />
        </picture>
      </Case>

      <Case
        title="type — an undecodable format is skipped"
        note="This is what makes the fallback work: the first source claims a format we do not decode, so the second is chosen.">
        <picture>
          <source srcSet={WIDE} type="image/x-does-not-exist" />
          <source srcSet={LOGO} type="image/png" />
          <img src={WIDE} alt="Logo" style={{width: 60, height: 60}} />
        </picture>
      </Case>

      <Case
        title="media — art direction, re-evaluated on rotation"
        note="Rotate the device: the first source applies only on a wide viewport, so which file is shown changes. That is why this is a component rather than a one-time choice at mount.">
        <picture>
          <source srcSet={WIDE} media="(min-width: 500px)" />
          <source srcSet={LOGO} media="(max-width: 499px)" />
          <img src={LOGO} alt="Logo" style={{width: 200, height: 60}} />
        </picture>
      </Case>

      <Case
        title="No source matches — the <img> stands alone"
        note="Its own src is left untouched, because it is the fallback rather than a placeholder.">
        <picture>
          <source srcSet={WIDE} media="(min-width: 99999px)" />
          <img src={LOGO} alt="Logo" style={{width: 60, height: 60}} />
        </picture>
      </Case>
    </div>
  );
}

function Gaps() {
  return (
    <Case
      title="Still not built"
      note="Stated plainly rather than left to be discovered.">
      <p style={{...CAPTION, marginBottom: 0}}>
        `loading="lazy"` and `decoding` have no equivalent here and are ignored.
        `crossorigin` and `referrerpolicy` do not reach the request. A `sizes`
        condition other than min-width/max-width is skipped rather than guessed
        at, which leaves the choice to the platform.
      </p>
    </Case>
  );
}

export const INTRO =
  '<img> is an inline replaced element: an atomic box inside a run of text, ' +
  "shifting the line's height the way a letter would. That is what separates " +
  'it from a block-level <Image>.';

/*
 * The `loading` section is missing from this list on purpose, and is spliced
 * back in by the RNTester screen: its subject is events, which a static
 * document cannot show without inventing a result nothing produced.
 */
export const DOC_SECTIONS = [
  ['inflow', 'Images in flow', InFlow],
  ['attributes', 'HTML attributes: src, srcset, alt, object-fit', Attributes],
  ['picture', 'picture and source', PictureAndSource],
  ['sizing', 'Sizing, fit and decoration', Sizing],
  ['figure', 'In a figure', InFigure],
  ['lineheight', 'line-height and the line box', LineHeightAndTheLineBox],
  ['gaps', 'Not built yet: lazy loading, crossorigin, sizes', Gaps],
];
