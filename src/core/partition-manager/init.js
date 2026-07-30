import validateFlow from './validate-flow.js';

const init = function ( flow ) {
    // Fail-fast: reject malformed flow config at flow start rather than
    // at first-message time. All three live callers (src/flow/run.js,
    // composer-website demo-runner, benchmark-runner) pass through here.
    validateFlow( flow );

    const composerState = Object.create( null );

    // Two-level structure: partitionId → specializationType → graph
    composerState.partitionSpecializations = new Map();

    composerState.flow = flow;

    // Cumulative counter of partition-creation attempts (accepted or rejected).
    // Pre-cap: equals partitionSpecializations.size. Post-cap: diverges by the
    // rejection count. See ADR-016.
    composerState.totalPartitionsCreated = 0;

    // Yield state (ADR-024): update() sets `yieldPending` when the time
    // threshold is crossed; the flow runtime clears it and takes the
    // event-loop breath after running the message's pipeline.
    composerState.partitionState = Object.create( null );
    composerState.partitionState.lastYield = Date.now();
    composerState.partitionState.yieldPending = false;

    // Registry of sinks that expose getPressure(). Populated by `flow/run.js`
    // immediately after this init returns, by querying the wire-emitters and
    // wire-storages registries. The pressure-aware yield decision (ADR-020,
    // Draft) will read this registry as one of its yield conditions when it
    // lands; until then the registry is forward-compat plumbing.
    //
    // Object.create(null) keyed by 'emitter:<target>' / 'storage:<storageName>'
    // — a runtime-string-keyed registry per the codebase convention. Keys are
    // self-describing in debug logs ("which sink crossed the threshold?"
    // becomes a one-glance answer); for-in iteration over Object.create(null)
    // is allocation-free on the amortized check path.
    composerState.partitionState.backpressureAwareSinks = Object.create( null );

    return composerState;
}; // init()

export default init;
