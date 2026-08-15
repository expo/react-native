// Stacking-axis alignment (css-grid-3 §6.3 and §6.4), derived from the spec
// rather than measured.
//
// Every other case in this directory takes its expected values from Safari.
// These cannot:
//
//   §6.4 (self alignment) Safari does not implement it at all. `start`,
//        `center`, `end` and `stretch` all produce byte-identical geometry
//        there, and `align-self` on a single item moves nothing. An oracle
//        that agrees with every value cannot distinguish a correct
//        implementation from one that ignores the property.
//
//   §6.3 (content distribution) Safari implements the positional values
//        correctly — those cases stay pinned to it — but distributes the
//        stacking axis as though the lanes had rows: for `space-around` it
//        shifts the content by 52.5 and for `space-evenly` by 70, which are
//        the offsets you get from treating the deepest lane's ITEM COUNT as
//        the number of alignment subjects. §6.3 says there is only ever one
//        subject (the stacking range), so both must fall back to `center`.
//
// The shape below is the corpus's, and the derivation is written out so a
// reader can check it rather than trust it.
//
//   3 lanes of 1fr in a 600px container, 10px gap, flow-tolerance 0
//     -> each track is (600 - 2*10) / 3 = 193.333 wide
//     -> lane origins are 0, 203.333, 406.667
//
//   items, in order, of heights 40, 60, 30, 50, 20
//
// Walking §4.4 with a zero tie threshold ("run" is each lane's running
// position, "cursor" the auto-placement cursor):
//
//   item0: run [0,0,0], all tie, cursor 0        -> lane 0, y=0; run [50,0,0]
//   item1: shortest 0, lanes 1 and 2 tie, cursor 1 -> lane 1, y=0; run [50,70,0]
//   item2: shortest 0, only lane 2 ties          -> lane 2, y=0; run [50,70,40]
//   item3: shortest 40 (lane 2), cursor past the end so the first tied wins
//                                                -> lane 2, y=40; run [50,70,100]
//   item4: shortest 50 (lane 0)                  -> lane 0, y=50
//
//   bottoms: 40, 60, 30, 90, 70  ->  the stacking range is 0..90
//
// §6.4 gives each item the void that follows it in its track, minus the
// gutter — the gutter is space the author asked for, not a void. The last
// item in a track measures instead against the bottom of the whole stacking
// range, "the lowest bottom outer edge among all the last items in all
// tracks":
//
//   item0  lane 0, followed by item4 at 50   -> 50 - 40 - 10 = 0
//   item1  lane 1, last                      -> 90 - 60     = 30
//   item2  lane 2, followed by item3 at 40   -> 40 - 30 - 10 = 0
//   item3  lane 2, last                      -> 90 - 90     = 0
//   item4  lane 0, last                      -> 90 - 70     = 20
//
// So only item1 and item4 have anywhere to go, and `end` moves them by
// exactly 30 and 20.

#include <yoga/Yoga.h>
#include <cmath>
#include <cstdio>

namespace {

int failures = 0;

void check(const char* what, float actual, float expected) {
  const bool ok = std::fabs(actual - expected) < 0.05f;
  if (!ok) {
    failures++;
  }
  std::printf(
      "  %-44s %s %8.2f %s %8.2f\n",
      what,
      ok ? "ok" : "XX",
      actual,
      ok ? "==" : "!=",
      expected);
}

YGConfigRef newConfig() {
  YGConfigRef config = YGConfigNew();
  // The corpus compares against a browser, which does not round to a device
  // pixel grid. Yoga does by default, and that rounding would land on top of
  // the fractional track sizes here.
  YGConfigSetPointScaleFactor(config, 0.0f);
  return config;
}

YGNodeRef lanesRoot(YGConfigRef config) {
  YGNodeRef root = YGNodeNewWithConfig(config);
  YGNodeStyleSetDisplay(root, YGDisplayGridLanes);
  YGNodeStyleSetWidth(root, 600.0f);
  YGNodeStyleSetGap(root, YGGutterAll, 10.0f);
  YGNodeStyleSetFlowTolerance(root, YGFlowTolerancePoints, 0.0f);
  YGNodeStyleSetGridTemplateColumnsCount(root, 3);
  for (size_t i = 0; i < 3; i++) {
    YGNodeStyleSetGridTemplateColumn(root, i, YGGridTrackTypeFr, 1.0f);
  }
  return root;
}

void addItems(
    YGConfigRef config,
    YGNodeRef root,
    const float* heights,
    size_t count) {
  for (size_t i = 0; i < count; i++) {
    YGNodeRef child = YGNodeNewWithConfig(config);
    YGNodeStyleSetHeight(child, heights[i]);
    YGNodeInsertChild(root, child, i);
  }
}

const float kHeights5[] = {40.0f, 60.0f, 30.0f, 50.0f, 20.0f};
const float kHeights4[] = {40.0f, 60.0f, 30.0f, 50.0f};

// §6.4 sweep: the five-item shape with one align-items value.
void selfAlignment(const char* label, YGAlign align, float item1Y, float item4Y) {
  std::printf("§6.4 align-items: %s\n", label);
  YGConfigRef config = newConfig();
  YGNodeRef root = lanesRoot(config);
  YGNodeStyleSetAlignItems(root, align);
  addItems(config, root, kHeights5, 5);
  YGNodeCalculateLayout(root, 900.0f, YGUndefined, YGDirectionLTR);

  // The three items with no void after them must not move for any value —
  // that is what makes the two that do move evidence of §6.4 rather than of
  // some blanket offset.
  check("item0 y (no void: item4 follows it)", YGNodeLayoutGetTop(YGNodeGetChild(root, 0)), 0.0f);
  check("item2 y (no void: item3 follows it)", YGNodeLayoutGetTop(YGNodeGetChild(root, 2)), 0.0f);
  check("item3 y (deepest lane, no slack)", YGNodeLayoutGetTop(YGNodeGetChild(root, 3)), 40.0f);
  check("item1 y (last in lane 1, 30 of slack)", YGNodeLayoutGetTop(YGNodeGetChild(root, 1)), item1Y);
  check("item4 y (last in lane 0, 20 of slack)", YGNodeLayoutGetTop(YGNodeGetChild(root, 4)), item4Y);
  // Alignment moves items inside the range; it never resizes the container.
  check("container height", YGNodeLayoutGetHeight(root), 90.0f);
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
}

// §6.4 with align-self on one item only.
void selfAlignmentOverride(const char* label, YGAlign align, float item0Y) {
  std::printf("§6.4 align-self: %s on item0 only\n", label);
  YGConfigRef config = newConfig();
  YGNodeRef root = lanesRoot(config);
  addItems(config, root, kHeights4, 4);
  YGNodeStyleSetAlignSelf(YGNodeGetChild(root, 0), align);
  YGNodeCalculateLayout(root, 900.0f, YGUndefined, YGDirectionLTR);

  // Without item4, item0 is the last item in lane 0 and has 90 - 40 = 50 of
  // slack all to itself.
  check("item0 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 0)), item0Y);
  // "Alignment of an item does not affect the size or position of other
  // items' alignment containers." item1 is last in its lane with 30 of slack
  // and the container's align-items is untouched, so it must not move.
  check("item1 y (untouched)", YGNodeLayoutGetTop(YGNodeGetChild(root, 1)), 0.0f);
  check("item2 y (untouched)", YGNodeLayoutGetTop(YGNodeGetChild(root, 2)), 0.0f);
  check("item3 y (untouched)", YGNodeLayoutGetTop(YGNodeGetChild(root, 3)), 40.0f);
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
}

// §6.4's other half: an item immediately before a SPANNING one. The span
// cannot start until every lane it covers is clear, so the shallower lanes are
// left with a void that has nothing to do with where the lanes end.
//
//   items 40, 60, 30, then a full-width item of 25, then one of 20
//   -> item0/1/2 head lanes 0/1/2 at y=0
//   -> the span waits for the deepest, max(50,70,40) = 70, so y=70
//   -> run becomes [105,105,105]; item4 lands in lane 0 at y=105
//   -> bottoms 40, 60, 30, 95, 125; the range is 0..125
//
//   item0  lane 0, followed by the span at 70 -> 70 - 40 - 10 = 20
//   item1  lane 1, followed by the span at 70 -> 70 - 60 - 10 = 0
//   item2  lane 2, followed by the span at 70 -> 70 - 30 - 10 = 30
//   span   spans all three: lane 0 has item4 right below it (0), so the
//          smallest slack across its tracks is 0 — it cannot move into a lane
//          that is already filled
//   item4  lane 0, last, and it ends at the bottom of the range -> 0
void spanningVoid(const char* label, YGAlign align, float item0Y, float item2Y) {
  std::printf("§6.4 align-items: %s with a spanning item\n", label);
  YGConfigRef config = newConfig();
  YGNodeRef root = lanesRoot(config);
  YGNodeStyleSetAlignItems(root, align);
  const float heights[] = {40.0f, 60.0f, 30.0f, 25.0f, 20.0f};
  addItems(config, root, heights, 5);
  YGNodeStyleSetGridColumnEndSpan(YGNodeGetChild(root, 3), 3);
  YGNodeCalculateLayout(root, 900.0f, YGUndefined, YGDirectionLTR);

  check("item0 y (20 of slack above the span)", YGNodeLayoutGetTop(YGNodeGetChild(root, 0)), item0Y);
  check("item1 y (flush against the span)", YGNodeLayoutGetTop(YGNodeGetChild(root, 1)), 0.0f);
  check("item2 y (30 of slack above the span)", YGNodeLayoutGetTop(YGNodeGetChild(root, 2)), item2Y);
  check("span y", YGNodeLayoutGetTop(YGNodeGetChild(root, 3)), 70.0f);
  check("item4 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 4)), 105.0f);
  check("container height", YGNodeLayoutGetHeight(root), 125.0f);
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
}

// §6.3: one alignment subject, so the distributed values have nothing to
// distribute between and fall back — space-between to start, space-around and
// space-evenly to center. The container is 300 tall against a 90-tall range,
// so center is a uniform shift of (300 - 90) / 2 = 105.
void contentDistribution(const char* label, YGAlign align, float shift) {
  std::printf("§6.3 align-content: %s\n", label);
  YGConfigRef config = newConfig();
  YGNodeRef root = lanesRoot(config);
  YGNodeStyleSetHeight(root, 300.0f);
  YGNodeStyleSetAlignContent(root, align);
  addItems(config, root, kHeights4, 4);
  YGNodeCalculateLayout(root, 900.0f, YGUndefined, YGDirectionLTR);

  // The whole range moves together: the items keep their positions relative
  // to each other, which is what "one alignment subject" means.
  check("item0 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 0)), 0.0f + shift);
  check("item1 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 1)), 0.0f + shift);
  check("item2 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 2)), 0.0f + shift);
  check("item3 y", YGNodeLayoutGetTop(YGNodeGetChild(root, 3)), 40.0f + shift);
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
}

} // namespace

int main() {
  // start and stretch must both be no-ops. stretch matters most: it is Yoga's
  // DEFAULT align-items, so an implementation that filled the void instead of
  // ignoring it would break every lanes container that never mentions
  // alignment at all. §6.3's note settles the reading — "the behavior of
  // normal and stretch is identical to start".
  selfAlignment("start", YGAlignStart, 0.0f, 50.0f);
  selfAlignment("stretch (Yoga's default)", YGAlignStretch, 0.0f, 50.0f);
  selfAlignment("center", YGAlignCenter, 15.0f, 60.0f);
  selfAlignment("end", YGAlignEnd, 30.0f, 70.0f);

  selfAlignmentOverride("end", YGAlignEnd, 50.0f);
  selfAlignmentOverride("center", YGAlignCenter, 25.0f);

  spanningVoid("start", YGAlignStart, 0.0f, 0.0f);
  spanningVoid("end", YGAlignEnd, 20.0f, 30.0f);

  contentDistribution("space-between (falls back to start)", YGAlignSpaceBetween, 0.0f);
  contentDistribution("space-around (falls back to center)", YGAlignSpaceAround, 105.0f);
  contentDistribution("space-evenly (falls back to center)", YGAlignSpaceEvenly, 105.0f);

  std::printf("\n%s (%d mismatches)\n", failures == 0 ? "PASS" : "FAIL", failures);
  return failures == 0 ? 0 : 1;
}
