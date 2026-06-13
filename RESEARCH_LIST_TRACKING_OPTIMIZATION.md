# Research: Per-Item Tracking Context in `{{#each}}` — Sliding-Window Contexts & Hierarchical (Binary) Validation

> Status: research only, no implementation. 2026-06-09.
>
> Question under research (paraphrased): *"In each loop we create a tracking
> context per item, and it's a slowdown. Could we do better — e.g. a 'sliding
> window of references' where general render logic lives in one instance and we
> just swap the context during render? And could we use 'binary validation'
> (binary search) instead of per-item tags?"*

---

## 1. What "tracking context per item" actually costs today

First, an important framing fact that changes both proposals:

**GXT's reactivity is push-based, not pull-based.** A dirty `Cell` maps
*directly* to its DOM opcodes (`opsForTag: Map<cellId, tagOp[]>` in
`src/core/reactive.ts:25`) and to subscriber formulas
(`relatedTags: Map<cellId, Set<MergedCell>>`, `reactive.ts:32`). The drain
(`syncDomSync`, `src/core/runtime.ts:111`) iterates only dirty cells and their
subscribers. **There is no per-render validation walk over per-item tags at
all.** This is unlike Glimmer-VM, where every render revalidates the tag tree
and per-item tags are a *read*-time cost.

Consequence: per-item tags in GXT are **not** a steady-state update slowdown.
For "update every 10th row" (Krausest), the drain touches exactly the ~100
dirty label cells and their ~100 opcodes — already O(dirty), optimal. The
per-item cost is paid at **row create, row destroy, and shared-cell fan-out**.

### 1.1 Per-row creation inventory (Krausest `Row`, compat mode, `hasIndex=false`)

Measured statically from the code paths involved
(`src/core/control-flow/list.ts` → `src/core/dom.ts`):

| # | Cost | Source |
|---|------|--------|
| 1 | key string + 7 map/set entries (`keyMap`, `indexMap`, `boundItemMap`, `itemMarkers`, `markerSet`, `rowCtxMap`, dup-cache) | `list.ts` `updateItems` / `_buildAndInsertRow` |
| 2 | 1 `Comment` marker DOM node per row | `list.ts:1218` |
| 3 | **RowContext** object + `cId()` + `addToTree` (→ `TREE.set`, `CHILD` Set alloc + add, `PARENT.set`, flag, destructor closure + registry entry) | `list.ts:413` `rowBodyCtx` |
| 4 | Component instance (`new Row(...)`) + `$_GET_ARGS` → **second** `cId()` + `addToTree` (another TREE/CHILD/PARENT/destructor set) + args `Proxy` | `dom.ts:1686`, `dom.ts:1243` |
| 5 | ~10 DOM elements created **one by one** (`api.element` + ~15 static `api.attr` calls). **No `cloneNode` anywhere in `src/core`** | `_DOM` in `dom.ts` |
| 6 | ~4–6 `MergedCell` formulas (3× `class={{this.className}}`, 1 modifier cell, text resolution), each: closure + lazily a tracker `Set` + pooled ops array + opcode closure + `relatedTags` Set entry + destructor closure | `dom.ts:252` `resolveBindingValue`, `$prop`, `$ev` |
| 7 | 2 `addEventListener` | `$ev` |
| 8 | `registerDestructorBatch(rowCtx, destructors)` | `dom.ts:900` |

Ballpark: **~25–40 heap allocations and ~15–20 map/set mutations per row**
beyond the unavoidable DOM. For create-1000 that's ~30k reactive-layer
allocations; the GC pressure and Map churn is the "slowdown" being asked about.

Note the duplication in row ownership: each row pays for **two** tree
identities (RowContext *and* the component instance), each with its own id,
tree entries and cleanup closure.

### 1.2 Where O(N) really appears at update time

`class={{this.className}}` evaluates `this.args.selected === this.id` → each
of the 3 class bindings per row is a `MergedCell` subscribed to the single
`_selected` cell. Selecting a row therefore:

1. dirties `_selected` → drain collects its `relatedTags` set: **3N formulas**;
2. sorts them (`sortSharedTags`, O(3N log 3N));
3. re-executes each: epoch `WeakMap` get/set, tracker `Set.clear()` + re-track +
   re-subscribe (`bindAllCellsToTag`), opcode run (DOM write skipped by
   `prevPropValue` guard for the N−2 unaffected rows).

So the *only* genuinely O(N) update in the benchmark is **shared-cell
fan-out**, and per-item tags are not the cause — per-item *subscriptions to a
shared cell* are. This has a well-known targeted fix (§4.2) that neither
proposal addresses directly.

### 1.3 Already-optimized paths (for context)

Clear → `fastCleanup` bulk `clearChildren` (O(N) destructors, O(1) DOM);
append → `_appendOnlyVerdict` incremental path; reorder → LIS with reusable
buffers; `hasIndex=false` skips per-row index formulas. The remaining hot
paths are **create / full replace** and **select fan-out**.

---

## 2. Proposal A — "Sliding window of references" (shared render program, swapped context)

Two distinct techniques hide inside this idea. They are separable and have
very different cost/risk profiles.

### 2.A1 Shared row program + compact per-row frames (million.js-block style)

Compile the each-body once into:

- a static `<template>` (cloned per row with `cloneNode(true)`), and
- a static **slot table**: `[ {path: [0,1], kind: text}, {path: [0], kind: class}, ... ]`
  shared by all rows of this list, plus one shared `update(frame, item, shared)`
  function generated by the compiler;
- per row, only a **frame**: `{ nodes: Node[k], values: unknown[k], item }` —
  one object + two arrays instead of 4–6 formulas/Sets/closures + 2 tree
  identities.

Render = clone + walk paths once to collect slot nodes + run `update`.
This is exactly the architecture of million.js `block()`, Stage0/domc, ivi
templates, and Vue Vapor; all sit at the top of js-framework-benchmark
precisely because create/replace cost collapses to "clone + k slot writes".

**How updates reach a frame without per-binding subscriptions** — that's the
real design decision, and it's where Proposal B (validation) comes in:

| Dep class | Route |
|-----------|-------|
| per-item cell (`cellFor(item,'label')`) | ONE subscription per row (not per binding): cell → frame. Opcode = shared `update` + frame state. Still push, still O(dirty). |
| shared cell (`selected`) | ONE subscription per **list**. On change, sweep all frames running only the slots that read shared state — tight array loop, no formula machinery, no re-subscription churn. Or better: keyed selector (§4.2) for `===` patterns. |
| block-param re-bind (keyed reuse with ref swap) | `frame.item = newItem; update(frame)` — subsumes the existing `__gxtRebindEachItem` hook (`list.ts:1323`). |

**What it wins:** per-row reactive-layer allocations drop from ~25–40 to ~4–6
(frame + 1 cell subscription + marker); create/replace becomes dominated by
`cloneNode`, which is dramatically cheaper than per-element `createElement` +
per-attr `setAttribute`. Memory per 10k rows drops by MBs. Destroy gets
cheaper too (drop one map entry + one subscription instead of a destructor
cascade over 5-6 closures and two tree identities).

**What it costs / breaks:**

1. **Applicability boundary.** Only "stable" bodies qualify: single-root or
   fixed-shape DOM, bindings that are attr/class/text/event slots, no nested
   control flow, no component invocations (or only inlinable ones). The
   Krausest row qualifies *only if the compiler can inline `<Row/>`* (it is a
   component with getters, an `...attributes` splat and a modifier). A
   realistic first milestone is inline-element bodies
   (`{{#each}}<tr>...</tr>{{/each}}`); component-bodied lists keep the current
   path. The existing `hasStableChildsForControlNode` detection
   (`plugins/compiler/serializers/control.ts:204`) is the natural gate.
2. **A second rendering path to keep correct forever.** `list.ts` is 2083
   lines of accumulated correctness: duplicate keys, position-qualified keys,
   re-entry guards, SSR/rehydration, async destructors/animation, HMR,
   Ember-host hooks (`__gxtRebindEachItem`, marker registry, KVO re-entry).
   Every one of those behaviors needs an answer in the fast path or an
   explicit bail-out to the slow path. This is the dominant cost of the
   proposal — not the runtime code, the *matrix*.
3. **Events** need delegation or per-row listeners anyway (per-row listener
   cost stays; delegation is its own project).
4. **Lifecycle/destructors:** modifiers returning destructors, `{{on}}`
   teardown — frames must carry an optional destructor list, reintroducing
   some of RowContext for rows that use them (pay-as-you-go is fine).

**Verdict:** sound and proven architecture; big create/replace win; high
implementation+maintenance cost. Worth doing **as a compiler-gated fast path
for stable inline-element bodies only**, after the cheaper wins in §4.

### 2.A2 Row recycling with re-pointable references (the literal "sliding window")

Render N row instances **once**; bindings read through a per-row *holder*
cell (`Cell<T>`); list changes re-point `holder.value = newItem` instead of
destroy+create. All subscriptions/opcodes/DOM survive; replace-all becomes
"swap N references and let push reactivity rewrite k slots per row".

GXT already has 80% of the plumbing: the keyed-reuse re-bind path
(`boundItemMap` + `__gxtRebindEachItem`, `list.ts:1314-1329`) does exactly
this for the stale-key case, and morph-retirement (f3c5c30) gives retired-row
bookkeeping. A retire-pool + re-bind generalization is a small runtime change
*mechanically*, **but**:

- It changes **keyed semantics**: row DOM identity no longer follows item
  identity. CSS transitions, focus/selection state, input values, third-party
  widgets inside rows will bleed across items. js-framework-benchmark would
  reclassify the implementation as non-keyed if applied by default.
- Therefore it must be **opt-in** (`{{#each items recycle=true}}` or a
  `@recycle` arg), like Ember's old `{{#each ... key="@index"}}` pattern or
  react-window row recycling.

**Verdict:** cheap to prototype, real-world useful for huge lists
(virtualized tables, log views), must never be the default. Orthogonal to A1
and composes with it.

---

## 3. Proposal B — "Binary validation" (binary search over hierarchical tags instead of per-item tags)

The idea maps to a known technique: **hierarchical dirty tracking** — a
balanced tree (segment tree / Fenwick / B-tree of tag combinators) over row
slots where each node stores `max(childRevision)`. Finding dirty rows =
descend from the root, skipping clean subtrees: O(d·log N) for d dirty rows.
This is what pull-based systems effectively do (Glimmer-VM's combinator tags
validate-and-skip subtrees; Merkle trees in databases; Adapton).

### 3.1 Standalone (replacing the push model for list rows): **net loss**

- Today a label update is O(1) per dirty cell: `tagsToRevalidate.add(cell)` →
  drain → direct opcode array. No search of any kind happens.
- With pull validation, the same update needs: bump a row version (requires a
  cell→row-slot map — the *same* bookkeeping as today's `opsForTag`), then at
  drain time descend the tree: O(log N) per dirty row **plus** tree
  maintenance on every insert/remove/reorder (rows move; the tree is over
  positions, so either remap on reorder or allocate stable leaf slots with a
  free-list — extra complexity exactly where `list.ts` is already hairy).
- It also doesn't fix the select fan-out: `selected === id` is a *computation*
  per row; a validation tree only tells you "row i is dirty", something must
  still mark all N rows dirty when `selected` changes — or you're back to
  per-row subscriptions.

So as a replacement for per-item tags *while keeping everything else*, binary
validation strictly adds work. **Push already beats binary search**: O(d) < O(d·log N).

### 3.2 As a companion to subscription-free frames (A1): **coherent, still probably unnecessary**

If frames (A1) remove per-binding subscriptions, something must route "item X
changed" to "frame i". Options:

- **(a) keep one push subscription per row** (cell → frame): O(d) updates,
  ~1 map entry per row. Simple; reuses 100% of existing reactive core.
- **(b) version-stamped items + segment tree**: zero per-row subscriptions,
  O(d·log N) discovery, but needs item→slot mapping (a map per row again…),
  reorder-stable leaf allocation, and a way for `cellFor(item,'label')` to
  know it should bump a row version instead of scheduling its own opcodes —
  i.e. a parallel invalidation channel through `Cell.update`.

(b) saves one Map entry + one Set entry per row versus (a) and costs a log
factor at update plus a new invalidation channel in `reactive.ts`. The
allocation delta is ~2 of the ~30 per-row allocations. **The win is in the
noise compared to A1 itself; (a) is the right routing.**

### 3.3 Where a coarse two-level version check *is* worth stealing

One cheap idea from this family fits GXT today: a **per-list epoch guard**.
`cached()` already uses global/per-cell revisions (`reactive.ts:743`). The
list-tag formula could snapshot `currentGlobalRevision()` and let `syncList`
early-exit when re-entered with no possible item-level change (Ember host
re-fires, KVO echoes). That's a 2-level "validation tree" (root only) — all of
the benefit that matters for the common case, none of the tree maintenance.

**Verdict:** do not build a binary/segment-tree validation layer. Keep push.
Adopt only the root-level epoch guard if profiling shows redundant `syncList`
re-entries.

---

## 4. What I'd actually do, in order of value/risk

1. **Template cloning for static structure** (create-path, all components, not
   just lists). `src/core` never calls `cloneNode` today; rows are built
   element-by-element. Compile stable subtrees to a shared `<template>` +
   `cloneNode(true)` + path-walk to dynamic slots. This is the single biggest
   create/replace win, requires no reactivity changes, no semantic changes,
   and it is a prerequisite shared with Proposal A1 anyway. (Vue Vapor, ivi,
   Solid all do this.)
2. **Keyed selector primitive** (update-path): a `selectorFor(listCell|cell, key)`
   à la Solid's `createSelector` — `Map<id, Cell<boolean>>`; on `selected`
   change only the old+new ids' cells dirty. Kills the 3N-formula fan-out →
   O(2). Compiler can pattern-match `{{eq @selected item.id}}`-shaped
   bindings, or it's exposed as a userland helper first. Small, isolated,
   high leverage; also removes the 3N re-subscription churn per select
   (`relatedTags` delete/re-add cycle in the drain).
3. **Slim the per-row ownership overhead** (create/destroy path, no new
   architecture):
   - lazy `rowBodyCtx` — allocate RowContext only when the body actually
     registers destructors (today it's unconditional, `list.ts:1279`);
   - single tree identity per row — let RowContext *be* the component's tree
     node for single-component bodies instead of two `cId()`/`addToTree`
     rounds;
   - pool RowContext objects (morph-retirement already gives the lifecycle
     hooks).
4. **A1 fast path for stable inline-element each-bodies** (the "sliding
   window" proper): shared slot-program + per-row frames, gated by the
   existing stable-children compiler detection, bailing to the current path
   for everything exotic. Reuses (1) and routes updates per §2.A1. Large
   effort; do after 1–3 and only with the e2e matrix (dup keys, SSR,
   rehydration, async destructors, HMR, Ember host) green on the bail-out
   boundary.
5. **Opt-in row recycling** (`recycle=true`): generalize
   `boundItemMap`/`__gxtRebindEachItem` re-bind + retire-pool. Never default,
   document the identity caveats.
6. **Skip:** segment-tree/binary validation as an invalidation mechanism
   (§3.1/3.2). Keep the push model; optionally add the root-level epoch guard
   (§3.3).

### Expected impact (rough, per 1k-row create)

| Change | Reactive-layer allocs/row | DOM build | Select cost |
|---|---|---|---|
| today | ~25–40 | ~10× `createElement` + ~15× `setAttribute` | O(3N) formulas |
| +cloning (1) | ~25–40 | 1× `cloneNode` + k slot writes | O(3N) |
| +selector (2) | ~25–40 | — | **O(2)** |
| +slim ctx (3) | ~15–25 | — | O(2) |
| +frames (4) | **~4–6** | 1× `cloneNode` | O(2) |

---

## 5. Appendix — Measured results (experiments run 2026-06-10)

All six proposals were prototyped in parallel git worktrees branched from
`exp/perf-baseline` (= this branch's HEAD + a shared harness,
`src/core/list-perf.bench.test.ts`: Krausest-shaped `{{#each}}` rendered via
the runtime compiler, happy-dom, median of 5 rounds). Numbers below are the
manager's **serial re-runs on an idle machine** (agent self-reports on the
loaded box were discarded where they didn't replicate). Experiment branches: `exp/perf-baseline` (harness), `exp/e1-selector`,
`exp/e2-slim-ctx`, `exp/e3-recycle`, `exp/e4-clone`, `exp/e5-frames`,
`exp/e6-binary-validation` (local worktrees). Full suite (3792 tests) green on every branch; the only
failing file everywhere incl. baseline is the pre-existing
`glint-environment-gxt` collect error (missing sub-package `common-tags`).

Idle baseline (ms): create1k 239.7 · update10th 1.53 · select20 38.45 ·
append1k 277.5 · replace1k 579.5 · clear1k 128.5 · create5k 3749.9.

| Experiment | Headline (verified) | Verdict |
|---|---|---|
| E1 `keyedSelector` (`src/core/selector.ts`, commit 7cace71) | select20 38.45→**23.97** (reactive work ≈−80%; residual is the harness settle floor); create1k +2% (per-key Cell alloc) | **Land** after adding a key-pruning hook tied to row teardown |
| E2 slim row ownership (commit 158557c) | All scenarios **within noise** of baseline — the agent's loaded-machine −24% claims did not replicate | Architectural cleanup only (lazy CHILD membership, removes redundant per-row destructor closure); don't sell as perf |
| E3 opt-in recycling `key="@recycle"` (commit 99a4fbb) | replaceAll1k **16.25 vs 579.5 (35.7×)** · recreate-from-pool −48% · clear −39% · update10th parity · **select20 +31%** (holder-cell entanglement) · default path untouched | Powerful but sharp-edged: strictly opt-in (non-keyed semantics, state bleed); the select regression needs holder-dep exclusion for shared-dep bindings |
| E4 cloneNode static block (`src/core/static-template.ts`, commit 2b56259) | create1k 240.4→**48.8 (4.9×)** with identical reactivity; Chromium raw-DOM check: native clone vs createElement only ~15% apart — the win is *skipping per-element framework work* | Confirms research §4.1; prerequisite shared with E5 |
| E5 frames / sliding window (`src/core/frame-list.ts`, commit 46440dd) | create1k **65.1 (3.7×)** · replace1k **73.3 (7.9×)** · clear1k **10.7 (12×)** · select20 24.0 (1.6× via list-level sweep) · update10th parity (push already O(dirty), as predicted §1) | **The architecture to pursue** as a compiler-gated fast path for stable inline-element bodies |
| E6 segment-tree validation (commit 6d188d7) | §3.1's micro-claim **partially refuted**: flat typed-array constants invert the asymptotics — setup 228× cheaper than real push wiring, drains tie at d≤10 and win 3–16× at d≥100; push only wins reorder. Architectural caveat stands: bench gets the row index free; cell→row routing re-requires per-row bookkeeping, so still not a drop-in. Bonus finding: **pushReal is 4–6× slower than a minimal push model** — GXT's own drain bookkeeping (dirty-set sort, relatedTags churn, epoch WeakMap) is a standalone optimization target | Don't build as invalidation replacement; revisit as the dirty-routing channel if/when frames (E5) land; fix drain overhead regardless |

Revised landing order based on evidence: **(1)** E4+E5 (one project: static
template + frame fast path) — the create/replace/clear collapse is the
dominant win and survived clean measurement; **(2)** E1 selector with key
pruning; **(3)** drain-overhead diet motivated by E6 (pushReal vs pushMinimal
gap); **(4)** E3 recycling as a documented opt-in for replace-heavy
scenarios; **(5)** E2 as cleanup-only refactor; **skip** standalone binary
validation (unchanged from §3, now with numbers).

## 6. Prior art quick-reference

- **Glimmer-VM**: pull validation over tag combinators — what "binary
  validation" generalizes; GXT deliberately moved *away* from this to push.
- **million.js `block()` / Stage0 / domc / ivi / Vue Vapor**: compile-to-clone
  + slot tables + per-instance frames — Proposal A1.
- **SolidJS `createSelector`**: keyed selector for `selected === id` fan-out —
  §4.2.
- **Svelte 5 each blocks**: per-item effect scopes (closer to GXT today) but
  with template cloning for statics — supports doing (1) before (4).
- **react-window / Ember list-view lineage**: row recycling semantics and its
  keyed-identity caveats — Proposal A2.
