# `<Text>` and `NativeText` on upstream, against bare text on the branch

Measured on the iOS simulator (iPhone 17 Pro, iOS 26.5), **Release** builds of
RNTester, on a quiet machine. Upstream is a worktree of `main` at
`a8f68dac70e`, which is zero commits ahead of `upstream/main`. The branch is
`grid-lanes`.

## Five different benchmarks live in these documents. They are not a series.

Performance numbers appear in eleven files here, and they come from
measurements that answer different questions on different scales. Two of them
differ by roughly 5x for reasons that have nothing to do with which is faster.
Every figure in this directory is tagged with which of these it is; if one is
not, treat it as unlabelled rather than as comparable.

| tag | what it measures | scale | what it cannot tell you |
| --- | --- | --- | --- |
| **[engine]** | The C++ renderer only, under Fantom, with the DETERMINISTIC text measurer: component, shadow node, props, layout. No platform views, no real shaping. | µs per row | Anything about text shaping or view mounting — the two largest real costs. |
| **[device-absolute]** | A Release RNTester build, `setState` to `onLayout`, real text engines and real view mounting. Reported as the tier's whole time. | ms per tier | Nothing separates the tier's own cost from the rows it is mounted in. |
| **[device-marginal]** | The same run, reported as the tier's time MINUS a text-free floor tier of the same shape. | ms per 1,000 rows | Only meaningful between tiers of the same shape; a 100-row tier's marginal is not comparable to a 1,000-row tier's. |
| **[sizeof]** | `sizeof` compiled from each tree's headers. Exact, no sampling. | bytes per node | What a workload actually allocates — that needs node counts. |
| **[rss]** | The app's resident set, sampled from the host. | MiB per process | Per-node or per-tier retention; the allocator does not return freed memory. |

Three further distinctions matter as much as the tag:

- **Against WHOSE `<Text>`.** Numbers measured before 2026-08-16 compare bare
  text against the BRANCH's `<Text>`, which was carrying a regression that made
  every `<Text>` run a second full text layout. That inflated the baseline and
  overstated the advantage. Numbers here compare against **upstream `main`**,
  which is the question an adopter is actually asking.
- **Simulator or device.** Every cross-build table in this file is the iOS
  simulator, which shares a CPU with the host; the only physical-iPhone
  measurement is the branch-only section below, and the older figures in the perf
  memo. Absolute milliseconds do not carry between them — the device runs
  1.1–1.35× the simulator's times on this harness, and not by a constant factor.
- **Which harness.** `[engine]` numbers come from
  `StringChildrenCosting-benchmark-itest.js`; `[device-*]` from
  `DeviceTextBenchmarkExample` (nine tiers, branch only) and
  `SharedTextBenchmarkExample` (six tiers, both trees). Only the second can
  compare against upstream, because it is the only one that compiles there.

The engine and device numbers disagree by a large factor, and that is the
finding rather than a discrepancy: **[engine]** had bare text at 19.3µs/row
against `NativeText`'s 32.0 — 1.7x ahead — while **[device-marginal]** had it
2% behind. The whole difference was iOS view mounting, which the engine
benchmark cannot see. Neither number was wrong; reading either one alone would
have been.

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

Compiled from each tree's own headers, re-measured **2026-08-17** against
upstream `a8f68dac70e`.

| | upstream | branch | Δ |
| --- | ---: | ---: | ---: |
| `ViewShadowNode` | 1040 | 1016 | **−24** |
| `ViewProps` | 1424 | 1400 | **−24** |
| `ParagraphShadowNode` | 1424 | 1360 | **−64** |
| `ParagraphProps` | 1704 | 1728 | +24 |
| `TextAttributes` | 224 | 168 | **−56** |
| `AttributedString` | 264 | 208 | **−56** |
| `AttributedString::Fragment` | 416 | 456 | +40 |
| character data | 128 (`RawText`) | 128 (`#text`) | 0 |
| anonymous run box | — | 1112 | new |

Summed per node: a **View is 48 bytes smaller** than upstream (1040+1424 →
1016+1400) and a **`<Text>` is 40 bytes smaller** (1424+1704 → 1360+1728).

> **This table replaces an earlier one that had `ViewProps` at 1752 (+328) and
> `ParagraphProps` at 2080 (+376).** Those were real measurements, taken before
> the CSS-motion consolidation moved eleven `std::string`s of authored
> transition/animation longhands behind a single shared pointer. That change
> took ~350 bytes off `ViewProps` and turned the branch's per-View memory from a
> deficit into a surplus. Anything quoting +328 is stale.

Three of these are worth having whether or not anyone adopts the feature:
`TextAttributes` (−56, copied into every fragment and every measure-cache entry,
so it is what a text-heavy screen holds the most of), `AttributedString` (−56),
and `ParagraphShadowNode` (−64, every `<Text>` in every app). That is why the
`TextAttributes` shrink is PR 1 in the upstream sequence, behind no flag.

`Fragment` going **up** 40 bytes is the one regression in the table; it carries
the inline-element identity the fragment rects are stamped onto.

### Per process, measured

Resident set of the running app, sampled at each tier mount, 18 paired samples
across three runs per build:

**+21.2 MiB** (range +19.2 to +22.8).

Flat across every tier including the text-free floor, so it is a fixed cost of
the build — a larger binary and its static allocations — not a per-node cost.
1,000 views is now 48 KB *less* props+node memory than upstream, three orders
of magnitude below this either way.

The per-tier retention this pass was built to measure did not survive contact
with the allocator: mounted and unmounted samples come back within a few KiB of
each other because freed memory is not returned to the OS. The exact per-node
table above is the answer to "what does a node cost"; this is the answer to
"what does the process cost", and they are different questions.

## On a physical iPhone

Everything above is the simulator. The same nine-tier harness, run on a real
iPhone from the Release build at `b50748d9f23`:

| tier | whole tier | marginal over floor |
| --- | ---: | ---: |
| settings rows only (floor) | 25.4ms ±3% | — |
| settings rows + bare string | 144.4ms ±1% | **119.0ms** |
| settings rows + `NativeText` | 155.7ms ±2% | 130.3ms |
| settings rows + `<Text>` | 158.7ms ±2% | 133.3ms |
| messages: bare bodies | **54.6ms** ±1% | — |
| messages: `<Text>` bodies | 71.9ms ±1% | — |
| article: bare block | **44.6ms** ±1% | — |
| article: one `<Text>` | 59.9ms ±1% | — |
| community: sibling `NativeText` | 135.0ms ±2% | — |

Session drift +0.6%, so the run was not still warming up.

**Read this as a within-build comparison, not a cross-build one.** All three of
bare text, `<Text>` and `NativeText` here are the *branch's*. Nothing upstream
was measured on the phone, so none of these numbers replaces the against-upstream
tables above; only the shared six-tier harness compiles on upstream, and it has
not been run on a device. What this does answer is what the shapes look like when
real iOS view mounting and real CoreText run on real hardware.

Bare text is **10.7% cheaper than `<Text>`** and **8.7% cheaper than
`NativeText`** on the row shape (marginal), **24% faster** on the message shape
and **25.5% faster** on the article shape.

Three things the phone says that the simulator did not:

- **Against `NativeText`, the device is kinder than the simulator.** The
  simulator had bare text about 2% *behind* `NativeText` on the row shape; the
  phone has it 8.7% ahead. `NativeText`'s advantage was in the part the
  simulator exaggerates.
- **The `community` tier is usable here.** It was excluded from the simulator
  tables as bimodal — 49ms and 104ms in different runs of the same build, spread
  over 100%. On the phone it is 135.0ms at ±2%. Set beside it, 1,000 rows *with*
  real container views and a bare string in each costs 144.4ms: the shape
  fast-text and react-native-boost optimise for — bare sibling `NativeText`s, no
  containers — buys 7% over a shape that has containers and keeps press
  handling, accessibility and layout events.
- **The device is 1.1–1.35× the simulator, and not by a constant.** Floor
  22.9 → 25.4 (1.11×), bare rows 98.2 → 119.0 (1.21×), `<Text>` rows
  105.6 → 133.3 (1.26×), `NativeText` rows 96.5 → 130.3 (1.35×). The spread is
  the finding rather than noise around a single factor: `NativeText` is what
  slows down most on real hardware, which is exactly why its ranking against
  bare text flips. A first draft of this section claimed a uniform 1.25× and
  concluded the device was "not a shape change"; the per-tier ratios above say
  otherwise, and the `NativeText` reversal is the shape change.

**One guard did not run.** The harness posts laid-out heights to a collector on
`localhost:8347`, which a phone cannot reach, so the height check was inactive.
Note that the check did not *catch* the false 2.4× either — it exists because of
it; at the time, the nine-tier harness was the one without it. What stands in
here is thinner than a check: no tier came back anomalously *fast*, and every
tier sits in a 1.1–1.35× band against its simulator counterpart, whereas a
clamped layout shows up as one or two tiers far below the rest. Treat the device
section as corroborating the simulator's shapes, not as independently verified.

## What is excluded, and why

- **`community: sibling NativeText`** — 1,000 sibling `NativeText`s with no
  containers. Bimodal on the simulator: 49ms and 104ms in different runs of the
  same build, with a spread over 100%. Not reported for either build here; it is
  stable on the phone and reported in the device section.
- The single-article tier settled to 46.7 / 47.3ms across the final runs, but
  produced one 13.9ms outlier earlier. Its marginal is reported; treat it as
  the least stable row in the table.
- **The against-upstream comparison has not been run on a device.** The
  branch-only nine-tier harness has (see above, and it agrees with the simulator
  to a uniform factor), but putting upstream's `<Text>` on the phone means
  archiving and installing RNTester from the upstream worktree too. Until that
  happens, "16% faster than `<Text>`" is a simulator result.

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
