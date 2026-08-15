// Minimal reproduction: a grid container with padding measures too tall in an
// indefinite axis.
//
// Build against a Yoga that has react/yoga#1894 applied:
//   c++ -std=c++20 -I<yoga-root> grid-padding-mre.cpp libyogacore.a -o mre
//
// Expected (and what every browser produces):
//   height = padding-top + row + padding-bottom
//
// Actual: the container is floored at its own padding+border, and that floor
// is then added to again.

#include <initializer_list>
#include <yoga/Yoga.h>
#include <cstdio>

int main() {
  std::printf("%8s %8s %8s | %8s %8s\n", "padding", "border", "row", "yoga", "expected");
  for (float padding : {0.0f, 5.0f, 10.0f, 20.0f, 40.0f}) {
    for (float row : {20.0f, 50.0f}) {
      YGNodeRef root = YGNodeNew();
      YGNodeStyleSetDisplay(root, YGDisplayGrid);
      YGNodeStyleSetWidth(root, 300.0f);          // definite inline axis
      YGNodeStyleSetPadding(root, YGEdgeAll, padding);
      YGNodeStyleSetGridTemplateColumnsCount(root, 1);
      YGNodeStyleSetGridTemplateColumn(root, 0, YGGridTrackTypeFr, 1.0f);

      YGNodeRef child = YGNodeNew();
      YGNodeStyleSetHeight(child, row);
      YGNodeInsertChild(root, child, 0);

      // Block axis left indefinite — this is the axis that goes wrong.
      YGNodeCalculateLayout(root, 300.0f, YGUndefined, YGDirectionLTR);

      const float actual = YGNodeLayoutGetHeight(root);
      const float expected = row + 2 * padding;
      std::printf(
          "%8.0f %8.0f %8.0f | %8.1f %8.1f %s\n",
          padding,
          0.0f,
          row,
          actual,
          expected,
          actual == expected ? "" : "<-- WRONG");
      YGNodeFreeRecursive(root);
    }
  }
  return 0;
}
