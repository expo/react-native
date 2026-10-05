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
 * Every CSS color space and platform space as backgrounds, text, shadows,
 * borders, gradients and transitions, and the color fixtures through `Image`,
 * with core components only. The sample button logs each chip's and
 * picture's drawn color as a `COLOR_SAMPLE` line beside its expected value.
 */

import {
  CARD_COLOR,
  LABEL_COLOR,
  SECONDARY_COLOR,
  SEPARATOR_COLOR,
} from '../HTMLElements/themed';
import {
  CSS_SPACES,
  DASHED_SPACES,
  HDR_PICTURES,
  PICTURES,
  patchTargets,
  sampleAll,
  target,
} from './colorGalleryData';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {
  DevSettings,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  processColor,
} from 'react-native';

const LIMITS = ['no-limit', 'constrained', 'standard'];

/*
 * What this display can show, asked through the web's own APIs: each media
 * query's answer now, kept current by its change event, and whether a few
 * colors are supported here. The dashed space is the one answer that differs
 * by device.
 */
const MEDIA_QUERIES = [
  '(color-gamut: srgb)',
  '(color-gamut: p3)',
  '(color-gamut: rec2020)',
  '(dynamic-range: high)',
  '(prefers-color-scheme: dark)',
];

const SUPPORTS = [
  ['color', 'color(display-p3 1 0 0)'],
  ['color', 'oklch(0.7 0.25 145)'],
  ['color', 'color(rec2100-pq 0.5 0.5 0.5)'],
  ['color', 'color(--dci-p3 1 0 0)'],
  ['color', 'color(--gray-linear 0.5)'],
  ['dynamic-range-limit', 'constrained'],
];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    global.matchMedia != null ? global.matchMedia(query).matches : null,
  );
  useEffect(() => {
    if (global.matchMedia == null) {
      return;
    }
    const list = global.matchMedia(query);
    const onChange = event => setMatches(event.matches);
    list.addEventListener('change', onChange);
    setMatches(list.matches);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function MediaQueryRow({query}) {
  const matches = useMediaQuery(query);
  return (
    <>
      <View>
        <Text style={styles.rowLabel}>{query}</Text>
      </View>
      <View>
        <Text
          testID={`media-${query}`}
          style={[styles.name, {color: matches ? '#34c759' : LABEL_COLOR}]}>
          {matches == null ? 'no matchMedia' : matches ? 'matches' : 'no'}
        </Text>
      </View>
    </>
  );
}

function DisplayTable() {
  return (
    <View style={styles.answerRows}>
      {MEDIA_QUERIES.map(query => (
        <MediaQueryRow key={query} query={query} />
      ))}
      {SUPPORTS.map(([property, value]) => {
        const supported =
          global.CSS != null ? global.CSS.supports(property, value) : null;
        return (
          <React.Fragment key={`${property} ${value}`}>
            <View>
              <Text style={styles.rowLabel}>{`${property}: ${value}`}</Text>
            </View>
            <View>
              <Text
                testID={`supports-${value}`}
                style={[
                  styles.name,
                  {color: supported ? '#34c759' : LABEL_COLOR},
                ]}>
                {supported == null
                  ? 'no CSS.supports'
                  : supported
                    ? 'supported'
                    : 'no'}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function parses(color) {
  return processColor(color) != null;
}

// A row per space: its name, note and whether it parsed, then five chips
function SpaceTable({rows}) {
  return (
    <View style={styles.spaceTable}>
      {rows.flatMap(([name, note, swatches]) => {
        const parsed = swatches.filter(([, color]) => parses(color)).length;
        return [
          <View key={name} testID={`row-${name}`}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.note}>{note}</Text>
            <Text
              style={[
                styles.note,
                {color: parsed === swatches.length ? '#34c759' : '#ff3b30'},
              ]}>
              {parsed === swatches.length
                ? 'parsed'
                : `parsed ${parsed} of ${swatches.length}`}
            </Text>
          </View>,
          ...swatches.map(([label, color]) => (
            <View
              key={`${name} ${label}`}
              ref={target(`chip ${name} ${label}`, [{at: [0.5, 0.5]}])}
              testID={`chip-${name}-${label}`}
              style={[styles.chip, {backgroundColor: color}]}
            />
          )),
        ];
      })}
    </View>
  );
}

function Segmented({choices, value, onChange, testIDPrefix}) {
  return (
    <View
      style={[
        styles.segmented,
        {gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`},
      ]}>
      {choices.map(choice => (
        <Pressable
          key={choice}
          testID={`${testIDPrefix}-${choice}`}
          onPress={() => onChange(choice)}
          style={[
            styles.segment,
            {backgroundColor: choice === value ? '#1f6feb' : CARD_COLOR},
          ]}>
          <Text
            style={[
              styles.segmentText,
              {color: choice === value ? '#ffffff' : LABEL_COLOR},
            ]}>
            {choice}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/*
 * Two pictures a row, their labels a row above them, so a label that wraps
 * to two lines moves its row rather than its picture. The chosen
 * dynamic-range-limit is set on the container and inherited by the pictures.
 */
function Pictures({limit}) {
  const cells = [];
  for (let i = 0; i < PICTURES.length; i += 2) {
    const pair = PICTURES.slice(i, i + 2);
    for (const picture of pair) {
      cells.push(
        <View key={`label ${picture.file}`} style={styles.pictureLabelCell}>
          <Text style={styles.pictureLabel}>{picture.label}</Text>
        </View>,
      );
    }
    if (pair.length === 1) {
      cells.push(<View key="label gap" />);
    }
    for (const picture of pair) {
      cells.push(
        <View key={picture.file} style={styles.framed}>
          <Image
            ref={target(`picture ${picture.file}`, patchTargets(picture.file))}
            source={{uri: picture.uri}}
            testID={`picture-${picture.file}`}
            resizeMode="stretch"
            style={{
              width: '100%',
              height: picture.file === 'p3-16bit-ramp.png' ? 12 : 44,
            }}
          />
        </View>,
      );
    }
  }
  // The limit is set once, on the container: every picture inside inherits it
  return (
    <View style={[styles.twoUp, {dynamicRangeLimit: limit}]}>{cells}</View>
  );
}

// Each HDR picture under the three limits, a column each
function HdrTable() {
  return (
    <View style={styles.threeUp}>
      {LIMITS.map(limit => (
        <View key={`title ${limit}`}>
          <Text style={styles.columnTitle}>{limit}</Text>
        </View>
      ))}
      {HDR_PICTURES.flatMap(picture => [
        <View key={`label ${picture.file}`} style={styles.spanningLabel}>
          <Text style={styles.pictureLabel}>{picture.label}</Text>
        </View>,
        ...LIMITS.map(limit => (
          <Image
            key={`${limit} ${picture.file}`}
            source={{uri: picture.uri}}
            testID={`hdr-${limit}-${picture.file}`}
            resizeMode="stretch"
            style={{width: '100%', height: 32, dynamicRangeLimit: limit}}
          />
        )),
      ])}
    </View>
  );
}

const SHADOWS = [
  ['green', 'rgb(0 255 0 / 0.85)', 'color(display-p3 0 1 0 / 0.85)'],
  ['red', 'rgb(255 0 0 / 0.85)', 'color(display-p3 1 0 0 / 0.85)'],
  ['blue', 'rgb(0 0 255 / 0.85)', 'color(display-p3 0 0 1 / 0.85)'],
];

// Each color's shadow in sRGB, then in Display P3, a row each
function ShadowTable() {
  return (
    <View style={styles.shadowTable}>
      {SHADOWS.flatMap(([label, srgb, p3]) => [
        <View key={label}>
          <Text style={styles.name}>{label}</Text>
        </View>,
        <View key={`${label} srgb`} style={styles.shadowCell}>
          <View style={[styles.shadowBox, {boxShadow: `0 6px 16px ${srgb}`}]} />
          <Text style={styles.note}>sRGB</Text>
        </View>,
        <View key={`${label} p3`} style={styles.shadowCell}>
          <View
            testID={`p3-shadow-${label}`}
            style={[styles.shadowBox, {boxShadow: `0 6px 16px ${p3}`}]}
          />
          <Text style={styles.note}>Display P3</Text>
        </View>,
      ])}
    </View>
  );
}

const BORDER_COLORS = [
  ['red', 'rgb(255 0 0)', 'color(display-p3 1 0 0)'],
  ['green', 'rgb(0 255 0)', 'color(display-p3 0 1 0)'],
  ['blue', 'rgb(0 0 255)', 'color(display-p3 0 0 1)'],
];

// The middle of the top edge and of the bottom edge, as fractions of a box
const TOP_EDGE = [0.5, 3 / 40];
const BOTTOM_EDGE = [0.5, 37 / 40];

// A row per color: sRGB, then Display P3 square and round; last, mixed edges
function BorderTable() {
  return (
    <View style={styles.borderTable}>
      <View />
      {['sRGB', 'Display P3', 'P3, rounded'].map(title => (
        <View key={title}>
          <Text style={styles.columnTitle}>{title}</Text>
        </View>
      ))}
      {BORDER_COLORS.flatMap(([label, srgb, p3]) => [
        <View key={label}>
          <Text style={styles.name}>{label}</Text>
        </View>,
        <View
          key={`${label} srgb`}
          ref={target(`border srgb ${label}`, [{at: TOP_EDGE}])}
          style={[styles.borderBox, {borderColor: srgb}]}
        />,
        <View
          key={`${label} p3`}
          ref={target(`border p3 ${label}`, [{at: TOP_EDGE}])}
          testID={`p3-border-${label}`}
          style={[styles.borderBox, {borderColor: p3}]}
        />,
        <View
          key={`${label} p3 rounded`}
          testID={`p3-rounded-border-${label}`}
          style={[styles.borderBox, styles.rounded, {borderColor: p3}]}
        />,
      ])}
      <View>
        <Text style={styles.name}>mixed</Text>
      </View>
      <View>
        <Text style={styles.note}>top sRGB blue, others P3 red</Text>
      </View>
      <View
        ref={target('border mixed', [{at: TOP_EDGE}, {at: BOTTOM_EDGE}])}
        testID="mixed-border"
        style={[styles.borderBox, styles.mixedBorder]}
      />
      <View
        testID="mixed-rounded-border"
        style={[styles.borderBox, styles.rounded, styles.mixedBorder]}
      />
    </View>
  );
}

/*
 * Colors brighter than SDR white: twice white's luminance in linear sRGB, and
 * a PQ gray at about 1000 nits. Each is drawn under no limit, then under
 * `standard`, which keeps it at SDR white; on an SDR display all four are
 * white. The limit is the box's own.
 */
const HDR_COLORS = [
  ['srgb-linear 2 2 2', 'color(srgb-linear 2 2 2)'],
  ['rec2100-pq 0.75', 'color(rec2100-pq 0.75 0.75 0.75)'],
  ['rec2100-linear 4 0 0', 'color(rec2100-linear 4 0 0)'],
];

function HdrColorTable() {
  return (
    <View style={styles.hdrTable}>
      <View />
      {['no-limit', 'standard'].map(title => (
        <View key={title}>
          <Text style={styles.columnTitle}>{title}</Text>
        </View>
      ))}
      <View />
      {HDR_COLORS.flatMap(([label, color]) => [
        <View key={label}>
          <Text style={styles.name}>{label}</Text>
        </View>,
        <View
          key={`${label} no-limit`}
          ref={target(`hdr ${label}`, [{at: [0.5, 0.5]}])}
          testID={`hdr-color-${label}`}
          style={[styles.hdrBox, {backgroundColor: color}]}
        />,
        <View
          key={`${label} standard`}
          testID={`hdr-color-standard-${label}`}
          style={[
            styles.hdrBox,
            {backgroundColor: color, dynamicRangeLimit: 'standard'},
          ]}
        />,
        <View key={`${label} gap`} />,
      ])}
    </View>
  );
}

const GRADIENTS = [
  ['legacy sRGB', 'linear-gradient(to right, #0000ff, #ffff00)'],
  ['in srgb', 'linear-gradient(in srgb to right, #0000ff, #ffff00)'],
  [
    'in srgb-linear',
    'linear-gradient(in srgb-linear to right, #0000ff, #ffff00)',
  ],
  ['in oklab', 'linear-gradient(in oklab to right, #0000ff, #ffff00)'],
  ['in oklch', 'linear-gradient(in oklch to right, #0000ff, #ffff00)'],
  [
    'in display-p3',
    'linear-gradient(in display-p3 to right, #0000ff, #ffff00)',
  ],
  [
    'P3 stops',
    'linear-gradient(to right, color(display-p3 1 0 0), color(display-p3 0 1 0))',
  ],
];

function GradientTable() {
  return (
    <View style={styles.labelledRows}>
      {GRADIENTS.flatMap(([label, gradient]) => [
        <View key={label}>
          <Text style={styles.rowLabel}>{label}</Text>
        </View>,
        <View
          key={`${label} bar`}
          testID={`gradient-${label}`}
          style={{height: 24, backgroundImage: gradient}}
        />,
      ])}
    </View>
  );
}

// Legacy colors transition in sRGB; a color in its own space in Oklab (CSS
// Color 4 §12.1)
const TRANSITIONS = [
  ['legacy', '#0000ff', '#ffff00'],
  ['oklch', 'oklch(0.45 0.31 264)', 'oklch(0.97 0.21 110)'],
  ['display-p3', 'color(display-p3 0 0 1)', 'color(display-p3 1 1 0)'],
];

function TransitionTable() {
  const [on, setOn] = useState(false);
  return (
    <View>
      <Pressable
        testID="transition-toggle"
        onPress={() => setOn(value => !value)}
        style={styles.button}>
        <Text style={styles.buttonText}>
          {on ? 'Transition back' : 'Transition'}
        </Text>
      </Pressable>
      <View style={styles.labelledRows}>
        {TRANSITIONS.flatMap(([label, from, to]) => [
          <View key={label}>
            <Text style={styles.rowLabel}>{label}</Text>
          </View>,
          <View
            key={`${label} box`}
            testID={`transition-${label}`}
            style={{
              height: 24,
              backgroundColor: on ? to : from,
              transitionProperty: 'background-color',
              transitionDuration: '2s',
              transitionTimingFunction: 'linear',
            }}
          />,
        ])}
      </View>
    </View>
  );
}

function Section({title, legend, children}) {
  return (
    <View>
      <Text style={styles.section}>{title}</Text>
      {legend != null && <Text style={styles.legend}>{legend}</Text>}
      {children}
    </View>
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
    DevSettings.addMenuItem('Sample the color gallery', () => {
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
      onContentSizeChange={(width, height) => {
        contentHeight.current = height;
      }}>
      <View style={styles.page}>
        <Text style={styles.intro}>
          Every CSS color space and platform profile, drawn by React Native's
          core components. A row that isn't parsed draws nothing; a dashed space
          this device doesn't provide draws nothing too.
        </Text>

        <Text style={styles.label}>
          dynamic-range-limit of the pictures: {limit}
        </Text>
        <Segmented
          choices={LIMITS}
          value={limit}
          onChange={setLimit}
          testIDPrefix="limit"
        />
        <Section
          title="This display · matchMedia and CSS.supports"
          legend="What the OS says this screen can show, through the web's own APIs. On a P3 phone the second row matches; on an HDR one the fourth does. The dashed spaces answer per device.">
          <DisplayTable />
        </Section>

        <Section
          title="CSS color spaces"
          legend="Each row: red · green · blue · mid · white in that color space (HDR rows: as noted). More saturated than srgb means a wider gamut, visible on a P3 display.">
          <SpaceTable rows={CSS_SPACES} />
        </Section>

        <Section
          title="Platform profiles · color(--name …)"
          legend="Color spaces the OS may ship beyond CSS's, by their standards' names. Whether each one draws depends on the device and OS.">
          <SpaceTable rows={DASHED_SPACES} />
        </Section>

        <Section
          title="Text"
          legend="The same red as text: sRGB, then Display P3 (redder on a P3 display).">
          <Text style={[styles.sample, {color: 'red'}]}>sRGB red text</Text>
          <Text
            testID="p3-text"
            style={[styles.sample, {color: 'color(display-p3 1 0 0)'}]}>
            Display P3 red text
          </Text>
          <Text
            testID="oklch-text"
            style={[styles.sample, {color: 'oklch(0.7 0.25 145)'}]}>
            oklch(0.7 0.25 145) text
          </Text>
        </Section>

        <Section
          title="Shadows"
          legend="Each pair: the sRGB color, then the Display P3 one (more vivid on a P3 display).">
          <ShadowTable />
        </Section>

        <Section
          title="Borders"
          legend="Each row: the sRGB color, then the Display P3 one with square and with round corners (more vivid on a P3 display).">
          <BorderTable />
        </Section>

        <Section
          title="HDR colors"
          legend="Brighter than white, where the display has headroom: no limit, then dynamic-range-limit: standard. On an SDR screen every box is white.">
          <HdrColorTable />
        </Section>

        <Section
          title="Gradients"
          legend="Blue to yellow in each interpolation space. sRGB's midpoint is gray; Oklab's is lighter; Oklch's goes round the hue wheel.">
          <GradientTable />
        </Section>

        <Section
          title="Transitions"
          legend="Two seconds, linear. Legacy colors move in sRGB; a color in its own space moves in Oklab, so its midpoint stays light and saturated.">
          <TransitionTable />
        </Section>

        <Section
          title="Image profiles · Image"
          legend="One picture per embedded profile, format and depth, through the framework's image view.">
          <Pictures limit={limit} />
        </Section>

        <Section
          title="HDR under each limit, side by side"
          legend="Left to right: no-limit, constrained, standard. On an HDR display the bright patches step down left to right; on SDR all three match.">
          <HdrTable />
        </Section>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    paddingBottom: 48,
  },
  intro: {
    fontSize: 13,
    color: SECONDARY_COLOR,
  },
  section: {
    fontSize: 17,
    fontWeight: '700',
    color: LABEL_COLOR,
    marginTop: 24,
  },
  legend: {
    fontSize: 12,
    color: SECONDARY_COLOR,
    marginTop: 2,
    marginBottom: 6,
  },
  name: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: LABEL_COLOR,
  },
  note: {
    fontSize: 11,
    color: SECONDARY_COLOR,
  },
  label: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: SECONDARY_COLOR,
    marginTop: 12,
  },
  spaceTable: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) repeat(5, 40px)',
    columnGap: 4,
    rowGap: 6,
    alignItems: 'center',
  },
  chip: {
    height: 28,
    borderWidth: 1,
    borderColor: SEPARATOR_COLOR,
  },
  segmented: {
    display: 'grid',
    borderRadius: 9,
    overflow: 'hidden',
    marginTop: 8,
  },
  segment: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    marginTop: 10,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 9,
    backgroundColor: CARD_COLOR,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: LABEL_COLOR,
  },
  twoUp: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    columnGap: 8,
  },
  pictureLabelCell: {
    alignSelf: 'end',
  },
  pictureLabel: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: SECONDARY_COLOR,
    marginTop: 8,
    marginBottom: 2,
  },
  framed: {
    borderWidth: 1,
    borderColor: SEPARATOR_COLOR,
  },
  threeUp: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    columnGap: 6,
  },
  columnTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: SECONDARY_COLOR,
    textAlign: 'center',
  },
  spanningLabel: {
    gridColumnStart: 1,
    gridColumnEnd: -1,
  },
  shadowTable: {
    display: 'grid',
    gridTemplateColumns: '48px minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'center',
    rowGap: 20,
    paddingTop: 14,
  },
  shadowCell: {
    alignItems: 'center',
    rowGap: 10,
  },
  shadowBox: {
    width: 96,
    height: 28,
    borderRadius: 8,
    backgroundColor: CARD_COLOR,
  },
  borderTable: {
    display: 'grid',
    gridTemplateColumns: '48px repeat(3, minmax(0, 1fr))',
    columnGap: 8,
    rowGap: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  borderBox: {
    height: 40,
    borderWidth: 6,
    backgroundColor: CARD_COLOR,
  },
  rounded: {
    borderRadius: 12,
  },
  hdrTable: {
    display: 'grid',
    gridTemplateColumns: '128px repeat(2, minmax(0, 1fr)) 24px',
    columnGap: 8,
    rowGap: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  hdrBox: {
    height: 40,
    borderWidth: 1,
    borderColor: SEPARATOR_COLOR,
  },
  mixedBorder: {
    borderColor: 'color(display-p3 1 0 0)',
    borderTopColor: 'rgb(0 0 255)',
  },
  answerRows: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 100px',
    columnGap: 8,
    rowGap: 4,
    alignItems: 'center',
    marginTop: 8,
  },
  labelledRows: {
    display: 'grid',
    gridTemplateColumns: '104px minmax(0, 1fr)',
    columnGap: 8,
    rowGap: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  rowLabel: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: SECONDARY_COLOR,
  },
  sample: {
    fontSize: 18,
    fontWeight: '700',
  },
});

export default {
  title: 'Color spaces (CSS)',
  category: 'UI',
  description:
    'Every CSS color space and platform profile as backgrounds, text, ' +
    'shadows, borders, gradients and transitions, and the color fixtures through ' +
    'Image, with core components only.',
  examples: [
    {
      name: 'gallery',
      title: 'Color spaces',
      fullBleed: true,
      render: () => <Gallery />,
    },
  ],
};
