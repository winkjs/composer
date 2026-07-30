# Flow Control

## passIf
A gate that decides whether each message continues downstream. A predicate function evaluates every message and returns true (pass) or false (drop). Dropped messages are removed from the pipeline — downstream nodes never see them. Unlike a disabled node, which passes messages through unchanged, a dropped message is gone.

The predicate receives two arguments: the message and a monotonically increasing counter that starts at 1 and increments with every message. The counter enables deterministic sampling patterns (e.g. pass every Nth message). If the predicate throws an exception, the message is dropped. The first error per episode is logged to console; repeated errors are suppressed until the predicate recovers. See [What Happens When a Predicate Throws](../flow-language.md#what-happens-when-a-predicate-throws).

**Type:** Condition-based
**Mode:** Single only
**Stats:** None (gate only)
**Options:** None
**Reset:** Resets the message counter to zero.

```javascript
// Simple condition — only pass high-confidence messages
.passIf('quality-gate', msg => msg.confidence > 0.9)

// Downsample — a 1 kHz sensor only needs storage at 10 Hz;
// pass every 100th message to reduce volume without losing cadence
.passIf('downsample', ( msg, counter ) => counter % 100 === 0)

// Skip startup transients — sensors often produce unreliable
// readings for the first few messages after power-on or reset
.passIf('skip-warmup', ( msg, counter ) => counter > 20)
```
