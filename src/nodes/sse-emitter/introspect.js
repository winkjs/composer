import { validators, composerValidators } from '../../core/utils/validate/index.js';

/** Single source of truth for what this node can do */
const SUPPORTED_STATS = [
    'dashboard',
    'alerts',
    'database',
    'monitoring'
];

/** QoS level constants for performance (numeric comparison in hot path) */
export const QOS_FIRE_AND_FORGET = 0;
export const QOS_BEST_EFFORT = 1;
export const QOS_RELIABLE = 2;

/** Human-readable descriptions */
const STAT_DESCRIPTIONS = {
    dashboard: 'Real-time dashboard connections',
    alerts: 'Alert system connections',
    database: 'Database sink connections',
    monitoring: 'System monitoring connections'
};

/** QoS level descriptions */
const QOS_DESCRIPTIONS = {
    [ QOS_FIRE_AND_FORGET ]: 'Fire-and-forget: No queuing, drop on backpressure (fastest)',
    [ QOS_BEST_EFFORT ]: 'Best-effort: Small queue, drop oldest on overflow (balanced)',
    [ QOS_RELIABLE ]: 'Reliable: Large queue, backpressure monitoring (most reliable)'
};

/** The type of this node */
const NODE_TYPE = 'SSE Emitter';

/** Node capabilities */
const CAPABILITIES = {
    description: 'Broadcasts entire messages via Server-Sent Events with configurable QoS levels',
    features: [
        'Terminal node - broadcasts complete pipeline messages',
        'Four endpoint types: dashboard, alerts, database, monitoring',
        'Numeric QoS levels: 0 (fire-and-forget), 1 (best-effort), 2 (reliable)',
        'High-performance broadcasting with buffer reuse',
        'Production-ready connection management'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES } );
export const getQoSDescriptions = () => ( { ...QOS_DESCRIPTIONS } );

// DSL Metadata
const DSL_METADATA = {
    // Validation schema
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE,
            validator: composerValidators.nodeType,
            error: 'Invalid node type'
        },
        name: {
            type: 'string',
            required: true,
            validator: validators.identifier,
            error: 'Name must be a valid JavaScript identifier'
        },
        // Note: No 'from' field - terminal node broadcasts entire message
        port: {
            type: 'number',
            required: false,
            default: 3000,  // Documentation only!
            min: 1024,
            max: 65535,
            integer: true,
            error: 'Port must be between 1024 and 65535'
        },
        maxConnections: {
            type: 'number',
            required: false,
            default: 4,  // Documentation only!
            min: 1,
            max: 10,
            integer: true,
            validator: validators.positiveInteger,
            error: 'Max connections must be between 1 and 10'
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
            propertyNames: SUPPORTED_STATS,  // Array of allowed endpoint names
            propertySchema: {
                type: 'object',
                required: true,
                validator: composerValidators.statSpec,  // Using composerValidator!
                properties: {
                    qos: {
                        type: 'number',
                        required: false,
                        default: 0,  // Documentation only!
                        integer: true,
                        validator: validators.oneOf( [ 0, 1, 2 ] ),
                        error: 'QoS must be 0 (fire-and-forget), 1 (best-effort), or 2 (reliable)'
                    }
                }
            },
            error: 'Stats must define at least one endpoint with valid configuration'
        }
    },

    // 3. Cross-field validators - none needed for SSE Emitter
    crossFieldValidators: [],

    // 4. Build spec from DSL
    buildSpec: function ( port = 3000, maxConnections = 4 ) {
        return {
            nodeType: NODE_TYPE,
            name: '{{AUTO_NAME}}',
            port,
            maxConnections,
            stats: {
                dashboard: { storeAs: 'dashConnected', qos: 0 },  // Default fire-and-forget
                database: { storeAs: 'dbConnected', qos: 2 }      // Default reliable
            }
        };
    },

    acceptsSpecObject: true
};

export const getDSLMetadata = () => ({ ...DSL_METADATA });
