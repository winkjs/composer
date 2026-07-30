/**
 * @fileoverview Introspection metadata for kalman1d node.
 *
 * Defines supported stats, control methods, capabilities, DSL schema,
 * and default options. All getters return defensive copies.
 *
 * The kalman1d node is a 1-D Kalman filter for model-based state estimation
 * with statistical outlier detection via an innovation gate (chi-squared test).
 *
 * **Compositional value — the innovation signal:**
 * The node's primary differentiator is publishing the innovation (prediction
 * error) as a first-class stat. This enables powerful downstream compositions:
 *
 * - **innovation → appraise**: Detect "temperature is SURPRISING given the
 *   current draw" rather than "temperature is high" — the Kalman model
 *   accounts for expected variation from control inputs, leaving only the
 *   unexplained component as anomaly evidence.
 *
 * - **innovation → esStats → threshold**: Monitor mean(|innovation|) over
 *   time to detect model mismatch and trigger recalibration.
 *
 * - **innovationGate → predict**: Classify the PATTERN of normalized
 *   surprises across multiple signals for fault diagnosis.
 *
 * - **ghost + innovation**: In shadow partitions, innovation grows as
 *   simulated degradation diverges — enabling data-driven prognosis.
 *
 * **Control input generalization:**
 * "Control" is not limited to actuator commands — it is any measurable causal
 * influence: fuel rate → tank level, occupancy → CO2, current → temperature.
 * This makes Kalman applicable wherever an approximate physical model exists.
 */

import { validators } from '../../core/utils/validate/index.js';

// ── Supported Features ──────────────────────────────────────────────────────

const SUPPORTED_STATS = [ 'filtered', 'variance', 'innovation', 'innovationGate' ];

const STAT_DESCRIPTIONS = {
    filtered: 'Optimal state estimate (Kalman-filtered value)',
    variance: 'Estimation error covariance — quantifies uncertainty in the estimate',
    innovation: 'Prediction error (signed): z - H·xHat. The anomaly signal — ' +
                'feeds appraise for surprise detection, esStats for model monitoring',
    innovationGate: 'Normalized innovation squared (chi-squared(1) statistic). ' +
                    'Unitless anomaly score — directly thresholdable with known false-alarm rates'
};

const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state; next measurement auto-initializes',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

const NODE_TYPE = 'Kalman 1d';

const CAPABILITIES = {
    description: 'Model-based state estimation with statistical outlier detection via innovation gating',
    features: [
        'Optimal state estimation for linear systems with Gaussian noise',
        'Control-aware prediction using any causal influence as input',
        'Innovation signal as first-class output for downstream anomaly detection',
        'Statistical outlier detection via Mahalanobis distance (chi-squared gate)',
        'Dual-mode operation: exclude outliers OR track sudden changes (follow mode)',
        'Gap-tolerant prediction with bounded uncertainty growth',
        'Auto-initialization from first measurement',
        'Variance floor prevents filter lock on long-running streams'
    ]
};

// ── Getter Functions (defensive copies) ─────────────────────────────────────

export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( {
    ...CAPABILITIES,
    features: CAPABILITIES.features.slice()
} );

// ── Default Options ─────────────────────────────────────────────────────────

export const DEFAULT_OPTIONS = {
    sensorVariance: 1,
    processVariance: 0.01,
    chi2Threshold: 6.63,
    followMode: false,
    stateTransition: 1,
    measurement: 1,
    controlModel: 0,
    varianceLimit: 100
};

// ── DSL Metadata ────────────────────────────────────────────────────────────

const DSL_METADATA = {
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE
        },
        name: {
            type: 'string',
            required: true,
            validator: validators.identifier,
            error: 'name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'from.x must not contain spaces'
                }
            }
        },

        // ── Control input field (optional) ──────────────────────────
        // Any measurable causal influence: heater power, fuel rate,
        // motor current, occupancy. Not just actuator commands.
        control: {
            type: 'string',
            required: false,
            validator: validators.noSpaces,
            error: 'control field name must not contain spaces'
        },

        // ── Noise covariances ───────────────────────────────────────
        // R: measurement noise variance, in measurement² units. The
        // expected variance of the sensor noise on each measurement.
        // Per-sensor via field-keyed objects.
        sensorVariance: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.sensorVariance,
            validator: validators.positive,
            error: 'sensorVariance must be positive'
        },
        // Q: process noise variance, in state² units. The expected
        // variance of the unmodeled change in state from one step to
        // the next. Used directly in the predict step (PPred = F·P·F + Q).
        // Larger Q → filter trusts new measurements more (responsive).
        // Smaller Q → filter trusts its model more (smoother).
        processVariance: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.processVariance,
            validator: validators.positive,
            error: 'processVariance must be positive'
        },

        // ── Outlier detection ───────────────────────────────────────
        // Chi-squared(1) threshold for innovation gate.
        // 3.84 = 95%, 6.63 = 99%, 10.84 = 99.9%
        chi2Threshold: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.chi2Threshold,
            validator: validators.positive,
            error: 'chi2Threshold must be positive'
        },
        // Follow mode tracks jumps; exclude mode rejects outliers.
        followMode: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.followMode
        },

        // ── State-space model coefficients ──────────────────────────
        // F: state transition (how state evolves between measurements).
        // Default 1 = random walk / constant-state model.
        stateTransition: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.stateTransition
        },
        // H: measurement model (how state appears in measurements).
        // Default 1 = direct observation. H=0 is never valid — makes
        // the state unobservable and causes division by zero in update.
        measurement: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.measurement,
            validator: validators.nonZero,
            error: 'measurement (H) must be nonzero'
        },
        // G: control coefficient. Can be zero (no control), positive
        // (e.g., heater adding heat), or negative (e.g., fuel consumption
        // depleting tank level). Per-sensor via field-keyed objects.
        controlModel: {
            type: 'numberOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.controlModel
        },

        // ── Numerical safeguards ────────────────────────────────────
        // Pmax = varianceLimit * R. Bounds uncertainty growth during
        // prediction-only periods (missing data, gaps).
        varianceLimit: {
            type: 'number',
            required: false,
            default: DEFAULT_OPTIONS.varianceLimit,
            validator: validators.positive,
            error: 'varianceLimit must be positive'
        },

        // ── Output configuration ────────────────────────────────────
        stats: {
            type: 'object',
            required: true,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                required: true,
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        }
    },

    // No cross-field constraints needed:
    // - controlModel != 0 without `control` is valid (control defaults to 0)
    // - All parameter combinations are mathematically valid
    crossFieldValidators: [],

    // Pattern: nameXOutputsOptions
    // DSL: .kalman1d( name, field, { filtered: 'est' }, { control: 'power' } )
    buildSpec: ( name, x, stats, options ) => ( {
        nodeType: NODE_TYPE,
        name,
        from: { x },
        stats,
        ...options
    } )
};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
