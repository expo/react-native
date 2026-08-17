# Text and CSS in the renderer

Working documents for putting text directly in a view and giving the renderer a
CSS box model. They lived in the repository root; a reviewer opening the project
should see React Native's own README and CHANGELOG there, not two dozen of ours.

Start here depending on what you came for.

## If you are reviewing the feature

| | |
| --- | --- |
| [string-children-for-reviewers.md](string-children-for-reviewers.md) | What changed, what it costs, and how to ship it. Read this first. |
| [upstream-pr-sequence.md](upstream-pr-sequence.md) | The 21 pull requests, in order, and what each contains. |
| [text-spec-coverage.md](text-spec-coverage.md) | Section by section against the CSS and DOM specs, with where each row is checked. |
| [dom-css-limitations.md](dom-css-limitations.md) | Every known gap, each marked at the code with a greppable token. |

## If you are looking at performance

| | |
| --- | --- |
| [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) | Speed and memory against upstream `main`, and what makes two binaries comparable. |
| [string-children-perf-memo.md](string-children-perf-memo.md) | The earlier measurements, and what the feature costs an app that never uses it. |
| [string-children-perf-plan.md](string-children-perf-plan.md) | Every optimisation tried, including the ones that did not pay. |

## If you are working on it

| | |
| --- | --- |
| [text-children-onboarding.md](text-children-onboarding.md) | The ramp-up: spec reading and a code tour. |
| [text-children-plan.md](text-children-plan.md) | The living design document. |
| [text-children-next-steps.md](text-children-next-steps.md) | The backlog, with how to verify each item. |
| [box-model-scope.md](box-model-scope.md) | What the box model does and does not cover. |
| [element-model-design.md](element-model-design.md) | How elements resolve to shadow nodes. |
| [text-inheritance-boundaries.md](text-inheritance-boundaries.md) | The cascade and the `all` reset. |
| [ua-styles-plan.md](ua-styles-plan.md) | The user-agent stylesheet. |

## Grid, and the run-reuse work

| | |
| --- | --- |
| [css-grid-summary.md](css-grid-summary.md), [grid-lanes-spec-coverage.md](grid-lanes-spec-coverage.md) | CSS Grid and Grid Lanes. |
| [run-layout-reuse-plan.md](run-layout-reuse-plan.md), [ios-run-draw-reuse-plan.md](ios-run-draw-reuse-plan.md) | Reusing the layout measurement built, rather than rebuilding it to paint. |
| [inline-rects-plan.md](inline-rects-plan.md) | `getBoundingClientRect()` on inline elements. |

## The test corpora these describe

Both live at the repository root because they are runnable tools, not reading:

- `text-conformance/` — mixed inline/block/flex layout and event targets, one
  case list run against real Safari, iOS and Android.
- `grid-lanes-conformance/` — the same arrangement for CSS Grid Lanes.
