# Grid container with padding measures too tall in an indefinite axis

**Repo:** `react/yoga` — against PR [#1894](https://github.com/react/yoga/pull/1894)
("CSS Grid 2/9: Grid layout algorithm")
**File:** `yoga/algorithm/grid/GridLayout.cpp`
**Severity:** wrong layout, silently — no crash, no warning

## Summary

When a grid container's block axis is indefinite, its height is computed from
the total of its row tracks. That total is a **content-box** size, but it is
passed through Yoga's `boundAxis`, which floors its result at the node's
padding + border. That floor is only correct for a **border-box** size, so a
padded grid container comes out too tall — and then the padding is added on
top of the floor as well.

It only shows when padding + border exceeds the content, which is why an
ordinary test misses it.

## The code

`yoga/algorithm/grid/GridLayout.cpp`, sizing the container when the axis is
indefinite:

```cpp
if (!heightIsDefinite) {
  auto totalTrackHeight = trackSizing.getTotalBaseSize(Dimension::Height);
  containerInnerHeight = boundAxis(          // <-- content-box value...
      node,
      FlexDirection::Column,
      direction,
      totalTrackHeight,
      ownerHeight,
      ownerWidth);
  ...
}
```

and `boundAxis` (`yoga/algorithm/BoundAxis.h`):

```cpp
inline float boundAxis(...) {
  return yoga::maxOrDefined(
      boundAxisWithinMinAndMax(...).unwrap(),
      paddingAndBorderForAxis(node, axis, direction, widthSize));  // <-- border-box floor
}
```

`containerInnerHeight` is then used as a content-box size — padding and border
are added to it a few lines later:

```cpp
node->setLayoutMeasuredDimension(
    boundAxis(node, FlexDirection::Column, direction,
              containerInnerHeight + paddingAndBorderBlock, ...),
    Dimension::Height);
```

So for a 20px row inside 20px of padding: the track total (20) is floored at
padding+border (40), then padding+border is added again → 80, where the
correct answer is 60.

The same expression is used for the inline axis and is wrong in the same way;
it is just rarely observed, because a grid container's inline axis is usually
definite.

## Minimal reproduction

`mre.cpp` in this directory — links only `yogacore`, no app required:

```
c++ -std=c++20 -I<yoga-root> mre.cpp libyogacore.a -o mre && ./mre
```

Output against #1894 as it stands:

```
 padding   border      row |     yoga expected
       0        0       20 |     20.0     20.0
       0        0       50 |     50.0     50.0
       5        0       20 |     30.0     30.0
       5        0       50 |     60.0     60.0
      10        0       20 |     40.0     40.0
      10        0       50 |     70.0     70.0
      20        0       20 |     80.0     60.0 <-- WRONG
      20        0       50 |     90.0     90.0
      40        0       20 |    160.0    100.0 <-- WRONG
      40        0       50 |    160.0    130.0 <-- WRONG
```

The pattern is `max(correct, 2 × (padding + border))`: the row is only wrong
once the padding floor exceeds the real content height.

## Web vs mobile

Identical layout, three engines. `mre.html` in this directory is the web side:

```css
#g {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 20px;
  border: 1px solid;
  width: 300px;
}
#g > div { height: 20px; }
```

| | measured height |
| --- | --- |
| Safari 26.5 (`web-safari-62px.png`) | **62.0px** |
| iOS, #1894 unpatched (`ios-unfixed-84pt.png`) | **84.0pt** |
| iOS, patched (`ios-fixed-62pt.png`) | 62.0pt |
| Android, patched (`android-fixed-62pt.png`) | 62.1pt |

62 = 20 padding + 20 row + 20 padding + 2 border. The React Native screens
render their own measured height, so the screenshots carry the number.

## Suggested fix

Clamp in border-box space — which is where Yoga's min/max dimensions already
live — and convert back, rather than using `boundAxis` on a content-box value:

```cpp
auto boundContentBox = [&](FlexDirection axis,
                           float contentSize,
                           float paddingAndBorder,
                           float axisSize) {
  return boundAxisWithinMinAndMax(
             node, direction, axis,
             FloatOptional{contentSize + paddingAndBorder},
             axisSize, ownerWidth)
             .unwrap() -
      paddingAndBorder;
};
```

`boundAxisWithinMinAndMax` applies the min/max clamp without the padding
floor, so the floor is dropped and the clamp still happens against the box
size the author specified.

## How it was found

A conformance corpus that renders each case in Safari — which implements CSS
Grid natively — and replays the identical case through Yoga's public API,
comparing every coordinate. The failing case was `container-box-x-fr`:
`1fr 1fr` with `gap: 10`, swept across padding 0/20 and border 0/5.

With the fix, that corpus passes 169 cases and 2,350 coordinate assertions
with no mismatches against Safari, on both the engine and through React
Native.
