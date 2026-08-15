// Percentage `flow-tolerance`, derived from the spec rather than measured.
//
// Every other case in this directory takes its expected values from Safari.
// This one cannot: Safari PARSES `flow-tolerance: 5%` — CSS.supports returns
// true — but does not resolve it, and 5%, 10% and 25% all produce byte-for-byte
// identical layouts, which is impossible if the percentage is being applied
// (5% of a 600px grid axis is 30px; 25% is 150px). Those corpus cases are
// therefore marked as an oracle limitation, and the behaviour is pinned here
// instead.
//
// The expectations below are hand-derived from css-grid-3 §4.4, and the
// derivation is written out so a reader can check it rather than trust it.
//
//   3 lanes of 1fr in a 600px container with a 10px gap
//     -> each track is (600 - 2*10) / 3 = 193.333 wide
//     -> lane origins are 0, 203.333, 406.667
//
//   items, in order, of heights 60, 40, 20, 30, 30, 30
//
// Walking §4.4 with a tie threshold T, where "run" is the running position of
// each lane and "cursor" is the auto-placement cursor:
//
//   item0: run [0,0,0], every lane ties, cursor 0 -> lane 0 at y=0
//          run [70,0,0], cursor 1
//   item1: shortest 0. T=30: lanes 1,2 tie (70-0 > 30). T=150: all tie.
//          Either way the first tied lane at or after the cursor is lane 1.
//          -> lane 1 at y=0, run [70,50,0], cursor 2
//   item2: shortest 0. T=30: only lane 2 (50-0 > 30). T=150: all tie, and the
//          first at or after cursor 2 is lane 2.
//          -> lane 2 at y=0, run [70,50,30], cursor 3
//   item3: shortest 30 (lane 2). The cursor is 3, past the last lane, so the
//          rule "or if there are none such, choose the first one" applies and
//          the FIRST tied lane wins — which is where the threshold decides:
//
//            T = 5% of 600 = 30  -> lane 1 ties (50-30 = 20 <= 30) but lane 0
//                                   does not (70-30 = 40 > 30)
//                                   => first tied is lane 1, at y=50
//            T = 25% of 600 = 150 -> every lane ties
//                                   => first tied is lane 0, at y=70
//
// So the two percentages must place item3 in different lanes at different
// heights. An implementation that ignored the percentage — as Safari does —
// would place it identically in both.

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
      "  %-38s %s %8.2f %s %8.2f\n",
      what,
      ok ? "ok" : "XX",
      actual,
      ok ? "==" : "!=",
      expected);
}

// The shape described above, laid out with the given percentage tolerance.
YGNodeRef layout(float tolerancePercent) {
  YGConfigRef config = YGConfigNew();
  YGConfigSetPointScaleFactor(config, 0.0f);

  YGNodeRef root = YGNodeNewWithConfig(config);
  YGNodeStyleSetDisplay(root, YGDisplayGridLanes);
  YGNodeStyleSetWidth(root, 600.0f);
  YGNodeStyleSetGap(root, YGGutterAll, 10.0f);
  YGNodeStyleSetFlowTolerance(root, YGFlowTolerancePercent, tolerancePercent);
  YGNodeStyleSetGridTemplateColumnsCount(root, 3);
  for (size_t i = 0; i < 3; i++) {
    YGNodeStyleSetGridTemplateColumn(root, i, YGGridTrackTypeFr, 1.0f);
  }

  const float heights[] = {60.0f, 40.0f, 20.0f, 30.0f, 30.0f, 30.0f};
  for (size_t i = 0; i < 6; i++) {
    YGNodeRef child = YGNodeNewWithConfig(config);
    YGNodeStyleSetHeight(child, heights[i]);
    YGNodeInsertChild(root, child, i);
  }

  YGNodeCalculateLayout(root, 900.0f, YGUndefined, YGDirectionLTR);
  return root;
}

} // namespace

int main() {
  std::printf("flow-tolerance: 5%% (= 30px of a 600px grid axis)\n");
  {
    YGNodeRef root = layout(5.0f);
    YGNodeRef item3 = YGNodeGetChild(root, 3);
    check("item3 lane origin x", YGNodeLayoutGetLeft(item3), 203.333f);
    check("item3 y", YGNodeLayoutGetTop(item3), 50.0f);
    YGNodeFreeRecursive(root);
  }

  std::printf("flow-tolerance: 25%% (= 150px, so every lane ties)\n");
  {
    YGNodeRef root = layout(25.0f);
    YGNodeRef item3 = YGNodeGetChild(root, 3);
    check("item3 lane origin x", YGNodeLayoutGetLeft(item3), 0.0f);
    check("item3 y", YGNodeLayoutGetTop(item3), 70.0f);
    YGNodeFreeRecursive(root);
  }

  // The point of the pair: the percentage must actually be resolved. If it
  // were ignored, both layouts would be identical and the assertions above
  // could not both hold.
  std::printf("\n%s (%d mismatches)\n", failures == 0 ? "PASS" : "FAIL", failures);
  return failures == 0 ? 0 : 1;
}
