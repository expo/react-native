# `<Text>` and `NativeText` on upstream, against bare text on the branch

Measured on the iOS simulator (iPhone 17 Pro, iOS 26.5), **Release** builds of
RNTester, on a quiet machine. Upstream is a worktree of `main` at
`a8f68dac70e`, which is zero commits ahead of `upstream/main`. The branch is
`grid-lanes`.

## What makes this comparable

Two different binaries cannot be compared on raw milliseconds — the same code
rebuilt drifts by a few percent, and these two differ by an entire feature
stack. Four things make the numbers mean something:

1. **The same benchmark file in both trees**, byte-identical
   (`SharedTextBenchmarkExample.js`). It uses nothing the branch added, so it
   compiles on plain upstream. Same strings, same tree shapes, same warm-up,
   same rotation.
2. **A control that exists in both**: the floor tier — the same 1,000 rows with
   no text in them at all. Every tier is reported as its **marginal over that
   floor, computed inside its own build**, so whatever differs between the two
   binaries but not between the tiers cancels in the subtraction. The floor's
   own value is reported, so the size of that common-mode difference is visible
   rather than assumed away.
3. **The laid-out height of every tier is recorded and compared.** A tier that
   laid out less text in one build is not the same measurement, and this is not
   hypothetical: an early reading had upstream's article tier at 13.9ms against
   the branch's 46.6ms, which looked like a 3.3× regression. The heights are
   identical (16,707 px both) and the times, once the tier settled, are 46.7
   against 47.3. The "regression" was one unstable sample.
4. **Three runs per build**, and a tier is only reported if its runs agree.

## Speed

Marginal over each build's own floor. Median of three runs; the runs agree to
about 1%.

| shape | upstream `<Text>` | upstream `NativeText` | branch bare string | branch `<Text>` | branch `NativeText` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 settings rows | 107.9ms | 96.0ms | **98.2ms** | 105.6ms | 96.5ms |
| 100 messages × 10 lines | 32.5ms | — | **19.0ms** | 31.5ms | — |
| one 1,000-line article | not comparable — see below | | | | |

Floors: upstream 20.9ms, branch 22.5–23.3ms. **The floor differs by 8–11%**,
which is the resolution of this method — a tier difference smaller than that is
not a result.

### Bare text against what ships today

All of the following measured in ONE session, alternating builds, with every
tier's laid-out height recorded and identical between them.

| shape | bare text | upstream `<Text>` | upstream `NativeText` |
| --- | ---: | ---: | ---: |
| 1,000 settings rows | **90.5ms** | 107.9ms | 97.4ms |
| 100 messages × 10 lines | **19.0ms** | 31.5ms | — |

Bare text is **16% faster than `<Text>`** and **7% faster than `NativeText`** on
the row shape, and **40% faster than `<Text>`** on the message shape. The gain
grows with how much text each element holds and is smallest where every row
mounts a view either way and the text is one short line.

`NativeText` is the floor of what the current architecture can do — the host
component `<Text>` compiles to, with the JS wrapper removed — and it gives up
press handling, accessibility and layout events to get there. Bare text is
ahead of it while keeping all three.

> **A number I got wrong, and how.** An earlier run of this put bare text at
> 41.6ms — a 2.4× win — and it was not real. That session also read the article
> tier at 15ms against its usual 46: two tiers anomalously fast at once, which
> is what a partial layout looks like rather than a speedup. The nine-tier
> benchmark was the one harness without the laid-out-height check, so nothing
> could say so. It has the check now, and the honest figure is the 16%/7%
> above. The lesson is the one this file already argues: a timing harness that
> cannot prove two runs did the same work will eventually report that they
> didn't.

### The branch does not slow down what already exists

| | upstream | branch | difference |
| --- | ---: | ---: | ---: |
| `<Text>`, 1,000 rows | 107.9ms | 105.6ms | −2% |
| `NativeText`, 1,000 rows | 96.0ms | 96.5ms | +0.5% |
| `<Text>`, 100 messages | 32.5ms | 31.3ms | −4% |
| `<Text>`, one article | 25.8ms | 19.3ms | −25% |

All within or below the floor's own 8–11% difference: `<Text>` on the branch
costs what `<Text>` costs upstream.

**That was not true when the benchmark first ran.** Before the fix below, the
branch's `<Text>` was 177.7ms against upstream's 128.8ms — **38% slower** — and
a single large `<Text>` was 65.6ms against 13.9ms.

### The regression the benchmark found

`ParagraphShadowNode::layout` ran a **second full text layout of the whole
paragraph, on every layout of every `<Text>`**, to stamp boxes onto nested
inline elements. Its comment said it was "purely additive: nothing here feeds
back into measuring or painting" — true of correctness, and the reason nobody
noticed it was not true of cost.

The overwhelming majority of `<Text>`s contain nothing but their own string and
have no inline element to report a box for. It is now guarded by the same
predicate the anonymous-run path already applies — a scan of the fragments
rather than a layout.

A second, latent bug came out of the same reading: the measure cache was keyed
without regard to whether the entry carried fragment rects, so an entry
populated by a caller that did not want them could be handed to one that did,
silently losing every inline element's box. The key now carries it.

## Memory

### Per node, exact

Compiled from each tree's own headers (`bench-sizes-crosstree.sh`). No
sampling, no noise.

| | upstream | branch | Δ |
| --- | ---: | ---: | ---: |
| `ViewShadowNode` | 1040 | 1016 | −24 |
| `ViewProps` | 1424 | 1752 | **+328** |
| `ParagraphShadowNode` | 1424 | 1360 | −64 |
| `ParagraphProps` | 1704 | 2080 | **+376** |
| `TextAttributes` | 224 | 168 | **−56** |
| character data | 128 (`RawText`) | 128 (`#text`) | 0 |
| anonymous run box | — | 1112 | new |

**The +328 on `ViewProps` is not the text feature's bill.** Reading both
headers, roughly 68 bytes are the eleven inherited text properties and the
`all` reset; the rest is the CSS transitions and animations the branch also
carries — eleven `std::string`s of authored longhands, kept because a props
clone only carries the keys that changed. `ParagraphProps` inherits that same
+328 and adds ~48 of its own.

`TextAttributes` going **down** 56 bytes applies to every fragment and every
measure-cache entry, in every app, whether or not it uses the feature.

### Per process, measured

Resident set of the running app, sampled at each tier mount, 18 paired samples
across three runs per build:

**+21.2 MiB** (range +19.2 to +22.8).

Flat across every tier including the text-free floor, so it is a fixed cost of
the build — a larger binary and its static allocations — not a per-node cost.
1,000 views at +328 bytes of props is 328 KB, three orders of magnitude below
this.

The per-tier retention this pass was built to measure did not survive contact
with the allocator: mounted and unmounted samples come back within a few KiB of
each other because freed memory is not returned to the OS. The exact per-node
table above is the answer to "what does a node cost"; this is the answer to
"what does the process cost", and they are different questions.

## What is excluded, and why

- **`community: sibling NativeText`** — 1,000 sibling `NativeText`s with no
  containers. Bimodal on the simulator: 49ms and 104ms in different runs of the
  same build, with a spread over 100%. Not reported for either build.
- The single-article tier settled to 46.7 / 47.3ms across the final runs, but
  produced one 13.9ms outlier earlier. Its marginal is reported; treat it as
  the least stable row in the table.
- **A physical device would be better.** The simulator shares a CPU with the
  host and throttles differently. Everything here is a simulator number, and
  the shapes — not the absolute milliseconds — are what should be carried
  forward.

## Reproducing

```
./bench-sizes-crosstree.sh /path/to/upstream-worktree .   # the struct-size table
```

For the speed and process-memory numbers: build RNTester in Release from each
tree, install both (their bundle identifiers differ, so they coexist), run
`packages/rn-tester/scripts/device-bench-rss.py`, and launch with
`-route SharedTextBenchmark`. Only one of the two apps may run at a time — they
share the collector, and the resident-set sampler finds the process by name.
The bare-string tiers are on the branch only, at `-route DeviceTextBenchmark`.
