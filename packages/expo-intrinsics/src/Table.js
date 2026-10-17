/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {StyleSheet} from 'react-native';

/**
 * The table elements (HTML §4.9) laid out as CSS 2.1 §17's fixed table layout,
 * over the grid the engine has: each row is a grid with the table's column
 * template, so the cells of every row line up and a row still draws its own
 * background and borders. The template comes from the first row (§17.5.2.1):
 * a cell's `width` sizes the columns it spans, and the columns nothing sizes
 * share what is left equally. Where every column is sized, the widths follow
 * WebKit's fixed table layout, which Mobile Safari answers with: percentage
 * columns share what the pixel columns leave, in proportion to their
 * percentages, and without percentage columns the pixel columns grow in
 * proportion to their widths.
 *
 * DOM-CSS-LIMITATION(table-percent-columns-need-the-width): two cases need the
 * table's laid-out width, which the template is written without. Pixel and
 * percentage columns that leave part of the table unfilled keep their pixel
 * widths and give the percentage columns the rest, where WebKit grows every
 * column in proportion; and percentage columns beside a column nothing sizes
 * are percentages of the table, where WebKit, when they overflow it, shares
 * what the pixel columns leave among them and leaves the unsized column empty.
 *
 * DOM-CSS-LIMITATION(table-layout-auto-is-fixed): `table-layout: auto` (the
 * HTML default) is laid out as `fixed` — columns are not sized from the
 * content of every row, which needs each cell's min- and max-content first.
 * DOM-CSS-LIMITATION(table-rowspan): a cell's `rowSpan` does not reach into the
 * next row, since each row is its own grid; `colSpan` spans columns.
 * DOM-CSS-LIMITATION(table-cell-vertical-align): a cell's `vertical-align` of
 * `top`, `middle` or `bottom` places its content as `align-content` does on a
 * block (`baseline` is `top`); cells are not aligned on a shared baseline.
 */

type Column = {readonly width: number | string | null};

// `border-spacing`'s two axes, between columns and between rows
type Spacing = {readonly inline: number, readonly block: number};

// The first row to lay out claims the template; the others follow it. Stable
// for the table's life, so a row lets go only when it unmounts.
type TableRows = {
  readonly claim: (row: {...}) => boolean,
  readonly release: (row: {...}) => void,
  readonly report: (row: {...}, columns: ReadonlyArray<Column>) => void,
  // `<col>` elements, in mount order, and a change to one
  readonly registerCol: (col: CellEntry) => void,
  readonly unregisterCol: (col: CellEntry) => void,
  readonly colChanged: () => void,
};

type TableState = {
  readonly template: ?string,
  readonly spacing: Spacing,
  readonly rows: TableRows,
};

// What a cell tells its row, kept in the order the cells mounted and updated
// in place, so a change to one cell's width does not move its column
type CellEntry = {span: number, width: unknown};

type RowCells = {
  readonly register: (cell: CellEntry) => void,
  readonly unregister: (cell: CellEntry) => void,
  // A cell's span or width changed: the first row reports its columns again
  readonly changed: () => void,
};

const TableContext: React.Context<?TableState> = createContext(null);
const RowContext: React.Context<?RowCells> = createContext(null);
// The `vertical-align` a row or row group gives the cells that state none
const AlignContext: React.Context<?string> = createContext(null);

type ElementProps = {
  children?: React.Node,
  style?: unknown,
  // The style engine's mark that it styles the element, and the element's ref
  cssEngine?: boolean,
  ref?: unknown,
  ...
};

const NO_SPACING: Spacing = {inline: 0, block: 0};

/*
 * Where the renderer's style engine styles the page (the element carries
 * `cssEngine`), a table part has no resolved style in its props: what its
 * layout reads — a cell's width, a table's border spacing — is asked of the
 * engine once the element is committed, and a change renders it again.
 */
function engineComputedStyle(instance: unknown): ?{[string]: unknown} {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const engine = globalThis.__cssEngine;
  // The Fabric host instance's shadow node
  const node = (instance as $FlowFixMe)?.__internalInstanceHandle?.stateNode
    ?.node;
  if (engine == null || node == null) {
    return null;
  }
  return engine.computedStyle(node);
}

// The width the renderer's style engine gave an element, read once the
// element is committed. Read after every render, because the engine styles
// the element in the commit that follows it; the previous value is kept when
// nothing changed, which ends the chain of updates.
function useEngineWidth(
  engineStyled: boolean,
  hostRef: {current: unknown},
): unknown {
  const [engineWidth, setEngineWidth] = useState<unknown>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!engineStyled) {
      return;
    }
    const next = engineComputedStyle(hostRef.current)?.width ?? null;
    setEngineWidth(previous => (previous === next ? previous : next));
  });
  return engineWidth;
}

// A ref that sets each of `refs`
function useMergedRef(
  own: {current: unknown},
  authored: unknown,
): (instance: unknown) => void {
  const authoredRef = useRef(authored);
  authoredRef.current = authored;
  return useCallback(
    (instance: unknown) => {
      own.current = instance;
      const author: $FlowFixMe = authoredRef.current;
      if (typeof author === 'function') {
        author(instance);
      } else if (author != null && typeof author === 'object') {
        author.current = instance;
      }
    },
    [own],
  );
}

// `border-spacing` when the borders are separate, one length for both axes or
// the horizontal then the vertical, the user agent's 2px unless the author's
// style says otherwise; nothing when they collapse
function spacingOf(flat: {readonly [string]: unknown}): Spacing {
  if (flat.borderCollapse === 'collapse') {
    return NO_SPACING;
  }
  const spacing = flat.borderSpacing;
  if (typeof spacing === 'number') {
    return {inline: spacing, block: spacing};
  }
  if (typeof spacing === 'string') {
    const [inline, block] = spacing
      .trim()
      .split(/\s+/)
      .map(part => parseFloat(part));
    if (Number.isFinite(inline)) {
      return {inline, block: Number.isFinite(block) ? block : inline};
    }
  }
  return {inline: 2, block: 2};
}

// What the host view takes: the table-only properties are this layer's
const TABLE_ONLY_PROPERTIES = [
  'borderCollapse',
  'borderSpacing',
  'tableLayout',
  'captionSide',
  'emptyCells',
];

function withoutTableProperties(flat: {[string]: unknown}): {
  [string]: unknown,
} {
  const out = {...flat};
  for (const key of TABLE_ONLY_PROPERTIES) {
    delete out[key];
  }
  return out;
}

/**
 * The grid template of a fixed table's columns: a pixel or percentage width
 * divided over the columns its cell spans, and `minmax(0, 1fr)` for a column
 * nothing sized, so those share the remaining width equally.
 */
export function columnTemplate(columns: ReadonlyArray<Column>): string {
  // Width a table has beyond its columns goes to the columns nothing sized
  // (§17.5.2.1). When every column is sized, percentage columns share what
  // the pixel columns leave, in proportion to their percentages, and without
  // them the pixel columns grow in proportion to their widths, as WebKit
  // lays out a fixed table.
  const anyAuto = columns.some(
    column => pixelsOf(column) == null && percentOf(column) == null,
  );
  const anyPercent = columns.some(column => percentOf(column) != null);
  return columns
    .map(column => {
      const pixels = pixelsOf(column);
      if (pixels != null) {
        return anyAuto || anyPercent || pixels === 0
          ? `${pixels}px`
          : `minmax(${pixels}px, ${pixels}fr)`;
      }
      const percent = percentOf(column);
      if (percent != null) {
        return anyAuto ? `${percent}%` : `minmax(0, ${percent}fr)`;
      }
      return 'minmax(0, 1fr)';
    })
    .join(' ');
}

function pixelsOf(column: Column): ?number {
  const width = column.width;
  if (typeof width === 'number') {
    return width;
  }
  const match =
    typeof width === 'string' ? /^([\d.]+)px$/.exec(width.trim()) : null;
  return match == null ? null : parseFloat(match[1]);
}

function percentOf(column: Column): ?number {
  const width = column.width;
  const match =
    typeof width === 'string' ? /^([\d.]+)%$/.exec(width.trim()) : null;
  return match == null ? null : parseFloat(match[1]);
}

// A table is at least as wide as its sized columns and the spacing around
// them, whatever width it states (§17.5.2.1). Percentage columns that share
// what the pixel columns leave can be empty; beside a column nothing sizes
// they are percentages of the table, and the sum is not known up front.
function columnsMinWidth(
  columns: ReadonlyArray<Column>,
  spacing: Spacing,
): ?number {
  const anyAuto = columns.some(
    column => pixelsOf(column) == null && percentOf(column) == null,
  );
  let sum = spacing.inline * (columns.length + 1);
  for (const column of columns) {
    if (percentOf(column) != null) {
      if (anyAuto) {
        return null;
      }
      continue;
    }
    sum += pixelsOf(column) ?? 0;
  }
  return sum;
}

// `<col>` widths come before the first row's cells, column by column
function mergeColumns(
  fromCols: ReadonlyArray<Column>,
  fromRow: ReadonlyArray<Column>,
): Array<Column> {
  const merged: Array<Column> = [];
  const count = Math.max(fromCols.length, fromRow.length);
  for (let i = 0; i < count; i++) {
    const width = fromCols[i]?.width ?? null;
    merged.push(width != null ? {width} : (fromRow[i] ?? {width: null}));
  }
  return merged;
}

function sameColumns(
  a: ?ReadonlyArray<Column>,
  b: ReadonlyArray<Column>,
): boolean {
  return (
    a != null &&
    a.length === b.length &&
    a.every((column, i) => column.width === b[i].width)
  );
}

// HTML clamps a cell's `colspan` to 1000 (§4.9.11)
const MAX_SPAN = 1000;

function spanOf(colSpan: unknown): number {
  if (typeof colSpan !== 'number' || !(colSpan > 1)) {
    return 1;
  }
  return Math.min(MAX_SPAN, Math.floor(colSpan));
}

// A cell's `width` split over the columns it spans
function appendColumnsOf(entry: CellEntry, columns: Array<Column>): void {
  const span = Math.max(1, entry.span);
  const width = entry.width;
  let each: number | string | null = null;
  if (typeof width === 'number') {
    each = width / span;
  } else if (typeof width === 'string') {
    const match = /^([\d.]+)(px|%)$/.exec(width.trim());
    if (match != null) {
      each = `${parseFloat(match[1]) / span}${match[2]}`;
    }
  }
  for (let i = 0; i < span; i++) {
    columns.push({width: each});
  }
}

function verticalAlignOf(style: unknown): ?string {
  const flat: ?{readonly [string]: unknown} = StyleSheet.flatten(
    style as $FlowFixMe,
  ) as $FlowFixMe;
  const value = flat?.verticalAlign;
  return typeof value === 'string' ? value : null;
}

export function makeTable(): React.ComponentType<ElementProps> {
  const Host: $FlowFixMe = 'element-table';
  function Table({style, children, ...rest}: ElementProps): React.Node {
    const engineStyled = rest.cssEngine === true;
    const hostRef = useRef<unknown>(null);
    const ref = useMergedRef(hostRef, rest.ref);
    const [engineFlat, setEngineFlat] = useState<?{[string]: unknown}>(null);
    // Read after every render, once committed, as `useEngineWidth` does
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
      if (!engineStyled) {
        return;
      }
      const computed = engineComputedStyle(hostRef.current) ?? {};
      const next = {
        borderSpacing: computed.borderSpacing,
        borderCollapse: computed.borderCollapse,
      };
      setEngineFlat(previous =>
        previous != null &&
        previous.borderSpacing === next.borderSpacing &&
        previous.borderCollapse === next.borderCollapse
          ? previous
          : next,
      );
    });
    const flat: {[string]: unknown} = engineStyled
      ? (engineFlat ?? {})
      : ((StyleSheet.flatten(style as $FlowFixMe) as $FlowFixMe) ?? {});
    const spacing = spacingOf(flat);
    const [rowColumns, setColumns] = useState<?ReadonlyArray<Column>>(null);
    const firstRow = useRef<?{...}>(null);
    const cols = useRef<Set<CellEntry>>(new Set());
    const [colVersion, setColVersion] = useState(0);
    const colColumns = useMemo(() => {
      const out: Array<Column> = [];
      for (const col of cols.current) {
        appendColumnsOf(col, out);
      }
      return out;
      // Recomputed when a <col> registers, changes or leaves
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colVersion]);
    const columns =
      rowColumns == null && colColumns.length === 0
        ? null
        : mergeColumns(colColumns, rowColumns ?? []);
    const template = columns == null ? null : columnTemplate(columns);
    const minWidth = columns == null ? null : columnsMinWidth(columns, spacing);
    const rows = useMemo<TableRows>(
      () => ({
        claim(row) {
          if (firstRow.current == null) {
            firstRow.current = row;
          }
          return firstRow.current === row;
        },
        release(row) {
          if (firstRow.current === row) {
            firstRow.current = null;
            setColumns(null);
          }
        },
        report(row, next) {
          if (firstRow.current === row) {
            setColumns(previous =>
              sameColumns(previous, next) ? previous : next,
            );
          }
        },
        registerCol(col) {
          cols.current.add(col);
          setColVersion(version => version + 1);
        },
        unregisterCol(col) {
          cols.current.delete(col);
          setColVersion(version => version + 1);
        },
        colChanged() {
          setColVersion(version => version + 1);
        },
      }),
      [],
    );
    const table = useMemo<TableState>(
      () => ({template, spacing, rows}),
      // The spacing's two numbers, not the object made on every render
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [template, spacing.inline, spacing.block, rows],
    );
    const hasSpacing = spacing.inline > 0 || spacing.block > 0;
    return (
      <TableContext.Provider value={table}>
        <Host
          {...rest}
          ref={ref}
          nodeName="table"
          style={[
            hasSpacing
              ? {
                  paddingHorizontal: spacing.inline,
                  paddingVertical: spacing.block,
                  rowGap: spacing.block,
                }
              : null,
            engineStyled ? null : withoutTableProperties(flat),
            minWidth != null &&
            !(typeof flat.minWidth === 'number' && flat.minWidth >= minWidth)
              ? {minWidth}
              : null,
          ]}>
          {children}
        </Host>
      </TableContext.Provider>
    );
  }
  Table.displayName = '<table>';
  return Table;
}

export function makeRowGroup(tag: string): React.ComponentType<ElementProps> {
  const Host: $FlowFixMe = `element-${tag}`;
  function RowGroup({style, ...rest}: ElementProps): React.Node {
    const table = useContext(TableContext);
    const block = table?.spacing.block ?? 0;
    const inherited = useContext(AlignContext);
    const align = verticalAlignOf(style) ?? inherited;
    return (
      <AlignContext.Provider value={align}>
        <Host
          {...rest}
          nodeName={tag}
          style={[block > 0 ? {rowGap: block} : null, style]}
        />
      </AlignContext.Provider>
    );
  }
  RowGroup.displayName = `<${tag}>`;
  return RowGroup;
}

// Before the first row has reported, a row shares its own width equally among
// its cells, which is what a fixed table with no widths comes to anyway
const ROW_BEFORE_COLUMNS = {
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
};

export function makeRow(): React.ComponentType<ElementProps> {
  const Host: $FlowFixMe = 'element-tr';
  function Row({style, ...rest}: ElementProps): React.Node {
    const table = useContext(TableContext);
    const tableRows = table?.rows;
    const identity = useRef<{...}>({});
    const cells = useRef<Set<CellEntry>>(new Set());
    // The latest table, for the stable cell API to report to
    const tableRowsRef = useRef(tableRows);
    tableRowsRef.current = tableRows;
    // Cleared as the row unmounts, so its cells' cleanups, which may run after
    // the row has let the table go, do not claim it again
    const live = useRef(true);
    const row = useMemo<RowCells>(() => {
      const report = () => {
        const rows = tableRowsRef.current;
        if (!live.current || rows == null || !rows.claim(identity.current)) {
          return;
        }
        const columns: Array<Column> = [];
        for (const entry of cells.current) {
          appendColumnsOf(entry, columns);
        }
        rows.report(identity.current, columns);
      };
      return {
        register(cell) {
          cells.current.add(cell);
        },
        unregister(cell) {
          cells.current.delete(cell);
        },
        changed: report,
      };
    }, []);
    // After the cells' own effects, which run first: the first row tells the
    // table its columns
    useLayoutEffect(() => {
      row.changed();
    });
    useLayoutEffect(() => {
      const self = identity.current;
      live.current = true;
      return () => {
        live.current = false;
        tableRows?.release(self);
      };
    }, [tableRows]);
    const inherited = useContext(AlignContext);
    const align = verticalAlignOf(style) ?? inherited;
    const inline = table?.spacing.inline ?? 0;
    const template = table?.template;
    return (
      <RowContext.Provider value={row}>
        <AlignContext.Provider value={align}>
          <Host
            {...rest}
            nodeName="tr"
            style={[
              template != null
                ? {gridTemplateColumns: template}
                : ROW_BEFORE_COLUMNS,
              inline > 0 ? {columnGap: inline} : null,
              style,
            ]}
          />
        </AlignContext.Provider>
      </RowContext.Provider>
    );
  }
  Row.displayName = '<tr>';
  return Row;
}

type CellProps = {
  ...ElementProps,
  colSpan?: ?number,
  rowSpan?: ?number,
  ...
};

const CELL_ALIGNMENT: {readonly [string]: string} = {
  top: 'flex-start',
  baseline: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

export function makeCell(tag: 'td' | 'th'): React.ComponentType<CellProps> {
  const Host: $FlowFixMe = `element-${tag}`;
  function Cell({style, colSpan, rowSpan, ...rest}: CellProps): React.Node {
    const row = useContext(RowContext);
    const inheritedAlign = useContext(AlignContext);
    const engineStyled = rest.cssEngine === true;
    const hostRef = useRef<unknown>(null);
    const ref = useMergedRef(hostRef, rest.ref);
    const engineWidth = useEngineWidth(engineStyled, hostRef);
    const flat: {[string]: unknown} =
      (StyleSheet.flatten(style as $FlowFixMe) as $FlowFixMe) ?? {};
    const span = spanOf(colSpan);
    const width = engineStyled ? engineWidth : (flat.width ?? null);
    const entry = useRef<CellEntry>({span, width}).current;
    // Registered once, so the cell keeps its place among the row's cells
    useLayoutEffect(() => {
      row?.register(entry);
      return () => {
        row?.unregister(entry);
        row?.changed();
      };
    }, [row, entry]);
    useLayoutEffect(() => {
      if (entry.span !== span || entry.width !== width) {
        entry.span = span;
        entry.width = width;
        row?.changed();
      }
    }, [row, entry, span, width]);
    // The cell's width is its column's (§17.5.2.1): the box itself fills the
    // track it is placed in. `min-width` and `max-width` on a cell are
    // undefined in CSS 2.1 (§17.5) and browsers do not apply `max-width`,
    // which `max-width: 0` with an ellipsis relies on; applied to the box,
    // they squeezed it to its padding.
    const {
      width: _width,
      minWidth: _minWidth,
      maxWidth: _maxWidth,
      verticalAlign,
      ...cellStyle
    } = withoutTableProperties(flat);
    // `vertical-align` places the content in the cell, which stretches to its
    // row (§17.5.4): the cell's own, else its row's or row group's, else
    // `middle`, as the user agent's sheet gives rows and row groups
    const align =
      typeof verticalAlign === 'string' ? verticalAlign : inheritedAlign;
    const alignContent = CELL_ALIGNMENT[align ?? ''] ?? 'center';
    return (
      <Host
        {...rest}
        ref={ref}
        nodeName={tag}
        style={[
          {alignContent},
          span > 1 ? {gridColumnEnd: `span ${span}`} : null,
          cellStyle,
        ]}
      />
    );
  }
  Cell.displayName = `<${tag}>`;
  return Cell;
}

type ColProps = {
  ...ElementProps,
  span?: ?number,
  ...
};

// `<col>`: no box of its own, a width for the columns it spans
export function makeCol(): React.ComponentType<ColProps> {
  const Host: $FlowFixMe = 'element-col';
  function Col({style, span: spanProp, ...rest}: ColProps): React.Node {
    const table = useContext(TableContext);
    const tableRows = table?.rows;
    const engineStyled = rest.cssEngine === true;
    const hostRef = useRef<unknown>(null);
    const ref = useMergedRef(hostRef, rest.ref);
    const engineWidth = useEngineWidth(engineStyled, hostRef);
    const flat: {[string]: unknown} =
      (StyleSheet.flatten(style as $FlowFixMe) as $FlowFixMe) ?? {};
    const span = spanOf(spanProp);
    const width = engineStyled ? engineWidth : (flat.width ?? null);
    const entry = useRef<CellEntry>({span, width}).current;
    useLayoutEffect(() => {
      tableRows?.registerCol(entry);
      return () => tableRows?.unregisterCol(entry);
    }, [tableRows, entry]);
    useLayoutEffect(() => {
      if (entry.span !== span || entry.width !== width) {
        entry.span = span;
        entry.width = width;
        tableRows?.colChanged();
      }
    }, [tableRows, entry, span, width]);
    return <Host {...rest} ref={ref} nodeName="col" style={style} />;
  }
  Col.displayName = '<col>';
  return Col;
}

export const TABLE_SECTION_TAGS: ReadonlyArray<string> = [
  'thead',
  'tbody',
  'tfoot',
];
