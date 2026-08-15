/**
 * Replays the conformance corpus through Yoga and compares every coordinate
 * against what real Safari produced for the identical CSS.
 *
 * The cases come from cases.js by way of expected.json and fixtures.h, so the
 * geometry asserted here is measured, never hand-written.
 *
 * A case Yoga's API cannot yet express is reported as UNSUPPORTED with the
 * reason, not skipped silently — coverage that shrinks quietly is worse than
 * no coverage, because it reads as a pass.
 *
 * Usage:
 *   replay              # summary plus every failure
 *   replay -v           # every case
 *   replay <substring>  # only cases whose id or group matches
 */

#include <yoga/Yoga.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include "fixtures.h"

using namespace gridconf;

namespace {

constexpr float kTolerance = 0.75f; // sub-pixel rounding differs between engines

bool isSet(float v) {
  return v != kUnset;
}

void applySimple(
    YGNodeRef node,
    bool isColumn,
    size_t index,
    const Track& t) {
  auto set = [&](YGGridTrackType type, float value) {
    if (isColumn) {
      YGNodeStyleSetGridTemplateColumn(node, index, type, value);
    } else {
      YGNodeStyleSetGridTemplateRow(node, index, type, value);
    }
  };
  switch (t.kind) {
    case TrackKind::Points:
      set(YGGridTrackTypePoints, t.value);
      break;
    case TrackKind::Percent:
      set(YGGridTrackTypePercent, t.value);
      break;
    case TrackKind::Fr:
      set(YGGridTrackTypeFr, t.value);
      break;
    case TrackKind::Auto:
      set(YGGridTrackTypeAuto, 0.0f);
      break;
    case TrackKind::Minmax: {
      auto toType = [](TrackKind k) {
        switch (k) {
          case TrackKind::Points:
            return YGGridTrackTypePoints;
          case TrackKind::Percent:
            return YGGridTrackTypePercent;
          case TrackKind::Fr:
            return YGGridTrackTypeFr;
          default:
            return YGGridTrackTypeAuto;
        }
      };
      if (isColumn) {
        YGNodeStyleSetGridTemplateColumnMinMax(
            node,
            index,
            toType(t.min.kind),
            t.min.value,
            toType(t.max.kind),
            t.max.value);
      } else {
        YGNodeStyleSetGridTemplateRowMinMax(
            node,
            index,
            toType(t.min.kind),
            t.min.value,
            toType(t.max.kind),
            t.max.value);
      }
      break;
    }
  }
}

void applyAutoRow(YGNodeRef node, size_t index, const Track& t) {
  switch (t.kind) {
    case TrackKind::Points:
      YGNodeStyleSetGridAutoRow(node, index, YGGridTrackTypePoints, t.value);
      break;
    case TrackKind::Percent:
      YGNodeStyleSetGridAutoRow(node, index, YGGridTrackTypePercent, t.value);
      break;
    case TrackKind::Fr:
      YGNodeStyleSetGridAutoRow(node, index, YGGridTrackTypeFr, t.value);
      break;
    default:
      YGNodeStyleSetGridAutoRow(node, index, YGGridTrackTypeAuto, 0.0f);
      break;
  }
}

void applyPlacement(YGNodeRef node, bool isColumn, const Placement& p) {
  switch (p.kind) {
    case PlacementKind::Auto:
      break;
    case PlacementKind::Line:
      if (isColumn) {
        YGNodeStyleSetGridColumnStart(node, p.value);
      } else {
        YGNodeStyleSetGridRowStart(node, p.value);
      }
      break;
    case PlacementKind::Span:
      if (isColumn) {
        YGNodeStyleSetGridColumnEndSpan(node, p.value);
      } else {
        YGNodeStyleSetGridRowEndSpan(node, p.value);
      }
      break;
  }
}

// Yoga rounds layout to the pixel grid by default (point scale factor 1),
// while the browser reports fractional geometry. Comparing the two directly
// would charge Yoga for rounding the oracle never did, so rounding is off.
YGConfigRef unroundedConfig() {
  static YGConfigRef config = [] {
    YGConfigRef c = YGConfigNew();
    YGConfigSetPointScaleFactor(c, 0.0f);
    return c;
  }();
  return config;
}

YGNodeRef build(const Case& c) {
  YGNodeRef root = YGNodeNewWithConfig(unroundedConfig());
  YGNodeStyleSetDisplay(root, YGDisplayGrid);
  // Every case is measured inside a 900px wrapper in the browser; a case that
  // does not state a width is shrink-to-fit against that, so give Yoga the
  // same containing block rather than an undefined one.
  if (isSet(c.width)) {
    YGNodeStyleSetWidth(root, c.width);
  }
  if (isSet(c.height)) {
    YGNodeStyleSetHeight(root, c.height);
  }
  if (isSet(c.gap)) {
    YGNodeStyleSetGap(root, YGGutterAll, c.gap);
  }
  if (isSet(c.rowGap)) {
    YGNodeStyleSetGap(root, YGGutterRow, c.rowGap);
  }
  if (isSet(c.colGap)) {
    YGNodeStyleSetGap(root, YGGutterColumn, c.colGap);
  }
  if (isSet(c.minWidth)) {
    YGNodeStyleSetMinWidth(root, c.minWidth);
  }
  if (isSet(c.maxWidth)) {
    YGNodeStyleSetMaxWidth(root, c.maxWidth);
  }
  if (isSet(c.minHeight)) {
    YGNodeStyleSetMinHeight(root, c.minHeight);
  }
  if (isSet(c.maxHeight)) {
    YGNodeStyleSetMaxHeight(root, c.maxHeight);
  }
  if (isSet(c.gapPercent)) {
    YGNodeStyleSetGapPercent(root, YGGutterAll, c.gapPercent);
  }
  if (c.autoRowCount > 0) {
    YGNodeStyleSetGridAutoRowsCount(root, c.autoRowCount);
    for (size_t i = 0; i < c.autoRowCount; i++) {
      applyAutoRow(root, i, c.autoRows[i]);
    }
  }
  if (c.padding > 0) {
    YGNodeStyleSetPadding(root, YGEdgeAll, c.padding);
  }
  if (c.border > 0) {
    YGNodeStyleSetBorder(root, YGEdgeAll, c.border);
  }
  if (c.justifyItems >= 0) {
    YGNodeStyleSetJustifyItems(root, (YGJustify)c.justifyItems);
  }
  if (c.alignItems >= 0) {
    YGNodeStyleSetAlignItems(root, (YGAlign)c.alignItems);
  }
  // CSS initial value for both content-distribution properties is `normal`,
  // which on a grid container behaves as `stretch`: auto-sized tracks absorb
  // the leftover space (css-grid-2 §12.8). Yoga has no `normal`, and its own
  // default is the flex one — flex-start — so an unspecified value has to be
  // mapped here or every auto track silently shrink-wraps.
  YGNodeStyleSetJustifyContent(
      root,
      c.justifyContent >= 0 ? (YGJustify)c.justifyContent : YGJustifyStretch);
  YGNodeStyleSetAlignContent(
      root, c.alignContent >= 0 ? (YGAlign)c.alignContent : YGAlignStretch);

  if (c.colCount > 0) {
    YGNodeStyleSetGridTemplateColumnsCount(root, c.colCount);
    for (size_t i = 0; i < c.colCount; i++) {
      applySimple(root, /* isColumn */ true, i, c.cols[i]);
    }
    // The track list above holds the auto-repeat pattern once; this says which
    // slice of it repeats, for layout to expand against the container size.
    if (c.colAutoRepeatType != 0) {
      YGNodeStyleSetGridTemplateColumnsAutoRepeat(
          root,
          (YGGridAutoRepeatType)c.colAutoRepeatType,
          c.colAutoRepeatStart,
          c.colAutoRepeatCount);
    }
  }
  if (c.rowCount > 0) {
    YGNodeStyleSetGridTemplateRowsCount(root, c.rowCount);
    for (size_t i = 0; i < c.rowCount; i++) {
      applySimple(root, /* isColumn */ false, i, c.rows[i]);
    }
    if (c.rowAutoRepeatType != 0) {
      YGNodeStyleSetGridTemplateRowsAutoRepeat(
          root,
          (YGGridAutoRepeatType)c.rowAutoRepeatType,
          c.rowAutoRepeatStart,
          c.rowAutoRepeatCount);
    }
  }

  for (size_t i = 0; i < c.itemCount; i++) {
    const Item& it = c.items[i];
    YGNodeRef child = YGNodeNewWithConfig(unroundedConfig());
    if (isSet(it.width)) {
      YGNodeStyleSetWidth(child, it.width);
    }
    if (isSet(it.widthPercent)) {
      YGNodeStyleSetWidthPercent(child, it.widthPercent);
    }
    if (isSet(it.aspectRatio)) {
      YGNodeStyleSetAspectRatio(child, it.aspectRatio);
    }
    if (isSet(it.height)) {
      YGNodeStyleSetHeight(child, it.height);
    }
    if (it.margin != 0) {
      YGNodeStyleSetMargin(child, YGEdgeAll, it.margin);
    }
    if (it.padding != 0) {
      YGNodeStyleSetPadding(child, YGEdgeAll, it.padding);
    }
    if (it.border != 0) {
      YGNodeStyleSetBorder(child, YGEdgeAll, it.border);
    }
    if (it.justifySelf >= 0) {
      YGNodeStyleSetJustifySelf(child, (YGJustify)it.justifySelf);
    }
    applyPlacement(child, /* isColumn */ true, it.col);
    applyPlacement(child, /* isColumn */ false, it.row);
    YGNodeInsertChild(root, child, i);
  }
  return root;
}

struct Failure {
  std::string caseId;
  std::string what;
  float actual;
  float expected;
};

} // namespace

int main(int argc, char** argv) {
  bool verbose = false;
  std::string filter;
  for (int i = 1; i < argc; i++) {
    if (std::strcmp(argv[i], "-v") == 0) {
      verbose = true;
    } else {
      filter = argv[i];
    }
  }

  size_t ran = 0, passed = 0, unsupported = 0, assertions = 0, mismatches = 0;
  std::vector<Failure> failures;
  std::map<std::string, size_t> unsupportedReasons;
  std::map<std::string, std::pair<size_t, size_t>> byGroup; // pass, total

  for (size_t n = 0; n < kCaseCount; n++) {
    const Case& c = kCases[n];
    if (!filter.empty() &&
        std::string(c.id).find(filter) == std::string::npos &&
        std::string(c.group).find(filter) == std::string::npos) {
      continue;
    }
    if (c.unsupported != nullptr) {
      unsupported++;
      unsupportedReasons[c.unsupported]++;
      if (verbose) {
        std::printf("UNSUPPORTED  %-28s %s\n", c.id, c.unsupported);
      }
      continue;
    }

    ran++;
    // The browser lays every case out inside a 900px-wide wrapper, where a
    // `display: grid` box is BLOCK-level: with no width of its own it fills
    // that wrapper and is then clamped by any min/max-width. Laying the
    // container out as a root instead would shrink-wrap it to its content,
    // which is a different box entirely — so the wrapper is modelled
    // explicitly rather than approximated by the root's available width.
    YGNodeRef wrapper = YGNodeNewWithConfig(unroundedConfig());
    YGNodeStyleSetWidth(wrapper, 900.0f);
    YGNodeRef root = build(c);
    YGNodeInsertChild(wrapper, root, 0);
    YGNodeCalculateLayout(wrapper, 900.0f, YGUndefined, YGDirectionLTR);

    size_t caseMismatches = 0;
    auto check = [&](const char* what, float actual, float expected) {
      assertions++;
      if (std::fabs(actual - expected) > kTolerance) {
        caseMismatches++;
        mismatches++;
        if (failures.size() < 400) {
          failures.push_back({c.id, what, actual, expected});
        }
      }
    };

    check("container.w", YGNodeLayoutGetWidth(root), c.expectedWidth);
    check("container.h", YGNodeLayoutGetHeight(root), c.expectedHeight);
    for (size_t i = 0; i < c.itemCount; i++) {
      YGNodeRef child = YGNodeGetChild(root, i);
      const Rect& e = c.items[i].expected;
      char buf[64];
      std::snprintf(buf, sizeof(buf), "item[%zu].x", i);
      check(buf, YGNodeLayoutGetLeft(child), e.x);
      std::snprintf(buf, sizeof(buf), "item[%zu].y", i);
      check(buf, YGNodeLayoutGetTop(child), e.y);
      std::snprintf(buf, sizeof(buf), "item[%zu].w", i);
      check(buf, YGNodeLayoutGetWidth(child), e.w);
      std::snprintf(buf, sizeof(buf), "item[%zu].h", i);
      check(buf, YGNodeLayoutGetHeight(child), e.h);
    }

    auto& g = byGroup[c.group];
    g.second++;
    if (caseMismatches == 0) {
      passed++;
      g.first++;
      if (verbose) {
        std::printf("PASS         %-28s %s\n", c.id, c.note);
      }
    } else {
      std::printf(
          "FAIL         %-28s %s (%zu mismatches)\n",
          c.id,
          c.note,
          caseMismatches);
    }
    YGNodeFreeRecursive(wrapper);
  }

  if (!failures.empty()) {
    std::printf("\n--- mismatches (first %zu) ---\n", failures.size());
    for (const auto& f : failures) {
      std::printf(
          "  %-28s %-14s yoga=%9.2f  safari=%9.2f  delta=%8.2f\n",
          f.caseId.c_str(),
          f.what.c_str(),
          f.actual,
          f.expected,
          f.actual - f.expected);
    }
  }

  std::printf("\n--- by group ---\n");
  for (const auto& [group, pt] : byGroup) {
    std::printf(
        "  %-32s %3zu/%-3zu %s\n",
        group.c_str(),
        pt.first,
        pt.second,
        pt.first == pt.second ? "" : "<-- failing");
  }

  if (!unsupportedReasons.empty()) {
    std::printf("\n--- not replayable through Yoga's API ---\n");
    for (const auto& [reason, count] : unsupportedReasons) {
      std::printf("  %-32s %zu cases\n", reason.c_str(), count);
    }
  }

  std::printf(
      "\n%zu cases run, %zu passed, %zu failed, %zu unsupported\n",
      ran,
      passed,
      ran - passed,
      unsupported);
  std::printf(
      "%zu assertions, %zu mismatches vs Safari\n", assertions, mismatches);
  std::printf("\n%s\n", mismatches == 0 ? "ALL REPLAYED CASES MATCH SAFARI" : "MISMATCHES PRESENT");
  return mismatches == 0 ? 0 : 1;
}
