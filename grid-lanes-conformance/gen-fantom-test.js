/**
 * Emits a Fantom test from the conformance corpus, so React Native's own
 * layout is checked against real Safari geometry rather than against numbers
 * someone typed in.
 *
 * The engine-level harness (replay.cpp) proves Yoga is right. This proves the
 * whole RN path is right: style prop -> track-list parser -> yoga::Style ->
 * layout -> getBoundingClientRect. A bug in the parser or the props wiring
 * shows up here and nowhere else.
 *
 * Usage:
 *   node gen-fantom-test.js > \
 *     ../packages/react-native/Libraries/Components/View/__tests__/Grid-itest.js
 *
 * @noflow
 * @format
 */

'use strict';

const path = require('node:path');
const {trackToCss, placementToCss} = require('./serialize.js');
const expected = require(path.join(__dirname, 'expected.json'));

// Styles React Native can express. Grid-lanes cases and the sizing keywords
// Yoga has no representation for are left out, and counted in the header so
// the coverage claim stays honest.
function rnStyle(container) {
  if (container.display !== 'grid') return null;
  if (container.direction != null && container.direction !== 'ltr') return null;
  if (container.autoFlow != null &&
      !['row', 'row dense', 'column', 'column dense'].includes(container.autoFlow)) {
    return null;
  }

  const style = {display: 'grid'};
  // max-content and fit-content are supported; min-content as a MAXIMUM is
  // not distinguishable from auto in Yoga, so those cases stay out rather
  // than asserting a value the engine cannot mean.
  const tracksUnsupported = list =>
    (list ?? []).some(t => {
      const json = JSON.stringify(t);
      return json.includes('min-content') && !json.includes('max-content');
    });
  if (tracksUnsupported(container.cols) || tracksUnsupported(container.rows)) {
    return null;
  }

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
    // A border with no colour still occupies space, and RN needs the colour to
    // be set for the width to apply.
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
  if (style == null || c.items.length === 0 || c.items.some(i => i.order != null)) {
    skipped++;
    continue;
  }
  usable.push({...c, style, itemStyles: c.items.map(rnItemStyle)});
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
w(' * @generated by grid-lanes-conformance/gen-fantom-test.js');
w(' */');
w('');
w('/**');
w(' * CSS Grid layout, checked end to end through React Native.');
w(' *');
w(' * Every expected number here was measured in real Safari, which implements');
w(' * CSS Grid natively — see grid-lanes-conformance/oracle.js. Nothing in this');
w(' * file is hand-computed.');
w(' *');
w(' * The C++ harness (grid-lanes-conformance/replay.cpp) proves the same cases');
w(' * against Yoga directly. This suite proves the rest of the path: the style');
w(' * prop, the track-list parser, the props wiring, and layout as the app sees');
w(' * it through getBoundingClientRect().');
w(' *');
w(` * ${usable.length} cases; ${skipped} corpus cases are not expressible as RN styles`);
w(' * (grid-lanes, min-content/max-content/fit-content tracks, rtl, order).');
w(' */');
w('');
w("import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';");
w('');
w("import type {HostInstance} from 'react-native';");
w('');
w("import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';");
w("import * as Fantom from '@react-native/fantom';");
w("import * as React from 'react';");
w("import {createRef} from 'react';");
w("import {View} from 'react-native';");
w("import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';");
w('');
w('// Sub-pixel rounding differs between engines; everything else must match.');
w('const TOLERANCE = 0.75;');
w('');
w('// The browser measured every case inside a 900px-wide wrapper.');
w('const VIEWPORT_WIDTH = 900;');
w('');
w('function rectOf(ref: {current: HostInstance | null}) {');
w('  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect();');
w('}');
w('');
w('function expectClose(actual: number, expected: number, what: string) {');
w('  if (Math.abs(actual - expected) > TOLERANCE) {');
w('    throw new Error(');
w('      `${what}: got ${actual}, Safari measured ${expected}`,');
w('    );');
w('  }');
w('}');
w('');

// Group by corpus group so a failure names the feature.
const byGroup = new Map();
for (const c of usable) {
  if (!byGroup.has(c.group)) byGroup.set(c.group, []);
  byGroup.get(c.group).push(c);
}

for (const [group, groupCases] of byGroup) {
  w(`describe(${json(group)}, () => {`);
  for (const c of groupCases) {
    w(`  it(${json(`${c.id}: ${c.note ?? ''}`.trim())}, () => {`);
    w('    const containerRef = createRef<HostInstance>();');
    w(
      `    const itemRefs = [${c.items
        .map(() => 'createRef<HostInstance>()')
        .join(', ')}];`,
    );
    w('    const root = Fantom.createRoot({viewportWidth: VIEWPORT_WIDTH});');
    w('    Fantom.runTask(() => {');
    w('      root.render(');
    w('        <View');
    w('          collapsable={false}');
    w('          ref={containerRef}');
    w(`          /* $FlowExpectedError[incompatible-type] grid style keys */`);
    w(`          style={${json(c.style)}}>`);
    c.itemStyles.forEach((s, i) => {
      const childHeight = c.items[i].childHeight;
      w('          <View');
      w('            collapsable={false}');
      w(`            ref={itemRefs[${i}]}`);
      w(`            /* $FlowExpectedError[incompatible-type] grid style keys */`);
      if (childHeight == null) {
        w(`            style={${json(s)}}`);
        w('          />');
      } else {
        // The item has no height of its own: it must measure this child.
        w(`            style={${json(s)}}>`);
        w(`            <View style={{height: ${childHeight}}} />`);
        w('          </View>');
      }
    });
    w('        </View>,');
    w('      );');
    w('    });');
    w('    const container = rectOf(containerRef);');
    w(
      `    expectClose(container.width, ${c.expected.container.w}, '${c.id} container.width');`,
    );
    w(
      `    expectClose(container.height, ${c.expected.container.h}, '${c.id} container.height');`,
    );
    c.expected.items.forEach((e, i) => {
      w(`    {`);
      w(`      const r = rectOf(itemRefs[${i}]);`);
      w(
        `      expectClose(r.x - container.x, ${e.x}, '${c.id} item[${i}].x');`,
      );
      w(
        `      expectClose(r.y - container.y, ${e.y}, '${c.id} item[${i}].y');`,
      );
      w(`      expectClose(r.width, ${e.w}, '${c.id} item[${i}].w');`);
      w(`      expectClose(r.height, ${e.h}, '${c.id} item[${i}].h');`);
      w(`    }`);
    });
    w('  });');
  }
  w('});');
  w('');
}

process.stdout.write(out.join('\n') + '\n');
