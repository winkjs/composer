/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
};

/** The type of this node */
const NODE_TYPE = 'Partition Manager';

// Attach static metadata once, from our constants by making a shallow copy.
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getNodeType = () => NODE_TYPE.slice();
