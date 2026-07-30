# Orchestration

## controller
A pure orchestrator that watches every message and coordinates other nodes. It evaluates a list of conditions against the message and, on the first match, fires control signals (enable, disable, reset, pause, unpause, flush) at the targeted nodes. The controller reads the message but adds nothing to it — its only purpose is coordination.

**Type:** Control flow
**Mode:** N/A (no data processing)
**Stats:** None
**Options:** a `logic` array — each entry is `{ when, triggers }`, where `when` is a predicate `( msg ) => boolean` and `triggers` is a list of `{ control, targets }`
**Control methods:** None (cannot be controlled by other controllers)
**Reset:** Resets match and error counters. Logic and trigger wiring are preserved.

**Evaluation Semantics:**

| Behavior | Detail |
|----------|--------|
| **First-match-wins** | Conditions evaluated in order; the first predicate returning `=== true` fires, remaining conditions are skipped |
| **Strict equality** | Uses `=== true`, not truthy — predicates must return the boolean `true` |
| **Exception handling** | Predicate exceptions are caught, counted, and logged once per error episode — never propagated |
| **Re-entrancy protection** | If a trigger indirectly causes the same controller to be re-evaluated, the nested evaluation is skipped |
| **Forward control only** | Can only target nodes that appear **after** it in the pipeline |
| **Execution timing** | Triggers execute immediately on the current message, before the message reaches downstream data nodes |

**One control method per trigger:** Each trigger applies a single control method to all its targets, so every target must support that method. Since `reset`, `enable`, `disable`, `pause`, and `unpause` are supported by all processing nodes, you can freely mix node types in those triggers. Only node-specific methods like `flush` (`momentsDigest` and `twStats`) require careful targeting:

```javascript
.controller('adaptive', [{
    when: msg => msg.anomalyScore > 0.9,
    triggers: [
        // enable works on any processing node — safe to mix types
        { control: 'enable', targets: ['esStats', 'correlation'] },
        // flush only works on momentsDigest — keep it separate
        { control: 'flush', targets: ['vibDigest'] }
    ]
}])
```

**Complete Example:**

```javascript
.controller('adaptive-analysis', [{
    when: msg => msg.anomalyScore > 0.9,
    triggers: [
        { control: 'enable', targets: ['esStats', 'correlation'] },
        { control: 'reset', targets: ['baseline'] }
    ]
}, {
    when: msg => msg.anomalyScore < 0.3,
    triggers: [
        { control: 'disable', targets: ['esStats', 'correlation'] }
    ]
}])
// No output — orchestrates other nodes
```

### How the Controller Affects Timing

The controller enables or disables nodes on the **same message** that triggered the condition — not the next one. Here is the same pipeline in two states:

```text
Normal:   msg→ [◆ esMean] → [◆ threshold] → [◇ controller] → [□ esStats] → [□ esCorrelation]
                                                    │
                                           vibration > 2.5? → enable esStats, esCorrelation

Anomaly:  msg→ [◆ esMean] → [◆ threshold] → [◇ controller] → [◆ esStats] → [◆ esCorrelation]
```

When the controller enables `esStats` and `esCorrelation`, those nodes process the same message that triggered the enable.

### Control Methods Reference

The controller sends control signals to target nodes. The available methods depend on node type:

| Control Method | Effect | Supported By |
|----------------|--------|--------------|
| `reset` | Clear state, restart computation | All processing nodes (every node except controller, emitIf, and persistIf) |
| `enable` | Resume processing after disable | All processing nodes (every node except controller, emitIf, and persistIf) |
| `disable` | Skip computation, pass message through | All processing nodes (every node except controller, emitIf, and persistIf) |
| `pause` | Suspend computation; last-known values stay visible via publishTo | All processing nodes (every node except controller, emitIf, and persistIf) |
| `unpause` | Resume computation after pause | All processing nodes (every node except controller, emitIf, and persistIf) |
| `flush` | Force immediate output of partial window | `momentsDigest` and `twStats` |

**Nodes with NO control methods** (cannot be targeted by controller):
- `emitIf`, `persistIf` — side-effect-only nodes
- `controller` — pure orchestrator (cannot be controlled by another controller)

### Gating vs Control vs Emission

Three fundamentally different mechanisms for controlling pipeline behavior:

| | `disable` (control) | `passIf` (filter) | `emitIf` (broadcast) |
|-|---------------------|-------------------|---------------------|
| **What it does** | Node skips computation entirely | Message is dropped | Copy sent to external system |
| **Message flow** | Passes through unchanged | **Stops** — downstream never sees it | Continues unchanged |
| **External effect** | None | None | Emits copy to MQTT/GPIO/terminal |
| **Per-message?** | All messages while disabled | Per-message predicate | Per-message predicate |
| **Reversible** | Yes, via `enable` signal | N/A — new message needed | N/A |
| **State impact** | Changes node state | No state change | No state change |
| **Use case** | Suspend expensive computation | Quality gate, sampling | Alerts, telemetry |

> [!CAUTION]
> **Disabling a node does not reset its downstream consumers.** When a node is disabled, the fields it would normally add are absent from the message. But any downstream node that already consumed those fields retains its last computed state. For example, if threshold was `active: true` when its upstream esMean gets disabled, threshold keeps publishing the stale `true` on every message — it never sees new input to change its mind. Pair `disable` with `reset` on affected downstream nodes to avoid frozen decisions:
> ```javascript
> triggers: [
>     { control: 'disable', targets: ['esMean'] },
>     { control: 'reset', targets: ['threshold'] }
> ]
> ```
