# Design documents in this fork

Twenty-six design documents sit in this directory. They are not a reading
order, they are not all current, and several deliberately overlap — so this is
the index, and it says which is which.

Upstream React Native's own technical documentation is separate and lives in
[`__docs__/`](./__docs__/README.md); nothing here is part of it.

## Text as a child of any view

The largest body of work in the fork. These are one project with different
audiences, not five drafts of one document — check the audience before the date.

| document | audience | state |
| --- | --- | --- |
| [string-children-explained](./string-children-explained.md) | anyone; starts from "you can write this" | current |
| [string-children-summary](./string-children-summary.md) | someone with ten minutes | current |
| [string-children-report](./string-children-report.md) | the long plain-language account, including dead ends | current |
| [string-children-for-reviewers](./string-children-for-reviewers.md) | a reviewer deciding whether to ship it | current |
| [string-children-perf-memo](./string-children-perf-memo.md) | the performance and memory results | current |
| [string-children-perf-plan](./string-children-perf-plan.md) | the lab record, round by round | **dated by design** — its own header says later rounds changed its numbers; the canonical figures are in the memo |
| [text-children-plan](./text-children-plan.md) | the original design: bare strings, inheritance, `<b>`/`<i>` | current as design |
| [text-children-onboarding](./text-children-onboarding.md) | a new contributor, assuming no prior knowledge | current |
| [text-children-next-steps](./text-children-next-steps.md) | the backlog | **dated task log** — carries its own reader's note |
| [text-inheritance-boundaries](./text-inheritance-boundaries.md) | where inheritance stops, and why | current |
| [text-spec-coverage](./text-spec-coverage.md) | which parts of the specs are implemented | current |
| [text-vs-upstream-benchmarks](./text-vs-upstream-benchmarks.md) | numbers against upstream | current |

## Layout and the renderer

| document | what it is |
| --- | --- |
| [layout-sharing-plan](./layout-sharing-plan.md) | why one appended row costs the whole list, and a copy-on-write design for it — **with its own critical analysis; the design is not implemented** |
| [run-layout-reuse-plan](./run-layout-reuse-plan.md) | Android: hand the measured text layout to the mounting path instead of rebuilding it |
| [ios-run-draw-reuse-plan](./ios-run-draw-reuse-plan.md) | the same idea on iOS |
| [inline-rects-plan](./inline-rects-plan.md) | inline box rectangles |

## The keyboard accessory and the chat demo

| document | what it is |
| --- | --- |
| [KEYBOARD-PLAN](./KEYBOARD-PLAN.md) | **working notes** for the `keyboard-scroll` branch, started 2026-08-31 — a running log of the composer that follows the keyboard, not a settled design |

The demo those changes are exercised against is
[`packages/chat-demo`](./packages/chat-demo/), whose own README carries the
measurements — balloon geometry, the send flight, receipt timing — taken against
the platform's chat app frame by frame.

## CSS and the DOM model

| document | what it is |
| --- | --- |
| [element-model-design](./element-model-design.md) | how HTML elements are modelled |
| [box-model-scope](./box-model-scope.md) | what of the CSS box model is in scope |
| [dom-css-limitations](./dom-css-limitations.md) | what this renderer cannot do and why — the one to read before promising anything |
| [ua-styles-plan](./ua-styles-plan.md) | the user-agent stylesheet |
| [css-grid-summary](./css-grid-summary.md) · [grid-lanes-spec-coverage](./grid-lanes-spec-coverage.md) | grid |

## Getting it upstream

| document | what it is |
| --- | --- |
| [upstream-pr-sequence](./upstream-pr-sequence.md) | the order the changes can be landed in |
| [upstream-pr-review](./upstream-pr-review.md) | review notes |
| [upstream-pr-verification](./upstream-pr-verification.md) | how each is verified |

## A note on dates

Several of these say, in their own words, that they are dated. That is the right
habit and it is worth keeping: a document that records what was true when it was
written, and says so, is more useful than one silently rewritten to look
current. Where a number matters, prefer the document this index marks as
canonical for it.
