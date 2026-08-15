# CSS Grid style adds ~128 bytes to every Yoga node, grid or not

**Repo:** `react/yoga` — against [#1893](https://github.com/react/yoga/pull/1893)
("CSS Grid 1/9: Grid style types and public API"), which is **already merged**
**File:** `yoga/style/Style.h`
**Severity:** memory regression, silent, paid by every node in every tree

## Summary

PR 1/9 stores all grid style inline in `yoga::Style`:

```cpp
  GridTrackList gridTemplateColumns_{};   // std::vector — 24 bytes
  GridTrackList gridTemplateRows_{};      // 24
  GridTrackList gridAutoColumns_{};       // 24
  GridTrackList gridAutoRows_{};          // 24
  GridLine gridColumnStart_{};            // 8
  GridLine gridColumnEnd_{};              // 8
  GridLine gridRowStart_{};               // 8
  GridLine gridRowEnd_{};                 // 8
```

That is **128 bytes on every `Style`**, and a `Style` exists for every node in
the tree — including the overwhelming majority that are neither grid containers
nor grid items. Four empty `std::vector`s are 96 bytes of that, and an empty
vector still costs its three pointers.

The cost lands on every Yoga embedder whether or not they ever set a grid
property.

## Measured

From our fork, which carries this PR plus the rest of the series and some
additions of its own (auto-repeat, auto-flow, template areas):

```
sizeof(yoga::Style)              168   (grid style behind a pointer)
sizeof(GridStyle)                208   (everything that moved)
  4x GridTrackList                96
  4x GridLine                     32
  GridTemplateAreas               32
  std::string (grid-area)         24
shared_ptr replacing it           16
```

So `Style` would be **360 bytes** with that state inline, against **168** with
it behind a pointer. For the subset in PR 1/9 alone the figure is ~128 bytes
returned per node, less the 16-byte pointer.

Downstream, in React Native, the same change moved:

```
ViewProps         2,416 -> 2,288 bytes
ViewShadowNode    1,216 -> 1,088 bytes
```

Every mounted View holds a props object, plus one per pending generation during
a commit, so this is multiplied across the tree and again across commits. It
was enough to breach React Native's props size budget, which is what surfaced
it.

## Suggested fix

Hold the grid properties in a side allocation that stays null until a grid
property is set:

```cpp
  // Reads of an unset grid style return shared defaults, so callers never
  // learn whether the allocation exists.
  const GridStyle& grid() const {
    return grid_ == nullptr ? kDefaultGridStyle : *grid_;
  }

  GridStyle& ensureGrid() {
    // Always replace rather than mutate in place: a Style copy shares the
    // allocation, and a use_count() check can be stale by the time it is acted
    // on if styles are copied across threads.
    grid_ = grid_ == nullptr ? std::make_shared<GridStyle>()
                             : std::make_shared<GridStyle>(*grid_);
    return *grid_;
  }

  std::shared_ptr<GridStyle> grid_{};
```

Two details worth carrying over, both of which cost us a debugging session:

- **Copy on write unconditionally.** Checking `use_count() > 1` first looks
  like an optimisation but races: props are copied between threads during a
  commit, so the count can be stale by the time it is acted on, and mutating a
  `GridStyle` another `Style` is reading is a data race. Writes happen a
  handful of times while props are built, so the copy is not worth the risk.

- **The default instance should be a namespace-scope `inline` variable, not a
  function-local `static`.** The latter is initialised lazily behind a guard on
  whichever thread reaches it first, and these accessors run on several threads.

Equality needs to treat a null pointer and an allocation holding defaults as
the same value, which is two lines.

## Note for anyone applying this

Changing `Style`'s layout is an ABI change. On Android, `libappmodules.so`
compiles against `ReactAndroid/build/prefab-headers/` — a *copy* of the headers
— while `libreactnative.so` builds from the live sources, and the task that
produces that copy reports success while doing nothing when it believes itself
up to date. The two halves then disagree about `sizeof(Style)` and the app
aborts at startup inside `ComponentDescriptorRegistry` with
`std::length_error: vector`, nowhere near the edit. Delete the directory before
rebuilding.
