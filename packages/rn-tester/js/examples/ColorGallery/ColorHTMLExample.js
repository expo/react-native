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
 * The color fixtures through `<img>`, HDR pictures under each
 * `dynamic-range-limit`, and wide colors on text-level elements: the CSS
 * gallery's colors and pictures through the element catalog.
 *
 * `@noflow`: the intrinsics have no JSX types.
 */

import {
  HDR_PICTURES,
  PICTURES,
  imgBacking,
  patchTargets,
  sampleAll,
  target,
} from './colorGalleryData';
import {setImgBacking} from '@react-native/expo-intrinsics-poc';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {DevSettings, ScrollView} from 'react-native';

// Paper white and fixed ink in both modes: every color is judged against
// plain SDR white
const PAPER_COLOR = '#ffffff';
const LABEL_COLOR = '#000000';
const SECONDARY_COLOR = '#555555';
const SEPARATOR_COLOR = '#d1d1d6';
const CARD_COLOR = '#f2f2f7';
const GROUPED_PAGE_COLOR = PAPER_COLOR;

// The framework's image view: expo-image doesn't decode every fixture or read
// `dynamic-range-limit`. Before any `<img>` renders.
setImgBacking('framework');

const LIMITS = ['no-limit', 'constrained', 'standard'];

const SECTION = {
  fontSize: 17,
  fontWeight: '700',
  color: LABEL_COLOR,
  marginTop: 24,
};
const EXPECT = {
  fontSize: 12,
  fontWeight: '600',
  color: LABEL_COLOR,
  marginTop: 2,
};
const LEGEND = {
  fontSize: 12,
  color: SECONDARY_COLOR,
  marginTop: 2,
  marginBottom: 6,
};
const LABEL = {
  fontFamily: 'Menlo',
  fontSize: 11,
  color: SECONDARY_COLOR,
  marginTop: 8,
  marginBottom: 2,
};

// Labels a row above their pictures, so a wrapped label moves only its row
function Pictures() {
  const cells = [];
  for (let i = 0; i < PICTURES.length; i += 2) {
    const pair = PICTURES.slice(i, i + 2);
    for (const picture of pair) {
      cells.push(
        <div key={`label ${picture.file}`} style={{...LABEL, alignSelf: 'end'}}>
          {picture.label}
        </div>,
      );
    }
    if (pair.length === 1) {
      cells.push(<div key="label gap" />);
    }
    for (const picture of pair) {
      cells.push(
        <div
          key={picture.file}
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: SEPARATOR_COLOR,
          }}>
          <img
            ref={target(`img ${picture.file}`, patchTargets(picture.file))}
            src={picture.uri}
            testID={`img-${picture.file}`}
            style={{
              width: '100%',
              height: picture.file === 'p3-16bit-ramp.png' ? 12 : 44,
              objectFit: 'fill',
            }}
          />
        </div>,
      );
    }
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        columnGap: 8,
      }}>
      {cells}
    </div>
  );
}

// Each HDR picture under the three limits, a column each
function HdrTable() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        columnGap: 6,
      }}>
      {LIMITS.map(limit => (
        <div
          key={`title ${limit}`}
          style={{
            fontSize: 11,
            fontWeight: '600',
            color: SECONDARY_COLOR,
            textAlign: 'center',
          }}>
          {limit}
        </div>
      ))}
      <div
        key="label white"
        style={{...LABEL, gridColumnStart: 1, gridColumnEnd: -1}}>
        paper white, for comparison
      </div>
      {LIMITS.map(limit => (
        <div
          key={`white ${limit}`}
          style={{height: 32, backgroundColor: '#ffffff'}}
        />
      ))}
      {HDR_PICTURES.flatMap(picture => [
        <div
          key={`label ${picture.file}`}
          style={{...LABEL, gridColumnStart: 1, gridColumnEnd: -1}}>
          {picture.label}
        </div>,
        ...LIMITS.map(limit => (
          <img
            key={`${limit} ${picture.file}`}
            src={picture.uri}
            testID={`hdr-${limit}-${picture.file}`}
            style={{
              width: '100%',
              height: 32,
              objectFit: 'fill',
              dynamicRangeLimit: limit,
            }}
          />
        )),
      ])}
    </div>
  );
}

function LimitControl({limit, setLimit}) {
  return (
    <div style={{display: 'flex', gap: 8}}>
      {LIMITS.map(value => (
        <button
          key={value}
          type="button"
          testID={`limit-${value}`}
          onClick={() => setLimit(value)}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: value === limit ? '#1f6feb' : SEPARATOR_COLOR,
            textAlign: 'center',
            backgroundColor: value === limit ? '#1f6feb' : CARD_COLOR,
            color: value === limit ? '#ffffff' : LABEL_COLOR,
            fontSize: 15,
            fontWeight: '600',
          }}>
          {value}
        </button>
      ))}
    </div>
  );
}

function Gallery() {
  const [limit, setLimit] = useState('no-limit');
  const scrollRef = useRef(null);
  const contentHeight = useRef(0);
  // Sampling is instrumentation: the development menu, not the screen
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    DevSettings.addMenuItem('Sample the HTML color gallery', () => {
      sampleAll(scrollRef.current, contentHeight.current).then(
        count => console.log(`sampled ${count} points`),
        error => console.warn(`sampling failed: ${error.message}`),
      );
    });
  }, []);
  return (
    <ScrollView
      testID="gallery"
      ref={scrollRef}
      style={{backgroundColor: PAPER_COLOR}}
      // The limit control stays at the top while the pictures scroll under it
      stickyHeaderIndices={[1]}
      onContentSizeChange={(width, height) => {
        contentHeight.current = height;
      }}>
      <div style={{padding: 16, paddingBottom: 4}}>
        <p style={{fontSize: 13, color: SECONDARY_COLOR, margin: 0}}>
          The color fixtures through {'<img>'}, and wide colors on text-level
          elements. The CSS gallery has the same colors and pictures through
          core components.
        </p>
        <div style={{...LABEL, marginTop: 12}} testID="img-backing">
          {'<img>'} is backed by {imgBacking()}
        </div>
        <p
          style={{
            fontSize: 12,
            color: SECONDARY_COLOR,
            margin: 0,
            marginTop: 10,
          }}>
          Limitations of {'<img>'} for now: backed by expo-image (an app with
          the Expo runtime), on iOS the PQ and HLG HEIC pictures don't decode,
          Display P3 is clipped to sRGB, dynamic-range-limit is ignored, and a
          picture named from the asset catalog is missed in a release build.
          RNTester pins the framework's image view instead, so this screen shows
          that view's behavior; with expo-image, judge pictures in the CSS
          gallery, which draws them through the core Image. Sampling, from the
          development menu, reads a picture's drawn color only on the framework
          view.
        </p>
      </div>
      <div
        style={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 6,
          paddingBottom: 10,
          backgroundColor: GROUPED_PAGE_COLOR,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: SEPARATOR_COLOR,
        }}>
        <div style={{...LABEL, marginTop: 0, marginBottom: 6}}>
          dynamic-range-limit of the screen: {limit}
          {imgBacking() === 'expo-image'
            ? ' (expo-image does not read it yet)'
            : ''}
        </div>
        <LimitControl limit={limit} setLimit={setLimit} />
      </div>
      <div
        style={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: 48,
          // The screen's limit, inherited by every picture and HDR color in it
          dynamicRangeLimit: limit,
        }}>
        <div style={SECTION}>Text-level elements</div>
        <div style={EXPECT}>
          Expect: wide colors on text and its marks; the bar changes nothing
          here.
        </div>
        <div style={LEGEND}>
          Wide colors on the elements of a paragraph: the colors inherit and mix
          with sRGB ones in one line.
        </div>
        <p style={{fontSize: 17, color: LABEL_COLOR, margin: 0}}>
          A paragraph with{' '}
          <b style={{color: 'color(display-p3 1 0 0)'}}>Display P3 red</b>,{' '}
          <i style={{color: 'oklch(0.7 0.25 145)'}}>an oklch green</i> and{' '}
          <mark style={{backgroundColor: 'color(display-p3 1 1 0)'}}>
            a P3 yellow mark
          </mark>
          , beside <span style={{color: 'red'}}>sRGB red</span>.
        </p>

        <div style={SECTION}>Image profiles · {'<img>'}</div>
        <div style={EXPECT}>
          Expect: every picture draws; the HDR ones follow the bar — no-limit
          brightest, standard like SDR.
        </div>
        <div style={LEGEND}>
          One picture per embedded profile, format and depth.
        </div>
        <Pictures />

        <div style={SECTION}>HDR under each limit, side by side</div>
        <div style={EXPECT}>
          Expect: brightest on the left, SDR on the right; each column states
          its own limit, so the bar changes nothing here.
        </div>
        <div style={LEGEND}>
          Left to right: no-limit, constrained, standard. On an HDR display the
          bright patches step down left to right; on SDR all three match.
        </div>
        <HdrTable />
      </div>
    </ScrollView>
  );
}

export default {
  title: 'Color in HTML elements',
  category: 'UI',
  description:
    'The color fixtures through <img>, HDR under each dynamic-range-limit, ' +
    'and wide colors on text-level elements.',
  examples: [
    {
      name: 'gallery',
      title: 'Color in HTML elements',
      fullBleed: true,
      render: () => <Gallery />,
    },
  ],
};
