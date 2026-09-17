# Layout sharing: why a commit costs the whole list, and what to do about it

**Status.** Diagnosis complete and measured. One bug fixed
(`environmentGeneration_`, commit `7989dc97ce4`). The design below is **not
implemented** and has open questions marked as such.

**Reproduce.** `EXP_SEED_MESSAGES=30000 EXP_PROFILING=1` on the chat demo, send
one message, tap the perf pill for detail. Every number here comes from that.

## The problem

Appending one message to a 30,000-message transcript costs ~1.7s of commit:

    that commit: 1 ms transaction, 402 ms state, 904 ms hooks, 325 ms layout

React hands the tree over in a millisecond and renders seven rows. Everything
after that walks the whole conversation.

## Why

All three expensive phases skip subtrees the old and new trees hold the **same
object** for. They almost never can:

    state skipped ×616 subtrees and walked ×150637 (×13 with obsolete state)

Naming what loses its sharing says it is the rows and only the rows:

    WALKED VirtualView=269681
           native-chatbubble=1  element-box=152  View=28  …

And the pairs differ in nothing but identity:

    DIFFER tag=298/298 props=1 state=1 children=1 revision-same=1

Same props pointer, same state pointer, same children, same family. Byte
identical duplicates.

### The mechanism

1. A send appends a message, so the content view is cloned.
2. Cloning a parent **detaches every child's Yoga owner** —
   `YogaLayoutableShadowNode`'s copy constructor calls
   `updateYogaChildrenOwnersIfNeeded()`, which sets each child's owner to a
   sentinel. It has to: a Yoga node holds its own layout RESULTS, so two tree
   revisions cannot share one node and each read their own layout from it.
3. Whoever reaches those children next re-establishes ownership **by cloning
   each of them** — `Node::cloneChildrenIfNeeded` (Yoga's clone-node callback,
   which lands in `cloneChildInPlace`) or `configureYogaTree`'s adoption
   branch. Counted: **120,000 clones** for one appended message.
4. The clones are new shadow nodes, so every pointer-identity skip downstream
   misses, and the cost is paid three times over.

**The variable is FAN-OUT at one node**, not depth, size, or change frequency.
Thirty thousand children under one parent is thirty thousand clones whenever
that parent is cloned.

## What it is not

Each of these was a hypothesis, and each was killed by a counter rather than by
argument. They are recorded because they are the obvious guesses and someone
will make them again.

| hypothesis | measurement | verdict |
| --- | --- | --- |
| React keys wrong or unstable | `key={message.id}` | correct |
| React rebuilding row elements | row elements built ×7 | not 30,000 |
| obsolete native state (`VirtualView` mode) | ×13 of ×150637 | not state |
| tree size as such | layout is 325ms of 1667ms | not the tree |
| `React.memo` boundary too deep | moved above the row; no change | right anyway |

## Fixed on the way: `environmentGeneration_`

`configureYogaTree` skips a child already configured against the current
environment. That record was never copied by the copy constructor, so every
clone answered zero, was refused, reconfigured, and cloned again:

    WHY configured=33492 cascade=0 scale=0 font=0 rtl=0 env=416508 errata=0

416,508 refusals of ~450,000; every other cause exactly zero. Inheriting it
(guarded by `!fragment.props`, because it records THIS node's own `env()`
resolution) collapsed that walk entirely.

**It did not make the send faster.** Yoga's clone callback picks the same work
up one layer down. It removes a redundant clone site and a loop that fed itself.

## The design: copy-on-write ownership

The clone exists so two revisions can hold different layout for one node. When
the layout is identical there is nothing to differ about and sharing is safe.
So: let a cloned parent reference shared children under the sentinel owner, and
clone a child only at the moment a **different** value would be written into it.

### Gate the capability, not the call sites

Roughly thirty places write layout into a child, and

    Node* getChild(size_t index) const;

hands out a non-const pointer from a const method — write access is free
everywhere. A "remember the barrier" rule would be one forgotten call site away
from corrupting a shared node, with no compiler error and no test that fails.

Instead:

- `Node`'s layout setters become **private**, `friend class NodeWriter`.
- A `NodeWriter` is obtainable only from `rootWriter()` or
  `parentWriter.child(i)`; acquisition is where copy-on-write happens.
- The layout functions take a `NodeWriter` rather than a `Node*`. You cannot
  begin laying a node out without holding the right to write it.
- Reads keep taking `const Node*` — most of the algorithm is unaffected.

A thirty-first write site does not compile, because the ability does not exist
without a writer. The clone being lazy, the comparison being unskippable, and
`hasNewLayout` being honest all become properties of that one object.

### Phases

1. **Thread the parent.** `calculateLayoutInternal`/`calculateLayoutImpl`
   already carry `ownerDirection`, `ownerWidth`, `ownerHeight` — but not the
   node. Three places read `node->getOwner()` during layout, all for ancestor
   STYLE: `isInColumnStretchScrollSubtree`, one margin-collapsing test, and the
   ownership test itself. This is a **correctness prerequisite, not a tidy-up**
   — see the lifetime question below.
2. **Lazy ownership.** Remove the eager clone; acquire through the writer.
3. **Compare before cloning.** Where the win is: 91% of walked nodes come out
   unmoved at 1,000 messages (×7805 of ×8572), 99%+ at 30,000.

## Critical analysis

These are the ways the design above is wrong or incomplete. They are listed
first because a design doc that only argues for itself is advocacy.

### 1. Not every write is a layout result, and the difference is load-bearing

Yoga writes bookkeeping into children on every pass regardless of whether
anything moved — `setLayoutComputedFlexBasisGeneration(generationCount)` changes
**by construction** every pass. A naive "compare before writing" would see it
differ and clone every child, winning nothing.

So the writer has to distinguish **results** (frame, position, dimensions,
margins/borders/padding, overflow, direction) from **cache** (generation
counters, cached measurements), and let cache writes pass through to a shared
node without cloning.

That is a judgement per field, and it is the riskiest part of the design: too
strict and there is no win, too loose and two revisions read each other's
layout. It also needs an argument that sharing a cache between revisions is
safe — plausible, since Yoga's cache is keyed on available size and two
revisions asking the same question deserve the same answer, but it is an
argument and not yet a proof.

### 2. React Native's layer needs the same discipline, and this doc does not
cover it

`cloneChildInPlace` is not only Yoga's ownership mechanism; it is also how RN
gets a **mutable shadow node** to write layout metrics into.
`YogaLayoutableShadowNode::layout` does `childNode.setLayoutMetrics(...)` — if
the shadow node stays shared, that mutates a node belonging to a committed tree.
That is precisely the hazard the `getSealed()` guard in that function warns
about, and today the clone is what prevents it.

**So copy-on-write has to exist at both layers or neither.** The Yoga half alone
would turn a performance problem into a correctness one. This is the largest gap
in the design as stated.

### 3. `onLayout` semantics change

Making `hasNewLayout` honest means RN stops seeing unmoved nodes as affected, so
`onLayout` stops firing for them. RN's own comment in that loop says frame
comparison is "not advised" for this purpose and cites an internal diff. That
may be a deliberate contract. Changing it is a public behaviour change and
needs either a flag or an argument this doc does not have.

### 4. The owner pointer's lifetime

A shared child is referenced by two parents while `owner_` points at one. If
that parent is destroyed first, `getOwner()` dangles — today's eager clone makes
this unreachable. This is why phase 1 is a prerequisite rather than a cleanup:
after it, nothing in layout reads the owner, and the pointer can be left null.

### 5. A tempting shortcut that is wrong

"Leave the stale owner alone — a shared child's two parents have equal styles,
which is why it is shared." They need not. A parent's style can change while the
child stays shared, and then the margin-collapsing test reads the old parent's
`display` and is quietly wrong. The parent must be threaded, not inferred.

### 6. The claim that has not been tested

The design predicts that removing the clones restores sharing for
`progressState` and the commit hooks too — i.e. it addresses all ~1.6s and not
only the 325ms of layout. That follows from the measurements (the clones are
what make the pointers differ) but it is a prediction. The counters to check it
against already ship: `stateShared`/`stateWalked` and the commit's phase split.

## Rejected alternatives

- **Reduce fan-out (group rows into a tree of boxes).** Measured to work —
  119,409 layout nodes to 7,986 at 3,000 rows — and rejected by the project
  owner on the grounds that grouping introduces bugs of its own (boundaries by
  id, flattening, reveal cascades). It also treats a renderer problem as an app
  problem: every long list in every Fabric app has it.
- **Move layout results out of the node into a per-revision side table.**
  Cleanest semantics: sharing becomes free and ownership disappears. Rejected
  for now on size — layout results are read on nearly every line of the
  algorithm, and each read gains an indirection.
- **A write barrier at the ~30 write sites.** Rejected because a 31st site
  silently corrupts, with no compiler error. This is what motivated gating the
  capability instead.

## Instrumentation

All of the numbers above come from counters that ship in the app
(`RCTRenderStats` → `NativeRenderStats` → the perf pill's detail report):
the commit's four phases, layout nodes walked and how many came out unmoved,
state reconciliation's skip ratio and its obsolete-state count.

Two of that instrument's own bugs were caught by numbers that could not be true
— an unmoved count larger than the total it belongs to, twice — and the lesson
is in the commit for `ebe9fdaca99`: **a ratio whose halves are counted by
different code in different files is not a ratio.**
