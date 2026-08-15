/**
 * Emits an RNTester screen that renders the whole conformance corpus and
 * publishes every measured rect, so the cases can be checked on a REAL device
 * rather than only in Fantom.
 *
 * Fantom runs the same engine, but it runs it in a deterministic harness: one
 * thread, a stub measurer, no platform layout pass, no pixel grid. Everything
 * this catches is something that only happens on a device — rounding to the
 * screen's scale factor, the platform's own view sizing, the shadow tree
 * crossing to the UI thread.
 *
 * Measurement is by onLayout, whose coordinates are already relative to the
 * parent — which is exactly what the corpus stores.
 *
 * Usage:
 *   node gen-device-conformance.js > \
 *     ../packages/rn-tester/js/examples/Grid/GridConformanceExample.js
 *
 * @noflow
 * @format
 */

'use strict';

const path = require('node:path');
const {trackToCss, placementToCss} = require('./serialize.js');
const expected = require(path.join(__dirname, 'expected.json'));

function rnStyle(container) {
  if (container.display !== 'grid' && container.display !== 'grid-lanes') {
    return null;
  }
  if (container.oracleLimitation != null) return null;
  if (
    container.autoFlow != null &&
    !['row', 'row dense', 'column', 'column dense'].includes(container.autoFlow)
  ) {
    return null;
  }
  const tracksUnsupported = list =>
    (list ?? []).some(t => {
      const json = JSON.stringify(t);
      return json.includes('min-content') && !json.includes('max-content');
    });
  if (tracksUnsupported(container.cols) || tracksUnsupported(container.rows)) {
    return null;
  }

  const style = {display: container.display};
  // Unlike the Fantom generator, rtl is kept: React Native has a `direction`
  // style and the platforms honour it, so there is no reason to leave the
  // writing-mode half of placement unchecked on a device.
  if (container.direction != null) style.direction = container.direction;
  if (container.width != null) style.width = container.width;
  if (container.height != null) style.height = container.height;
  if (container.cols) {
    style.gridTemplateColumns = container.cols.map(trackToCss).join(' ');
  }
  if (container.rows) {
    style.gridTemplateRows = container.rows.map(trackToCss).join(' ');
  }
  if (container.gap != null) style.gap = container.gap;
  if (container.rowGap != null) style.rowGap = container.rowGap;
  if (container.colGap != null) style.columnGap = container.colGap;
  if (container.padding) style.padding = container.padding;
  if (container.border) {
    style.borderWidth = container.border;
    style.borderColor = 'transparent';
  }
  if (container.autoRows) {
    style.gridAutoRows = container.autoRows.map(trackToCss).join(' ');
  }
  if (container.autoColumns) {
    style.gridAutoColumns = container.autoColumns.map(trackToCss).join(' ');
  }
  if (container.autoFlow) style.gridAutoFlow = container.autoFlow;
  if (container.areas) {
    style.gridTemplateAreas = container.areas.map(r => `"${r}"`).join(' ');
  }
  if (container.flowTolerance != null) {
    style.flowTolerance = container.flowTolerance;
  }
  if (container.fontSize != null) style.fontSize = container.fontSize;
  if (container.gapPercent) style.gap = container.gapPercent;
  if (container.minWidth != null) style.minWidth = container.minWidth;
  if (container.maxWidth != null) style.maxWidth = container.maxWidth;
  if (container.minHeight != null) style.minHeight = container.minHeight;
  if (container.maxHeight != null) style.maxHeight = container.maxHeight;
  if (container.justifyItems) style.justifyItems = container.justifyItems;
  if (container.alignItems) style.alignItems = container.alignItems;
  if (container.justifyContent) style.justifyContent = container.justifyContent;
  if (container.alignContent) style.alignContent = container.alignContent;
  return style;
}

function rnItemStyle(item) {
  const style = {};
  if (item.w != null) style.width = item.w;
  if (item.h != null) style.height = item.h;
  if (item.m != null) style.margin = item.m;
  if (item.p != null) style.padding = item.p;
  if (item.b != null) {
    style.borderWidth = item.b;
    style.borderColor = 'transparent';
  }
  if (item.widthPercent != null) style.width = `${item.widthPercent}%`;
  if (item.aspectRatio != null) style.aspectRatio = item.aspectRatio;
  if (item.area != null) style.gridArea = item.area;
  if (item.colEnd != null) style.gridColumnEnd = item.colEnd;
  if (item.justifySelf) style.justifySelf = item.justifySelf;
  if (item.alignSelf) style.alignSelf = item.alignSelf;
  if (item.displayNone) style.display = 'none';
  if (item.absolute) {
    style.position = 'absolute';
    if (item.top != null) style.top = item.top;
    if (item.left != null) style.left = item.left;
  }
  if (item.col != null) {
    const css = placementToCss(item.col);
    if (css.startsWith('span ')) {
      style.gridColumnEnd = css;
    } else {
      style.gridColumnStart = Number(css);
    }
  }
  if (item.row != null) {
    const css = placementToCss(item.row);
    if (css.startsWith('span ')) {
      style.gridRowEnd = css;
    } else {
      style.gridRowStart = Number(css);
    }
  }
  return style;
}

const usable = [];
let skipped = 0;
for (const c of expected.cases) {
  const style = rnStyle(c.container);
  // An empty container is kept: its own size is still an assertion, and a
  // grid with no items is exactly where an off-by-one in track sizing hides.
  if (style == null || c.items.some(i => i.order != null)) {
    skipped++;
    continue;
  }
  usable.push({
    id: c.id,
    tier: c.tier,
    style,
    items: c.items.map((it, i) => ({
      style: rnItemStyle(it),
      childHeight: it.childHeight ?? null,
    })),
    expected: c.expected,
  });
}

const json = v => JSON.stringify(v);
const out = [];
const w = s => out.push(s);

w('/**');
w(' * Copyright (c) Meta Platforms, Inc. and affiliates.');
w(' *');
w(' * This source code is licensed under the MIT license found in the');
w(' * LICENSE file in the root directory of this source tree.');
w(' *');
w(' * @flow strict-local');
w(' * @format');
w(' * @generated by grid-lanes-conformance/gen-device-conformance.js');
w(' */');
w('');
w('/**');
w(' * The grid / grid-lanes conformance corpus, rendered on a real device.');
w(' *');
w(' * Every expected value was measured in Safari; this screen renders the same');
w(' * cases through the platform and publishes what they actually measured, for');
w(' * packages/rn-tester/scripts/grid-conformance-verify.js to compare.');
w(' *');
w(' * Fantom runs the same engine, so this is not about the algorithm — it is');
w(' * about everything Fantom does not have: the pixel grid, the platform view');
w(' * sizing, the shadow tree crossing to the UI thread.');
w(' *');
w(` * ${usable.length} cases; ${skipped} not expressible as RN styles.`);
w(' */');
w('');
w("import * as React from 'react';");
w("import {ScrollView, View} from 'react-native';");
w('');
w('// Each case renders inside a wrapper of the width the oracle used, so the');
w('// device viewport does not change the layout under test. Overflow is fine:');
w('// nothing here is looked at, only measured.');
w('const ORACLE_WIDTH = 900;');
w('');
w('type Rect = {x: number, y: number, w: number, h: number};');
w('');
w('function publish(caseId: string, key: string, rect: Rect) {');
w('  // $FlowFixMe[prop-missing] ad-hoc global for external CDP reads');
w('  const all = globalThis.__gridConformance ?? {};');
w('  const entry = all[caseId] ?? {items: {}};');
w("  if (key === 'container') {");
w('    entry.container = rect;');
w('  } else {');
w('    entry.items[key] = rect;');
w('  }');
w('  all[caseId] = entry;');
w('  // $FlowFixMe[prop-missing] ad-hoc global for external CDP reads');
w('  globalThis.__gridConformance = all;');
w('}');
w('');
w('function Case({');
w('  id,');
w('  containerStyle,');
w('  items,');
w('}: {');
w('  id: string,');
w('  containerStyle: {...},');
w('  items: Array<{style: {...}, childHeight: ?number}>,');
w('}): React.Node {');
w('  return (');
w('    <View style={{width: ORACLE_WIDTH}}>');
w('      <View');
w('        collapsable={false}');
w('        onLayout={e => {');
w('          const {width, height} = e.nativeEvent.layout;');
w("          publish(id, 'container', {x: 0, y: 0, w: width, h: height});");
w('        }}');
w('        /* $FlowExpectedError[incompatible-type] grid style keys */');
w('        style={containerStyle}>');
w('        {items.map((item, i) => (');
w('          <View');
w('            key={i}');
w('            collapsable={false}');
w('            onLayout={e => {');
w('              const {x, y, width, height} = e.nativeEvent.layout;');
w('              publish(id, String(i), {x, y, w: width, h: height});');
w('            }}');
w('            /* $FlowExpectedError[incompatible-type] grid style keys */');
w('            style={item.style}>');
w('            {item.childHeight != null ? (');
w('              <View style={{height: item.childHeight}} />');
w('            ) : null}');
w('          </View>');
w('        ))}');
w('      </View>');
w('    </View>');
w('  );');
w('}');
w('');
w('const CASES: Array<{');
w('  id: string,');
w('  style: {...},');
w('  items: Array<{style: {...}, childHeight: ?number}>,');
w('}> = [');
for (const c of usable) {
  w(
    `  {id: ${json(c.id)}, style: ${json(c.style)}, items: ${json(
      c.items,
    )}},`,
  );
}
w('];');
w('');
w('function AllCases(): React.Node {');
w('  return (');
w('    <ScrollView>');
w('      {CASES.map(c => (');
w('        <Case');
w('          key={c.id}');
w('          id={c.id}');
w('          containerStyle={c.style}');
w('          items={c.items}');
w('        />');
w('      ))}');
w('    </ScrollView>');
w('  );');
w('}');
w('');
w('export default {');
w("  title: 'Grid Conformance',");
w("  category: 'Layout',");
w('  description:');
w("    'Renders the whole grid / grid-lanes conformance corpus and publishes " +
  "every measured rect, for grid-conformance-verify.js to compare against " +
  "Safari. Not meant to be read — meant to be measured.',");
w('  examples: [');
w('    {');
w("      title: 'All cases',");
w("      name: 'all',");
w('      render: (): React.Node => <AllCases />,');
w('    },');
w('  ],');
w('};');

process.stdout.write(out.join('\n') + '\n');
