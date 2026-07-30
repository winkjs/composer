// nodes/moments-digest/index.js

/**
 * @fileoverview
 * Moments Digest — numerically stable, windowed M1..M4 with min/max, designed for
 * arbitrary-depth cascades (fan-in = 1 per chain) using a single shared field space.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * TL;DR
 * • Consumes raw samples `msg[ x ]` and produces per-window statistics:
 *   `x_n, x_M1, x_M2, x_M3, x_M4, x_min, x_max` plus a boolean `msg[ name ] = true`.
 * • Central moments are carried as unnormalized sums (Pébay 2008):
 *   M2 = Σ (x−μ)², M3 = Σ (x−μ)³, M4 = Σ (x−μ)⁴. Compute variance/kurtosis downstream.
 * • Supports arbitrary cascade depth: root and all downstream levels read/write the SAME `x_*` keys.
 * • Publishes only on **window completion** or **flush**; on all other ticks it **scrubs** `x_*`
 *   to `undefined` so downstream nodes cannot accidentally ingest partials.
 * • Uniform flush key: `x_flush`. **Only the root sets it;** cascades react to it.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Execution model (per message)
 * The node is split into three conceptual phases. All state mutation happens in
 * `update()`; `publishTo()` is a pure renderer of what `update()` planned.
 *
 * 1) Prelude (top of update)
 *    • Clear last tick's publish plan: `planPublish = false`, `propagateFlush = false`.
 *    • ROOT ONLY: If flush is latched:
 *        – If `n > 0`: **copy → reset → planPublish** (publish the snapshot this tick).
 *          Root sets `propagateFlush = true` so `publishTo()` will emit `x_flush`.
 *        – If `n === 0`: **signal-only flush**. Root sets `propagateFlush = true`,
 *          but does not plan a stats publish (no data to emit).
 *    • CASCADE: Does NOT handle flush in prelude (deferred to after ingestion).
 *
 * 2) Core update
 *    • Raw level: read `msg[ x ]`; if non-finite → mark input invalid and return (no plan).
 *      Otherwise, update moments and counters with the new sample.
 *    • Cascade level:
 *        – **Always merge when** `msg[ x_n ] !== undefined` (ingest parent's moments).
 *        – **After ingestion**, if `msg[ x_flush ] === true` and `n > 0`:
 *          **copy → reset → planPublish** (ensures cascade includes parent's flush data).
 *
 * 3) Epilogue (end of update)
 *    • If the window just completed (and no flush snapshot was already planned, and input is valid):
 *        – **copy → reset → planPublish** (publish the completed window this tick).
 *
 * 4) publishTo (pure render; no state mutation)
 *    • If `propagateFlush === true` and this is the root: set `msg[ x_flush ] = true`.
 *    • If `planPublish === true`: write all `x_*` fields **from the snapshot** and set `msg[ name ] = true`.
 *    • Otherwise (non-publish tick): scrub `x_*` to `undefined`. Never touch `x_flush`.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * "Before/After" semantics (UX via placement)
 * • Controller **upstream of the root** ("BEFORE"):
 *     – Flush latch is seen in Prelude on the **same** message → snapshot/reset now.
 *       The current message becomes the **first sample of the next window**.
 *       Root publishes the snapshot and emits `x_flush`; cascades see `x_flush`,
 *       ingest parent's moments FIRST, then publish their accumulated state and reset.
 * • Controller **downstream of the root** ("AFTER"):
 *     – Flush latch is seen on the **next** message. The previous message is included
 *       in the snapshot that publishes next tick. (If no next message arrives, nothing
 *       triggers the deferred publish — controller may emit a final synthetic tick if needed.)
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Inputs
 * • from.x        : string (required)  → base field name, e.g., 'temperature'.
 * • windowSize    : number (required)  → samples per window at this level (≥ 4).
 * • name          : string (optional)  → node identifier; sets `msg[ name ] = true` on publish.
 * • cascade       : boolean (optional) → false for raw level, true for cascade level.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Outputs (on publish)
 * • msg[ x + '_n'   ] : number
 * • msg[ x + '_M1'  ] : number (mean)
 * • msg[ x + '_M2'  ] : number (Σ centered squares)
 * • msg[ x + '_M3'  ] : number (Σ centered cubes)
 * • msg[ x + '_M4'  ] : number (Σ centered fourth powers)
 * • msg[ x + '_min' ] : number
 * • msg[ x + '_max' ] : number
 * • msg[ name ]       : true (flag marking "this node published now")
 * • msg[ x + '_flush' ] : true (root only, on flush ticks)
 *
 * On non-publish cycles, **all** `x_*` fields are set to `undefined` (keys kept, never deleted).
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Flush semantics (action + state)
 * • Root:
 *     – A flush request latches a boundary. In Prelude the node **copies → resets → plans**
 *       a publish from the snapshot (if `n > 0`) and will **emit `x_flush`** at publish time.
 *     – If `n === 0`, it is a **signal-only** flush: emit `x_flush` without stats.
 * • Cascades:
 *     – Never set/clear `x_flush`. They **observe** `x_flush` and publish accumulated state.
 *     – Critical: cascades ingest parent's moments BEFORE handling flush, ensuring
 *       parent's flush data is included in cascade's flush output (no data loss).
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * NaN / invalid input handling
 * • Raw level:
 *     – A non-finite current input suppresses planning of a **window** publish.
 *     – A **flush snapshot planned in Prelude** still publishes this tick; `publishTo()`
 *       does not early-bail on invalid input. This preserves the boundary and keeps
 *       cascades aligned (root still emits `x_flush`).
 * • Cascade level:
 *     – No raw input is read. The node merges only when `x_*` fields are present.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Invariants
 * • Uniform flush key across the chain: `x_flush` (root only writes).
 * • No data loss: cascades always ingest before responding to flush.
 * • Scrub on every non-publish tick: `x_*` → `undefined`.
 * • Publish is **snapshot-only**; `publishTo()` never mutates node state.
 * • O(1) time and O(1) memory per message; no hot-path allocations (snapshot object is reused).
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * References
 * [1] Pébay, P. (2008). Formulas for robust, one-pass parallel computation of covariances
 *     and arbitrary-order statistical moments. Sandia Report SAND2008-6212.
 * [2] Chan, T. F., Golub, G. H., & LeVeque, R. J. (1983). Algorithms for computing the
 *     sample variance: Analysis and recommendation. The American Statistician, 37(3), 242-247.
 */

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
export { default as flush } from './flush.js';
// Direct imports for common control functions
export { default as disable } from '../../core/utils/node/disable.js';
export { default as enable } from '../../core/utils/node/enable.js';
export { default as pause } from '../../core/utils/node/pause.js';
export { default as unpause } from '../../core/utils/node/unpause.js';
// Re-export everything from introspection.js
export * from './introspect.js';
