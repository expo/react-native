/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * A table the style engine styles is laid out by the engine, in the commit
 * that styles it: the first row's cells size the columns (CSS 2.1
 * §17.5.2.1), and every row takes them as its grid template. Before, the
 * runtime read each cell's width back from the engine after the commit and
 * rendered every row again with the template, a second commit for every
 * table and one more whenever a column changed.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

type Ref = {current: $FlowFixMe};

function elementRef(): Ref {
  return React.createRef<$FlowFixMe>();
}

// An element through the Astryx runtime, which the engine styles
function h(
  tag: string,
  props: {[string]: unknown},
  ...children: ReadonlyArray<unknown>
): React.MixedElement {
  return jsx(tag, {
    ...props,
    children: children.length === 1 ? children[0] : children,
  }) as $FlowFixMe;
}

function rectOf(ref: Ref): {
  x: number,
  y: number,
  width: number,
  height: number,
} {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

function columns(refs: ReadonlyArray<Ref>): Array<[number, number]> {
  return refs.map(ref => {
    const rect = rectOf(ref);
    return [rect.x, rect.width];
  });
}

function gridOf(ref: Ref): unknown {
  return (global.getComputedStyle(ref.current) as $FlowFixMe)
    .gridTemplateColumns;
}

test('the first row sizes the columns, and the other rows follow', () => {
  const head = [elementRef(), elementRef(), elementRef()];
  const body = [elementRef(), elementRef(), elementRef()];
  const headRow = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      h(
        'table',
        {style: {width: 400, borderCollapse: 'collapse'}},
        h(
          'thead',
          {key: 'head'},
          h(
            'tr',
            {ref: headRow},
            h(
              'th',
              {key: 0, ref: head[0], style: {width: 100, padding: 0}},
              'Name',
            ),
            h('th', {key: 1, ref: head[1], style: {padding: 0}}, 'Status'),
            h('th', {key: 2, ref: head[2], style: {padding: 0}}, 'Updated'),
          ),
        ),
        h(
          'tbody',
          {key: 'body'},
          h(
            'tr',
            {},
            h('td', {key: 0, ref: body[0]}, 'Item one, with a longer name'),
            h('td', {key: 1, ref: body[1]}, 'active'),
            h('td', {key: 2, ref: body[2]}, '2025-01-15'),
          ),
        ),
      ),
    );
  });

  // The engine wrote the template, not a re-render of the row
  expect(gridOf(headRow)).toBe('100px minmax(0, 1fr) minmax(0, 1fr)');
  expect(columns(head)).toEqual([
    [0, 100],
    [100, 150],
    [250, 150],
  ]);
  expect(columns(body)).toEqual(columns(head));
  expect(rectOf(body[0]).y).toBeGreaterThanOrEqual(
    rectOf(head[0]).y + rectOf(head[0]).height,
  );
});

test('a cell spans columns, and separate borders are spaced 2px apart', () => {
  const first = [elementRef(), elementRef()];
  const spanning = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      h(
        'table',
        {style: {width: 206}},
        h(
          'tbody',
          {},
          h(
            'tr',
            {key: 'first'},
            h('td', {key: 0, ref: first[0]}, 'a'),
            h('td', {key: 1, ref: first[1]}, 'b'),
          ),
          h(
            'tr',
            {key: 'second'},
            h('td', {ref: spanning, colSpan: 2}, 'both'),
          ),
        ),
      ),
    );
  });

  // 2px around the edge and between the cells: (206 - 3 × 2) / 2 = 100 each
  expect(columns(first)).toEqual([
    [2, 100],
    [104, 100],
  ]);
  expect(columns([spanning])).toEqual([[2, 202]]);
});

test("a first-row cell's width change moves its column in every row", () => {
  const first = elementRef();
  const second = elementRef();
  const below = elementRef();
  const root = Fantom.createRoot();
  const render = (width: number) =>
    Fantom.runTask(() => {
      root.render(
        h(
          'table',
          {style: {width: 200, borderCollapse: 'collapse'}},
          h(
            'tbody',
            {},
            h(
              'tr',
              {key: 'first'},
              h('td', {key: 0, ref: first, style: {width, padding: 0}}, 'a'),
              h('td', {key: 1, ref: second, style: {padding: 0}}, 'b'),
            ),
            h(
              'tr',
              {key: 'second'},
              h('td', {key: 0, style: {padding: 0}}, 'c'),
              h('td', {key: 1, ref: below, style: {padding: 0}}, 'd'),
            ),
          ),
        ),
      );
    });
  render(50);
  expect(columns([first, second, below])).toEqual([
    [0, 50],
    [50, 150],
    [50, 150],
  ]);
  render(80);
  expect(columns([first, second, below])).toEqual([
    [0, 80],
    [80, 120],
    [80, 120],
  ]);
});

test('a col gives its column a width before the first row does', () => {
  const cells = [elementRef(), elementRef()];
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      h(
        'table',
        {style: {width: 300, borderCollapse: 'collapse'}},
        h(
          'colgroup',
          {key: 'columns'},
          h('col', {key: 0, style: {width: 50}}),
          h('col', {key: 1}),
        ),
        h(
          'tbody',
          {key: 'body'},
          h(
            'tr',
            {},
            h('td', {key: 0, ref: cells[0], style: {padding: 0}}, 'x'),
            h('td', {key: 1, ref: cells[1], style: {padding: 0}}, 'y'),
          ),
        ),
      ),
    );
  });
  expect(columns(cells)).toEqual([
    [0, 50],
    [50, 250],
  ]);
});

test('sized columns share a wider table, and a narrower one grows to them', () => {
  const cells = [elementRef(), elementRef()];
  const table = elementRef();
  const root = Fantom.createRoot();
  const render = (tableWidth: number, widths: [number, number]) =>
    Fantom.runTask(() => {
      root.render(
        h(
          'table',
          {ref: table, style: {width: tableWidth, borderCollapse: 'collapse'}},
          h(
            'tbody',
            {},
            h(
              'tr',
              {},
              h(
                'td',
                {key: 0, ref: cells[0], style: {width: widths[0], padding: 0}},
                'x',
              ),
              h(
                'td',
                {key: 1, ref: cells[1], style: {width: widths[1], padding: 0}},
                'y',
              ),
            ),
          ),
        ),
      );
    });
  render(300, [50, 100]);
  // 150 spare, in proportion 50:100
  expect(columns(cells)).toEqual([
    [0, 100],
    [100, 200],
  ]);
  render(100, [100, 100]);
  expect(rectOf(table).width).toBe(200);
  expect(columns(cells)).toEqual([
    [0, 100],
    [100, 100],
  ]);
});

test('a table in a cell has columns of its own', () => {
  const outer = [elementRef(), elementRef()];
  const inner = [elementRef(), elementRef()];
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      h(
        'table',
        {style: {width: 300, borderCollapse: 'collapse'}},
        h(
          'tbody',
          {},
          h(
            'tr',
            {},
            h(
              'td',
              {key: 0, ref: outer[0], style: {width: 100, padding: 0}},
              'x',
            ),
            h(
              'td',
              {key: 1, ref: outer[1], style: {padding: 0}},
              h(
                'table',
                {style: {width: 200, borderCollapse: 'collapse'}},
                h(
                  'tbody',
                  {},
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      {key: 0, ref: inner[0], style: {width: 40, padding: 0}},
                      'a',
                    ),
                    h('td', {key: 1, ref: inner[1], style: {padding: 0}}, 'b'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });
  expect(columns(outer)).toEqual([
    [0, 100],
    [100, 200],
  ]);
  expect(columns(inner)).toEqual([
    [100, 40],
    [140, 160],
  ]);
});

test('percentage columns share what the pixel columns leave', () => {
  // Table Filter's header row, whose widths Mobile Safari gives as 48, 360,
  // 180, 200, 150, 120, 160 and 110 points (iOS 27 simulator)
  const widths = [48, '66.667%', '33.333%', 200, 150, 120, 160, 110];
  const cells = widths.map(() => elementRef());
  const root = Fantom.createRoot({viewportWidth: 1400});
  Fantom.runTask(() => {
    root.render(
      h(
        'table',
        {style: {width: 1328, borderCollapse: 'collapse'}},
        h(
          'tbody',
          {},
          h(
            'tr',
            {},
            ...widths.map((width, index) =>
              h(
                'td',
                {key: index, ref: cells[index], style: {width, padding: 0}},
                'x',
              ),
            ),
          ),
        ),
      ),
    );
  });
  // Within a physical pixel (a third of a point): layout places edges on the
  // pixel grid, where Safari reports fractions
  const safari = [48, 360, 180, 200, 150, 120, 160, 110];
  cells.forEach((cell, index) => {
    expect(Math.abs(rectOf(cell).width - safari[index])).toBeLessThanOrEqual(
      0.34,
    );
  });
});
