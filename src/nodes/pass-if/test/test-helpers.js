// Shared test fixtures and factory functions for passIf node tests.

export const PASS_IF_NODE_TYPE = 'Pass If';

// ── Reusable spec factory ─────────────────────────────────────────

/**
 * Build a minimal valid passIf spec.
 * @param {string} name - Node instance name (must be a valid identifier).
 * @param {Function} predicate - Two-arg predicate ( msg, counter ) => boolean.
 * @returns {Object} Spec accepted by passIf.init().
 */
export const validSpec = function ( name, predicate ) {
    return {
        nodeType: PASS_IF_NODE_TYPE,
        name,
        predicate
    };
};
