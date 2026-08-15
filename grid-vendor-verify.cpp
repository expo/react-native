// Smoke test for the vendored CSS Grid algorithm (Yoga PR #1894), pinned
// against real Safari for the identical layout (see /tmp/gl/grid.html).
//
//   display: grid; width: 600px; gap: 10px;
//   grid-template-columns: 100px 1fr 2fr;
//   grid-template-rows: 50px auto;
//   six children with fixed heights 20/30/25/40/15/35
#include <yoga/Yoga.h>
#include <cstdio>
#include <cstdlib>

struct Expected {
  const char* name;
  float x, y, w, h;
};

// Ground truth read out of Safari 26 via safaridriver.
static const Expected kSafari[] = {
    {"a", 0.0f, 0.0f, 100.0f, 20.0f},
    {"b", 110.0f, 0.0f, 160.0f, 30.0f},
    {"c", 280.0f, 0.0f, 320.0f, 25.0f},
    {"d", 0.0f, 60.0f, 100.0f, 40.0f},
    {"e", 110.0f, 60.0f, 160.0f, 15.0f},
    {"f", 280.0f, 60.0f, 320.0f, 35.0f},
};
static const float kSafariContainerHeight = 100.0f;

int main() {
  const float heights[] = {20.0f, 30.0f, 25.0f, 40.0f, 15.0f, 35.0f};

  YGNodeRef root = YGNodeNew();
  YGNodeStyleSetDisplay(root, YGDisplayGrid);
  YGNodeStyleSetWidth(root, 600.0f);
  YGNodeStyleSetGap(root, YGGutterAll, 10.0f);

  YGNodeStyleSetGridTemplateColumnsCount(root, 3);
  YGNodeStyleSetGridTemplateColumn(root, 0, YGGridTrackTypePoints, 100.0f);
  YGNodeStyleSetGridTemplateColumn(root, 1, YGGridTrackTypeFr, 1.0f);
  YGNodeStyleSetGridTemplateColumn(root, 2, YGGridTrackTypeFr, 2.0f);

  YGNodeStyleSetGridTemplateRowsCount(root, 2);
  YGNodeStyleSetGridTemplateRow(root, 0, YGGridTrackTypePoints, 50.0f);
  YGNodeStyleSetGridTemplateRow(root, 1, YGGridTrackTypeAuto, 0.0f);

  for (size_t i = 0; i < 6; i++) {
    YGNodeRef child = YGNodeNew();
    YGNodeStyleSetHeight(child, heights[i]);
    YGNodeInsertChild(root, child, i);
  }

  YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);

  int failures = 0;
  auto check = [&](const char* what, float actual, float expected) {
    const bool ok = std::abs(actual - expected) < 0.01f;
    if (!ok) {
      failures++;
    }
    std::printf(
        "  %-4s %-2s %7.2f %s %7.2f\n",
        what,
        ok ? "ok" : "XX",
        actual,
        ok ? "==" : "!=",
        expected);
  };

  std::printf("container height:\n");
  check("h", YGNodeLayoutGetHeight(root), kSafariContainerHeight);

  for (size_t i = 0; i < 6; i++) {
    const YGNodeRef child = YGNodeGetChild(root, i);
    const Expected& e = kSafari[i];
    std::printf("item %s:\n", e.name);
    check("x", YGNodeLayoutGetLeft(child), e.x);
    check("y", YGNodeLayoutGetTop(child), e.y);
    check("w", YGNodeLayoutGetWidth(child), e.w);
    check("h", YGNodeLayoutGetHeight(child), e.h);
  }

  YGNodeFreeRecursive(root);
  std::printf(
      "\n%s (%d mismatches vs Safari)\n",
      failures == 0 ? "PASS" : "FAIL",
      failures);
  return failures == 0 ? 0 : 1;
}
