/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * The table elements lay out as CSS 2.1 §17.5.2.1's fixed table layout: the
 * first row's cell widths size their columns, the rest share what is left,
 * and every row's cells line up in those columns. Before, a table's tags
 * were unknown elements, inline, and a table read as one run of text.
 */

function rectOf(ref: {readonly current: HostInstance | null}) {
  const rect = ref.current?.getBoundingClientRect();
  if (rect == null) {
    throw new Error('element did not render');
  }
  return rect;
}

function columns(refs: ReadonlyArray<{readonly current: HostInstance | null}>) {
  return refs.map(ref => {
    const rect = rectOf(ref);
    return [rect.x, rect.width];
  });
}

test('the first row sizes the columns, and the other rows follow', () => {
  const head = [
    createRef<HostInstance>(),
    createRef<HostInstance>(),
    createRef<HostInstance>(),
  ];
  const body = [
    createRef<HostInstance>(),
    createRef<HostInstance>(),
    createRef<HostInstance>(),
  ];
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <table style={{width: 400, borderCollapse: 'collapse'}}>
        {/* $FlowFixMe[prop-missing] */}
        <thead>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <th ref={head[0]} style={{width: 100, padding: 0}}>
              Name
            </th>
            {/* $FlowFixMe[prop-missing] */}
            <th ref={head[1]} style={{padding: 0}}>
              Status
            </th>
            {/* $FlowFixMe[prop-missing] */}
            <th ref={head[2]} style={{padding: 0}}>
              Updated
            </th>
          </tr>
        </thead>
        {/* $FlowFixMe[prop-missing] */}
        <tbody>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={body[0]}>Item one, with a longer name</td>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={body[1]}>active</td>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={body[2]}>2025-01-15</td>
          </tr>
        </tbody>
      </table>,
    );
  });

  expect(columns(head)).toEqual([
    [0, 100],
    [100, 150],
    [250, 150],
  ]);
  expect(columns(body)).toEqual(columns(head));
  // The body row sits below the head row
  expect(rectOf(body[0]).y).toBeGreaterThanOrEqual(
    rectOf(head[0]).y + rectOf(head[0]).height,
  );
});

test('a cell spans columns, and separate borders are spaced 2px apart', () => {
  const first = [createRef<HostInstance>(), createRef<HostInstance>()];
  const spanning = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <table style={{width: 206}}>
        {/* $FlowFixMe[prop-missing] */}
        <tbody>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={first[0]}>a</td>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={first[1]}>b</td>
          </tr>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={spanning} colSpan={2}>
              both
            </td>
          </tr>
        </tbody>
      </table>,
    );
  });

  // 2px around the edge and between the cells: (206 - 3 × 2) / 2 = 100 each
  expect(columns(first)).toEqual([
    [2, 100],
    [104, 100],
  ]);
  expect(columns([spanning])).toEqual([[2, 202]]);
});

test("a cell's max-width does not squeeze it inside its column", () => {
  const cell = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <table style={{width: 300, borderCollapse: 'collapse'}}>
        {/* $FlowFixMe[prop-missing] */}
        <tbody>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={cell} style={{maxWidth: 0, minWidth: 60, padding: 12}}>
              Item one
            </td>
            {/* $FlowFixMe[prop-missing] */}
            <td>active</td>
          </tr>
        </tbody>
      </table>,
    );
  });

  expect(columns([cell])).toEqual([[0, 150]]);
});

test('a cell places its content in the middle of its row by default', () => {
  const middle = createRef<HostInstance>();
  const top = createRef<HostInstance>();
  const root = Fantom.createRoot();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <table style={{width: 300, borderCollapse: 'collapse'}}>
        {/* $FlowFixMe[prop-missing] */}
        <tbody>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td style={{padding: 0}}>
              {/* $FlowFixMe[prop-missing] */}
              <div style={{height: 60}} />
            </td>
            {/* $FlowFixMe[prop-missing] */}
            <td style={{padding: 0}}>
              {/* $FlowFixMe[prop-missing] */}
              <div ref={middle} style={{height: 20}} />
            </td>
            {/* $FlowFixMe[prop-missing] */}
            <td style={{padding: 0, verticalAlign: 'top'}}>
              {/* $FlowFixMe[prop-missing] */}
              <div ref={top} style={{height: 20}} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
  });

  expect(rectOf(middle).y).toBe(20);
  expect(rectOf(top).y).toBe(0);
});

test("a cell's width change keeps its column, and a huge colSpan is clamped", () => {
  const first = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const render = (width: number) =>
    Fantom.runTask(() => {
      root.render(
        // $FlowFixMe[prop-missing] elements from the catalog
        <table style={{width: 200, borderCollapse: 'collapse'}}>
          {/* $FlowFixMe[prop-missing] */}
          <tbody>
            {/* $FlowFixMe[prop-missing] */}
            <tr>
              {/* $FlowFixMe[prop-missing] */}
              <td ref={first} style={{width, padding: 0}}>
                a
              </td>
              {/* $FlowFixMe[prop-missing] */}
              <td ref={second} style={{padding: 0}}>
                b
              </td>
            </tr>
            {/* $FlowFixMe[prop-missing] */}
            <tr>
              {/* $FlowFixMe[prop-missing] */}
              <td colSpan={200000}>wide</td>
            </tr>
          </tbody>
        </table>,
      );
    });
  render(50);
  expect(columns([first, second])).toEqual([
    [0, 50],
    [50, 150],
  ]);
  render(80);
  expect(columns([first, second])).toEqual([
    [0, 80],
    [80, 120],
  ]);
});

test('border-spacing takes two axes, and a row aligns its cells', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const short = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] elements from the catalog
      <table style={{width: 230, borderSpacing: '10px 20px'}}>
        {/* $FlowFixMe[prop-missing] */}
        <tbody>
          {/* $FlowFixMe[prop-missing] */}
          <tr style={{verticalAlign: 'bottom'}}>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={a} style={{padding: 0}}>
              {/* $FlowFixMe[prop-missing] */}
              <div style={{height: 60}} />
            </td>
            {/* $FlowFixMe[prop-missing] */}
            <td style={{padding: 0}}>
              {/* $FlowFixMe[prop-missing] */}
              <div ref={short} style={{height: 20}} />
            </td>
          </tr>
          {/* $FlowFixMe[prop-missing] */}
          <tr>
            {/* $FlowFixMe[prop-missing] */}
            <td ref={b} style={{padding: 0}}>
              x
            </td>
          </tr>
        </tbody>
      </table>,
    );
  });
  // 10px around and between the columns: (230 - 3 × 10) / 2 = 100
  expect(columns([a])).toEqual([[10, 100]]);
  // 20px above the first row and between the rows
  expect(rectOf(a).y).toBe(20);
  expect(rectOf(b).y).toBe(20 + 60 + 20);
  // The row's `bottom` reaches the cell that states none
  expect(rectOf(short).y).toBe(20 + 40);
});

function twoCellTable(
  tableWidth: number,
  widths: [?number, ?number],
  cells: ReadonlyArray<React.RefObject<HostInstance | null>>,
  tableRef: React.RefObject<HostInstance | null>,
  colWidths: ?[?number, ?number] = null,
): React.MixedElement {
  return (
    // $FlowFixMe[prop-missing] elements from the catalog
    <table
      ref={tableRef}
      style={{width: tableWidth, borderCollapse: 'collapse'}}>
      {colWidths != null ? (
        // $FlowFixMe[prop-missing]
        <colgroup>
          {/* $FlowFixMe[prop-missing] */}
          <col style={colWidths[0] != null ? {width: colWidths[0]} : null} />
          {/* $FlowFixMe[prop-missing] */}
          <col style={colWidths[1] != null ? {width: colWidths[1]} : null} />
        </colgroup>
      ) : null}
      {/* $FlowFixMe[prop-missing] */}
      <tbody>
        {/* $FlowFixMe[prop-missing] */}
        <tr>
          {/* $FlowFixMe[prop-missing] */}
          <td ref={cells[0]} style={{width: widths[0], padding: 0}}>
            a
          </td>
          {/* $FlowFixMe[prop-missing] */}
          <td ref={cells[1]} style={{width: widths[1], padding: 0}}>
            b
          </td>
        </tr>
      </tbody>
    </table>
  );
}

test('sized columns share a wider table, and a narrower one grows to them', () => {
  const cells = [createRef<HostInstance>(), createRef<HostInstance>()];
  const table = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(twoCellTable(300, [50, 100], cells, table));
  });
  // 150 spare, in proportion 50:100
  expect(columns(cells)).toEqual([
    [0, 100],
    [100, 200],
  ]);
  Fantom.runTask(() => {
    root.render(twoCellTable(100, [100, 100], cells, table));
  });
  expect(rectOf(table).width).toBe(200);
  expect(columns(cells)).toEqual([
    [0, 100],
    [100, 100],
  ]);
});

test('a col gives its column a width before the first row does', () => {
  const cells = [createRef<HostInstance>(), createRef<HostInstance>()];
  const table = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(twoCellTable(300, [null, null], cells, table, [50, null]));
  });
  expect(columns(cells)).toEqual([
    [0, 50],
    [50, 250],
  ]);
});

function sizedTable(
  tableWidth: number,
  widths: ReadonlyArray<number | string | null>,
  cells: ReadonlyArray<React.RefObject<HostInstance | null>>,
  tableRef: React.RefObject<HostInstance | null>,
): React.MixedElement {
  return (
    // $FlowFixMe[prop-missing] elements from the catalog
    <table
      ref={tableRef}
      style={{width: tableWidth, borderCollapse: 'collapse'}}>
      {/* $FlowFixMe[prop-missing] */}
      <tbody>
        {/* $FlowFixMe[prop-missing] */}
        <tr>
          {widths.map((width, index) => (
            // $FlowFixMe[prop-missing]
            <td key={index} ref={cells[index]} style={{width, padding: 0}}>
              x
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

// Each column's width, within a physical pixel (a third of a point) of
// Mobile Safari's for the same table (iOS 27 simulator): layout places edges
// on the pixel grid, where Safari reports fractions
function expectWidths(
  refs: ReadonlyArray<{readonly current: HostInstance | null}>,
  safari: ReadonlyArray<number>,
): void {
  const widths = refs.map(ref => rectOf(ref).width);
  widths.forEach((width, index) => {
    expect(Math.abs(width - safari[index])).toBeLessThanOrEqual(0.34);
  });
}

test('percentage columns share what the pixel columns leave', () => {
  const widths = [48, '66.667%', '33.333%', 200, 150, 120, 160, 110];
  const cells = widths.map(() => createRef<HostInstance>());
  const table = createRef<HostInstance>();
  const root = Fantom.createRoot({viewportWidth: 1400});
  Fantom.runTask(() => {
    root.render(sizedTable(1328, widths, cells, table));
  });
  expect(rectOf(table).width).toBe(1328);
  expectWidths(cells, [48, 360, 180, 200, 150, 120, 160, 110]);
});

test('percentage columns alone share the table in proportion', () => {
  const cells = [createRef<HostInstance>(), createRef<HostInstance>()];
  const table = createRef<HostInstance>();
  const root = Fantom.createRoot({viewportWidth: 1100});
  Fantom.runTask(() => {
    root.render(sizedTable(1000, ['20%', '30%'], cells, table));
  });
  expectWidths(cells, [400, 600]);
  Fantom.runTask(() => {
    root.render(sizedTable(1000, ['80%', '60%'], cells, table));
  });
  expectWidths(cells, [571.43, 428.57]);
});

test('pixel columns wider than the table leave a percentage column empty', () => {
  const cells = [createRef<HostInstance>(), createRef<HostInstance>()];
  const table = createRef<HostInstance>();
  const root = Fantom.createRoot({viewportWidth: 1000});
  Fantom.runTask(() => {
    root.render(sizedTable(600, [700, '50%'], cells, table));
  });
  expect(rectOf(table).width).toBe(700);
  expectWidths(cells, [700, 0]);
});
