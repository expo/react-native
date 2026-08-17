# Per-PR verification matrix

> **Which benchmark these numbers are.** Performance figures in this directory
> come from five different measurements on different scales — see [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) for the
> tags and what each can and cannot tell you. Test counts and [engine] timings, per
> pull request in the sequence.

Evidence that each PR in `upstream-pr-sequence.md` is correct and costs what
it claims, on both platforms. Two kinds of evidence:

- **Engine-shared (Fantom):** the C++ renderer under test is the SAME code on
  iOS and Android — Fantom (Hermes + the cxx platform) exercises it directly,
  so a green Fantom suite verifies the shared engine for both platforms at
  once. Layout, cascade, run building, whitespace, measurement all live here.
- **Platform (RNTester on simulator/emulator):** what Fantom cannot see — the
  real text stacks (CoreText / StaticLayout), mounting, painting, touch. CDP
  rect-verify scripts assert layout relations from `measureInWindow` on the
  running app (no screenshot subjectivity); screenshots cover paint-only
  properties.

Baselines on this machine: full Fantom suite 3,129 passed / 207 suites;
release (-O3) benchmarks via `./bench-string-children.sh`; iOS = iPhone 17
Pro simulator (iOS 26.5); Android = `rntester` AVD (android-36, arm64-v8a).

Platform harness: `packages/rn-tester/scripts/{css-display-cdp-verify.js,
cascade-cdp-verify.js <ios|android>, inline-metrics-verify.js}` — RNTester
launches directly into an example screen (`-route` on iOS, `--es route` on
Android), the screen publishes `measureInWindow` rects to
`globalThis.__displayVerify`, the script reads them over Metro's inspector
(CDP) and asserts the layout relations. Both platforms run feature flags via
their RNTester overrides (`RNTesterFeatureFlagsOverrides`).

## The matrix

Each PR row names the exact evidence for THAT PR's surface: the Fantom
suites that exercise it (the same C++ ships on both platforms, so these
verify the shared engine for iOS and Android at once), the named on-device
checks where platform behavior differs, and the benchmark rows that pin its
performance story. Until the PR branches are cut, per-PR verification means
per-PR-SURFACE verification — the suites listed on a row are exactly the
tests that ride that PR when it is cut, so each branch arrives with its
evidence attached; stage-gated per-branch CI becomes mechanical at that
point.

| PR | correctness evidence (named) | performance evidence (named) | on-device |
| --- | --- | --- | --- |
| 1 TextAttributes shrink | entire text stack rides on it: `Text-itest`, `StringChildren-itest`, full suite green | size probe `TextAttributes: 168` + static_assert; −64 B/fragment; no designated-init sites (swept) | engine-shared |
| 2 Display enum+flag | `StringChildrenNativeBlock-itest` (parse/store cases) | inert by construction (flag-gated value) | engine-shared |
| 3 Block layout | `StringChildrenNativeBlock-itest`; CDP `escapeOuter.h=30`, `escapeMid.h=10` | no flag-off path touched | iOS+Android CDP ✔ |
| 4 Margin collapsing | `StringChildrenBlockMargins-itest` (siblings, collapse-through, nested escape); CDP `marginSiblings.h=50`, `mid pushed down by escaped margin=20` | ditto | iOS+Android CDP ✔ |
| 5 Floats (optional) | `StringChildrenBlockFloats-itest` incl. the unwired-conversion canary | ditto | engine-shared |
| 6 #text node types | `StringChildren-itest` node construction; `ReadOnlyText-itest` (DOM side) | inert until wired | engine-shared |
| 7 #text wiring | `StringChildren-itest`, `StringChildrenBehavior-itest` (all bare-string rendering flows through it) | `InlineAppendScaling-benchmark` rows (O(n) construction) | engine-shared |
| 8 traits+downcasts | every layout pass uses the downcasts: full suite; `StringChildrenMixedContent-itest` | RTTI removal profile receipt (perf plan Round 2) | engine-shared |
| 9 inline box props | `StringChildrenInlineBox-itest`, `InlineBorderBox-itest` | parse flag-gated + skipped on root paragraphs (verified zero probes off) | engine-shared |
| 10 run node | `StringChildrenInlineMetrics-itest`, `InlineBaseline-itest`, `LineBreak-itest` | — | engine-shared |
| 11 run building | `StringChildren-itest`, `StringChildrenMixedContent-itest`, `IntrinsicFlexDirection-itest` | `InlineAppendScaling-benchmark`: 50→400 linear (1.15→17.1ms) | engine-shared |
| 12 measure+whitespace | `WhiteSpaceValues-itest`, `WhiteSpacePre-itest`, `LineBreak-itest` | measure-cache correctness pinned by the suites | engine-shared |
| 13 paint state+attachments | `StringChildrenBaseline-itest`, `OverflowBaseline-itest`; lazy state (`ViewComponentDescriptor::createInitialState` = nullptr) | `StringChildrenOverhead-benchmark` rows 0–5 parity, rows 6–7 2.0×; `StringChildrenCosting-benchmark`; `TextAlternatives-benchmark` | + platform paint (14/15) |
| 14 iOS mounting | String Children RNTester screen (runs interleave with children, screenshot); all 18 iOS CDP checks flow through iOS paint; `DeviceTextBenchmark` iOS release run completes all tiers; pixel-aligned `containerFrame` is the single paint+hit accessor (assert-pinned) | iOS release: grouped 43ms vs NativeText 224ms; alignment collapsed sim bare-rows 224→131ms (glyph cache); iPhone 15 Pro hardware: bare 137.1 vs NativeText 223.0 | **iOS ✔** |
| 15 Android mounting | same screen on emulator (drawTextRun path, screenshot); all 18 Android CDP checks re-run green ON the reuse+alignment code; `DeviceTextBenchmark` Android release run; probed 100% handoff hit rate (Cascade screen); every handoff mismatch degrades to rebuild by construction | Android release (same-session tiers): bare 63.7ms vs NativeText 78.4 vs `<Text>` 93.6 on 1k rows (floor 23.2); messages 27.8 vs 41.0; article 26.3 vs 28.2 — reuse removed the probed 16.3µs/run UI-thread rebuild | **Android ✔** |
| 16 display:'inline' | `StringChildrenDisplayInline-itest`; CDP `box starts inside container, after text` | — | iOS+Android CDP ✔ |
| 17 atomic inlines+baseline | `AtomicInlineBox-itest`, `InlineBaseline-itest`; CDP `inlineBox.w=30`, `inlineBox.h=40`, `flex contrast taller than inline flow` | — | iOS+Android CDP ✔ |
| 18 display:contents | `DisplayContents-itest`; CDP `contiguity height parity` | — | iOS+Android CDP ✔ |
| 19 inheritable props | `CascadeBoundary-itest` parse layer; `View-nativeCSSParsing-itest` untouched flag-off | +68 B measured + `ViewProps` static_assert; declaration-order + dedup constraints baked in (the +26%/+33% findings) | engine-shared |
| 20 cascade complete | `CascadeBoundary-itest` (17), `InlineCascade-itest`, `CascadeSiblingRerender-itest`, `CascadeLayoutClone-itest`, `StringChildrenBehavior-itest` | overhead rows 2–5: inheritable-update parity (≤5%) | iOS+Android CDP: all 8 cascade checks each ✔ |
| 21 `all` boundaries | `CascadeBoundary-itest` revert-vs-initial ×6 new tests | overhead row 5: boundary skip path | iOS+Android CDP: revert/unset/inherit/initial checks ✔ |
| T8 geometry/events | `ReactNativeElement-itest`, `ReadOnlyText-itest`, `FantomEventHandlers-itest`; span-tap wired in Display:inline screen | `ReactNativeElement-traversal-benchmark` | engine-shared + manual tap |

## Results

(filled in as runs complete — every number below is from this machine, this
code, reproducible with the listed command)

### Engine-shared correctness — DONE
Full Fantom suite: **3,129 passed, 0 failed** (207 suites), run twice on
frontier `e8dbc3aefbd`+. Command:
`FANTOM_FORCE_OSS_BUILD=1 node node_modules/jest/bin/jest.js --config private/react-native-fantom/config/jest.config.js`

### Struct sizes — DONE
`./bench-string-children.sh --sizes`: TextAttributes **168**,
YogaLayoutableShadowNode **1128**, ViewShadowNode **1128** — all under their
static_assert ceilings.

### Release benchmarks — DONE (quiet machine, p50 of 50, release -O3)

The tables in this section are the mid-day measurements that drove the
fixes, kept as the narrative record; the CANONICAL numbers — every suite,
one session, at the final tip `2affd860114` — are in the last subsection
below and in the memo.

Verified against a pre-change baseline (same command, code from before the
revert/gating commit): **nothing regressed; both flag configs got faster.**

| row | pre-change off | pre-change on | today off | today on |
| --- | --- | --- | --- | --- |
| mount 1365-View tree | 17.27ms | 17.44ms | 16.66ms | 16.58ms |
| update inheritable, 1365 Views | 2.15ms | 2.21ms | 2.12ms | 2.14ms |
| update inheritable, one text leaf | 2.26ms | 2.38ms | 2.14ms | 2.14ms |
| mount 200 styled `<Text>` rows | 8.93ms | 9.15ms | **6.65ms** | **8.24ms** |
| mount 200 rows, bare strings | 9.09ms | 3.42ms | 6.67ms | **3.31ms** |

Two lessons the run itself taught:

- The benchmark caught a REAL regression first: an early version of the
  parse gating hoisted the 11 inheritable-key probes into the ctor body,
  breaking RawPropsParser's monotonic index-order optimization (+26% on
  Text-row mounts flag-on). Fixed by gating per-field in place, in
  declaration order — the comment now says why the position is load-bearing.
- The styled-Text row's on/off gap (8.24 vs 6.65) was NOT a regression —
  flag-on was faster than before (9.15 → 8.24). Parse gating made flag-OFF
  25% faster by skipping the probes, which exposed the real flag-on price:
  a styled `<Text>` parsed its style keys twice (TextAttributes + the
  inheritable fields). FIXED the same day — see "the find of the run"
  below; the dedup is in the code PR 19 will carry, not a follow-up.
- Benchmarks only count on a QUIET machine: the same suite run while Gradle
  compiled C++ produced 4–6× inflated, wildly variable numbers.

### The find of the run: the parity claim had a broken control

Once flag-off parsing stopped probing the inheritable keys, the true
baseline appeared and flag-on plain-`<Text>` mounts measured **+33%**
(29.3 vs 22.1 ms / 1k lines): every `ParagraphProps` parse probed its
style keys twice — once into `TextAttributes`, once into the `inherited*`
cascade fields — plus inline-box probes no root paragraph reads. The old
"identical within noise" comparison had BOTH configs paying the probes.

Fixed (`0419ac44e68`): paragraph props copy from the already-parsed
`textAttributes` (zero re-probes; `whiteSpace` keeps its one cascade-only
probe), and root paragraphs skip the inline-box probes. After:

| workload | flag off | flag on |
| --- | --- | --- |
| 200 styled `<Text>` rows | 7.34ms | 7.50ms (**2.1%**) |
| 1k plain `<Text>` lines | 23.8ms | 21.7ms (noise) |
| 15k plain `<Text>` lines | 394ms | 346ms (noise/limit) |
| 15k lines, bare strings | — | **224ms** |

`<Text>` itself is now FASTER than before this feature's work under both
flag values (the old measured baseline was 452 ms / 15k). Bare strings:
2.1× on styled rows, 1.55× on plain lines vs today's faster `<Text>`.

### iOS platform checks — DONE (iPhone 17 Pro sim, iOS 26.5, final code)
`cascade-cdp-verify ios`: **8/8** (default boundary, unset/inherit
opt-ins, revert-keeps-boundary on Text, revert-inherits on View,
initial isolation, live signals). `css-display-cdp-verify`: **10/10**
(atomic inline box in flow, flex blockification, sibling margin
collapse = 50, nested escape 30/10/20, none/abs contiguity parity).
String Children screen renders bare-string runs split around block
children in document order (screenshot). Build note: the size guards
needed per-OS ceilings — the apple/arm64 gate also matched iOS, where
SharedColor et al are legitimately larger (TextAttributes 288 vs 176
macOS); iOS pinned at ViewShadowNode 1200 / TextAttributes 288 /
ViewProps 2400.

### Android platform checks — DONE (rntester AVD, android-36, final code)
`cascade-cdp-verify android`: **8/8** — the same relations on the real
StaticLayout stack. `css-display-cdp-verify android`: **10/10** — the
first Android verification of block layout, margin collapsing, and
inline display (closing the old "T10 emulator verification" gap).
String Children screen renders runs interleaved with block children via
the drawTextRun path (screenshot). Build notes: TWICE hit the
stale-prefab-headers ABI trap (a header signature change — even adding
a defaulted parameter — changes mangled symbols; libappmodules links
against prefab copies): first as a SIGSEGV in convertRawProp at
descriptor construction, then as a clean undefined-symbol link error.
The fix each time: delete ReactAndroid/build/prefab-headers +
intermediates/prefab_package* + rn-tester android/app/.cxx.

### Canonical numbers at the final tip (`2affd860114`, one session)

Sizes: TextAttributes 168 / YogaLayoutableShadowNode 1128 /
ViewShadowNode 1128. Flag on/off parity: every overhead row within ±5%
run noise (styled 200 `<Text>` rows: 6.65 off vs 6.81 on; 15k plain
lines: 354 off vs 345 on). Wins with the feature: 200 styled rows 3.3ms
bare vs 6.7ms `<Text>` (2.0×); 1k plain per-line 15.1 vs 23.3 (1.5×);
1k lines in one container 2.2ms vs NativeText's 9.1ms (4.2×); grouped
100×10 4.5ms (2.0×). NativeText tier (their-approach proxy, flag off):
8.8ms/1k, 145ms/15k. Inline append scaling stays linear (50→400:
1.15→17.1ms).

### Real-app benchmarks — DONE (release builds, sim + emulator, scenario suite)

RNTester `DeviceTextBenchmark` (setState → first onLayout, median of 10
after 3 warmup; scenario-first after benchmark review). iOS release sim /
Android release emulator: settings floor 19/32; rows+bare 243/104;
rows+Text 240/92; rows+NativeText 230/84; messages Text-bodies 38/29 vs
bare-bodies 42/32; article Text 7.5/45 vs bare 7.1/35; community sibling
NativeText 225/74 (ms). Reading: platform text layout dominates device
mounts (iOS per-row tiers within ~6%); Android bare per-row runs 14–24%
behind — recorded as a platform-path optimization target; component count,
not text primitive, is the big end-to-end lever. iOS build note:
RNTester's `bundleURL` is now DEBUG-gated to load the embedded bundle in
Release.

### Overnight spec-correctness campaign (2026-08-13)

Three new suites (all committed, all green in the full run):

- **StringChildrenFlattening-itest (6)** — the mount-side optimizations vs
  the shadow-side cascade: a View carrying ONLY inheritable text styles
  stays flattened (the cascade needs no mounted view); text-bearing Views
  never flatten; document order survives hoisting; inheritable restyles
  through flattened ancestors create zero views; view culling round-trips
  styled run containers; boundaries hold beneath flattened ancestors.
  Harness rule discovered: `nativeID` itself defeats flattening — detect
  by counting View creates.
- **WPTDerived-itest (8)** — cases derived from named web-platform-tests
  files (css-cascade/all-prop-001, css-text white-space processing,
  control-chars, break-spaces-001). Caught and fixed a REAL spec bug: the
  IFC trailing-space strip ignored the white-space mode — under
  pre/pre-wrap/break-spaces a trailing space is preserved content
  (css-text-3 §4.1.3). All Safari-pinned WhiteSpace suites stay green with
  the fix.
- **RunsEventsGeometry-itest (5)** — DOM Events bubbling order through
  span-like inline Views; CSSOM fragment rects for text-vocabulary inline
  elements; anonymous boxes invisible to childNodes (CSS 2.1 §9.2.1.1);
  bare text nodes are real DOM Text (nodeType 3). One DOCUMENTED gap,
  pinned so closing it flips the test: a display:'inline' View is
  pressable in the run but its getBoundingClientRect does not yet consult
  fragment rects.

Also in the same overnight window, the article-shape optimization
(`b527a56f7ce`): content-build memoization (3 builds → 1 per box, NaN-safe
cache key), copy-on-write white-space pass with vectorized identity
probes, and a span-based deterministic measurer — article `<Text>`
442→350µs, article bare 588→494µs, message-list bare 2.31→2.14ms, no tier
regressed.

Final overnight stamp: full Fantom suite **3,149 passed, 0 failed** (211
suites); CDP suites re-run on REBUILT platform binaries containing every
overnight change — iOS 8+10, Android 8+10, **36/36**; perf guard: sizes
168/1128/1128 unchanged, every overhead row within the noise band, the
feature-syntax row at its best measurement yet (3.16ms).

### Cross-CPU portability + post-SWAR device re-run (2026-08-13)

Portability, proven at three levels: (1) EXECUTION — a dual-architecture
fuzz harness runs the shipped SWAR+COW collapse algorithm against an
independent naive reference over 300,000 randomized cases (whitespace-
heavy, multi-byte UTF-8, both modes, both entry states), byte-identical
on native arm64 AND on x86_64 under Rosetta; (2) COMPILE — the Android
release build now compiles all four ABIs (arm64-v8a, armeabi-v7a, x86,
x86_64), covering 32-bit devices and Intel emulators; (3) DESIGN — the
SWAR is plain C with memcpy loads (unaligned-safe) and
byte-order-agnostic masks, no intrinsics anywhere.

Device benchmarks re-run on release builds carrying the SWAR + inline-
rect changes. iOS sim: bare rows 277.7 vs Text rows 283.2 (bare now
ahead within-run), articles at parity (6.8 vs 6.5 ms). Android emulator:
bare rows 97.7 vs Text rows 104.9 — the per-row gap recorded earlier
(bare 14–24% behind) has closed and inverted within-run, consistent
with the collapse scan leaving the bare path. Cross-session absolute
numbers drift ±25% on the emulator (floor 32→24 ms between sessions), so
only within-run orderings are treated as signal.

### Benchmark-integrity audit (goal-driven review)

Auditing the stack for fast-but-wrong hazards found one real one: tiers
rendered in a BOUNDED root, and platform text engines clamp layout work
at the constraint — on device, a 1,000-line article tier laid out only a
screenful and reported a flattering number (the harness's deterministic
measurer still scanned full strings, so engine ratios were unaffected,
but device absolute numbers under-measured tall content). Every tier in
StringChildrenCosting and DeviceTextBenchmark now renders inside a
ScrollView — where real lists and articles live — making the main axis
unbounded, and a new StringChildrenCostingSanity suite permanently
asserts each benchmark shape lays out its FULL claimed content (line
counts by height; identical content across head-to-head pairs; real
text in the rendered output). Corrected scroll-hosted canonical numbers
(release, p50): settings floor 12.3ms, +bare 15.1 (**+2.8µs text/row**),
+NativeText 17.6 (+5.3), +Text 28.3 (+16.0); messages bare 2.11 vs Text
3.17; article Text 418µs vs bare 427µs — parity, now with proven
20,000pt layout; community shape 9.1ms. No leftover instrumentation
(swept); the fuzz harness lives in scripts/, outside any measured path.

### Scroll-hosted device re-run (corrected methodology, both platforms)

The re-run vindicates the audit: the bounded-box device numbers had
under-measured tall content badly — article iOS 6.5→39 ms unclamped
(~1/6 of the work had been measured), community shape Android 77→242 ms
(3×). Honest per-row orderings, full layout proven: Android — bare
strings fastest (149 vs NativeText 180 vs `<Text>` 208 ms/1k rows); iOS —
NativeText 117 < `<Text>` 199 < bare 224 ms. Message and article shapes
at near-parity on both platforms (Android article: bare 37.9 vs Text
38.7; iOS: bare 38.0 vs Text 39.0). Ad-hoc device build shipped from the
same commit (archive → ad-hoc export → EAS, bytecode header verified).

### Real-hardware ground truth (iPhone 15 Pro, ad-hoc build)

User-run results on physical hardware settle the per-row question: bare
strings are the FASTEST per-row tier on device — 137.1 ms vs NativeText
223.0 vs `<Text>` 229.3 per 1k rows (floor 25.6) — marginal text cost
bare +111µs vs NativeText +197 vs Text +204, matching the engine
harness's ordering (+2.8/+5.3/+16.0µs). Messages 48/53, article
41.8/44.9, community 215.1 ms. The iOS SIMULATOR's inversion (bare 224
vs NativeText 117) is a simulator paint artifact — but NOT a bare-only
one: bracket profiling shows CoreGraphics software glyph rasterization
(A8_mark_*) dominating EVERY text tier on the sim (29–58% of active
time), as it must, since the same glyphs rasterize regardless of tier.
The sim's tier ordering therefore reflects how much of that software
paint lands inside each tier's measured setState→onLayout window (and
possibly per-tier redraw counts), not engine cost. Open item recorded:
count draw invocations per tier and check run-frame pixel alignment
(fractional origins defeat the glyph cache) — a real potential paint
optimization either way. Rule stands, more precisely: on the simulator,
paint dominates and its accounting differs per tier, so per-row iOS
timing comparisons are only trustworthy on hardware; the simulator
remains valid for layout relations (CDP) and engine-relative work.

### Final stamp
Full Fantom suite on the final code: **3,129 passed, 0 failed** (207
suites). Both platforms' CDP suites 18/18 each on the same commit.

### Paint vertical: run layout reuse + pixel alignment (2026-08-13)

The trailing paint work was folded into its vertical (and into PRs 14/15
in the sequence doc) rather than landing as follow-up fixes. Evidence on
the folded code:

- **Correctness**: full Fantom **3,158 passed / 0 failed**; Android CDP
  18/18 (cascade 8 + display 10) re-run on the reuse build; Cascade
  screen visual check clean. The handoff cannot render wrong content by
  construction: mount claims a parked layout only after deep
  content-equality (a real MapBuffer walk — `ReadableMapBuffer.equals`
  compares whole backing buffers and can never match a nested buffer),
  density, and width-validity checks, and every mismatch falls back to
  the previous rebuild path.
- **Mechanism verified, not assumed**: logcat probe showed 100% reuse
  (every content run's take found a verified entry; duplicate state
  deliveries deduped; probe removed before commit).
- **Performance** (release emulator, one session, scroll-hosted tiers):
  1k settings rows — floor 23.2ms, **bare 63.7**, NativeText 78.4,
  `<Text>` 93.6; messages **27.8** vs 41.0; article **26.3** vs 28.2.
  Bare strings are the fastest text primitive on Android in every
  scenario; before the fold they trailed NativeText by ~15ms/1k — the
  probed 16.3µs/run UI-thread rebuild, now gone. Engine benchmark
  ordering unchanged (the cxx measurer path is untouched).
- **History**: prefix + six verticals byte-identical through the fold
  (their evidence above carries); the paint vertical's tree differs from
  the pre-fold tip only by deleting two stray blank lines.

### Tier-fairness audit (2026-08-13, user-prompted): two hidden credits

Scrutinizing why bare trailed in some device tiers found the benchmark
itself was unfair — in the OTHER tiers' favor:

1. **Flattening credit.** A prop-less `<View>` row flattens away around
   a `<Text>`/NativeText child but cannot flatten around a bare string
   (the runs live on it). Mount-log probe: floor row = 2 view creates,
   bare row = 2, Text row = 1, NativeText row = 1. The Text tiers were
   skipping the per-row host view the floor prices in.
2. **Empty-props parse credit.** A View with no props skips props
   parsing entirely (~18µs/row measured). Tiers with naked `<View>`
   rows dodged the ViewProps parse every real row (which has styles)
   pays; the bare messages/article tiers already paid it for their
   `whiteSpace` style.

Fix: every tier's row carries `collapsable={false}`, matching the floor
and the scenario's own premise (rows exist because they carry handlers/
padding — they are materialized and parsed in real apps); the article
Text tier gains the same container View the bare tier always paid for.
Verified: mount counts equal across tiers; sanity suite green.

**Corrected canonical numbers (fair tiers):**
- Engine (quiet machine, p50): floor 73.1ms/1k; marginal per row
  bare **+22.6µs** / NativeText +35.6 / `<Text>` +66.0; messages bare
  7.49ms vs Text 11.2 (1.5×); article 1.01–1.08ms — parity in noise.
- Android emulator release: floor 26.2ms; bare **61.7** vs NativeText
  91.5 vs Text 94.6 (marginals +35.5 / +65.3 / +68.4µs/row); messages
  bare 27.0 vs 38.5; article bare 22.7 vs 27.8 — bare wins every
  head-to-head.
- iPhone 15 Pro hardware (build 836f928c: fair tiers + the iOS run
  TextKit storage cache + the multiplier publish fix, user-run
  2026-08-13): floor 23.9ms; settings bare **143.6** vs NativeText 154.4
  vs Text 161.0 (marginals +119.7 / +130.5 / +137.1µs/row); messages
  bare **35.9** vs Text 50.4 (1.40×); article bare **29.4** vs Text 41.3
  (1.40×). The two shapes where bare trailed pre-cache (53.2 vs 47.2,
  43.4 vs 41.4) flipped to 1.4× wins — matching the sim A/B's predicted
  ratio exactly. Bare strings are the fastest text primitive in every
  scenario on BOTH platforms' hardware.

Earlier scroll-hosted device numbers above carry the two credits and
UNDERSTATE bare's lead; superseded by this section.

### Benchmark methodology, corrected — and what it then found (2026-08-14)

The device/sim scenario benchmark ran each tier's iterations back to back,
which made tier identity and position in the session the same variable, and
ran every tier on the SAME strings, which let the content-keyed caches carry
work from whichever tier ran first into all the others. Three changes:

- **interleaved**: one tier per round, rotating position each round, so drift
  is common-mode and cancels in the floor subtraction rather than landing on
  whichever tiers run late (worst on the floor, which ran first and is
  subtracted from everything);
- **per-tier content**, identical in length and shape, so no tier warms
  another's caches;
- **a drift control and a per-tier spread**, both on screen and in the
  collected payload. The control immediately paid for itself: at the original
  3 warmup iterations the second half of a session still ran 15.4% FASTER than
  the first — the samples were riding the warm-up curve. Warmup is now 8
  ROUNDS (every tier warm before any is sampled), which brings drift to
  +5.7%.

The spread is what makes a result readable. On a busy host the 1k-row tiers
run at ±20–64%, far wider than the bare-vs-Text gap, and a median alone
reports 56ms and 95ms for the same tier on two runs with equal confidence.
Numbers from this methodology are tagged `interleaved-v2` in the payload and
are NOT comparable with anything recorded above it.

What the corrected benchmark then found is recorded in Theme 8 of the PR
sequence: the DOM-geometry pass was measuring every run, including the runs
with no element to stamp. Post-fix, quiet host, iOS 26.5 simulator:

| tier | before | after |
| --- | --- | --- |
| 1k rows + bare string | 149.3 ±36% | **97.5 ±1%** |
| 1k rows + `<Text>` | 138.1 ±20% | 212.9 ±40% |
| 100 message bodies, bare | 81.7 ±2% | 56.4 ±48% |
| 1k-line article, bare | 70.3 ±3% | **48.6 ±4%** |
| floor | 22.8 | 22.7 |

Marginal over floor on the settings-rows shape: bare 74.8ms vs `<Text>`
190.2ms vs NativeText 124.2ms. Bare's own figures are now the tightest on the
screen (±1%, ±4%), which is itself evidence: the removed work was a major
variance source, not merely a mean cost. The `messages` shape moved from a
clear loss to a tie and is still too noisy (±48%) to call — it wants a quiet
host or a device run before it is treated as settled.

### Device run on the corrected methodology (2026-08-14, build a23de088)

iPhone hardware, `interleaved-v2`, off `c51768d48ff`. **This is the run to
quote**: drift −1.2% and per-tier spreads of ±1–5% say the machine was quiet
and the samples had stopped moving, which is exactly what the drift control and
spread column were added to be able to assert.

| tier | ms | spread |
| --- | --- | --- |
| settings rows only (floor) | 22.9 | ±5% |
| settings rows + bare string | **185.4** | **±1%** |
| settings rows + `<Text>` | 251.8 | ±4% |
| settings rows + NativeText | 250.1 | ±4% |
| messages: `<Text>` bodies | 122.4 | ±2% |
| messages: bare bodies | **71.6** | ±5% |
| article: one `<Text>` | 103.6 | ±2% |
| article: bare block | **60.2** | ±3% |
| community: sibling NativeText | 230.0 | ±3% |

Marginal over the floor on the settings-rows shape: bare **162.5ms** vs
`<Text>` 228.9 vs NativeText 227.2 — **1.41×** faster than `<Text>` and 1.40×
faster than NativeText. Whole-tier ratios where there is no floor to subtract:
messages **1.71×** (71.6 vs 122.4), article **1.72×** (60.2 vs 103.6).

Bare strings win every head-to-head on real hardware, and bare's own figure is
the tightest number in the run (±1%).

The `messages` shape is the one to note. Before the duplicate-measure fix it
LOST on the simulator (81.7 vs 56.4); after the fix it was a tie there and too
noisy (±48%) to call. On device it is a 1.71× win with both sides at ±2–5%.
That shape is 100 separate runs, so it is where a per-run cost shows up — which
is precisely what the redundant text layout was.

Not comparable with the pre-`interleaved-v2` device numbers recorded earlier in
this document: those ran blocked, on shared strings, with 3 warmup iterations,
which the drift control later showed was still riding the warm-up curve.
