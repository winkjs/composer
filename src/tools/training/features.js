// src/tools/training/features.js

/**
 * @fileoverview Declarative feature extraction for physics-informed models.
 *
 * Three schema builders describe how to extract features from raw records:
 *   group()   — aggregate across symmetric channels (enforces physics symmetry)
 *   scalar()  — extract a single numeric value
 *   counter() — count entries satisfying a predicate
 *
 * buildExtractor() compiles a schema into { extract, names, width }.
 * The compiled extract() produces a fixed-width numeric vector from each
 * record, suitable for logistic regression or any classifier.
 *
 * Design principle: group() is the physics constraint — it aggregates
 * per-channel values into layer-level statistics, making the model
 * structurally unable to learn channel-specific preferences.
 */

const GROUP = 'group';
const SCALAR = 'scalar';
const COUNTER = 'counter';

const AVAILABLE_STATS = [ 'max', 'sum', 'countAbove' ];

/**
 * Schema builder: aggregate across symmetric channels.
 *
 * The group constraint enforces physics symmetry — the model sees
 * layer-level aggregates, not individual channel values. Each stat
 * becomes a separate feature named `{name}_{stat}`.
 *
 * @param {string} name — base name for generated features (e.g. 'mass').
 * @param {string[]} ids — channel identifiers (e.g. ['T1', 'T3', 'T4']).
 * @param {Function} accessor — ( record, id ) → number. Extracts a value per channel.
 * @param {object} [options] — { stats: string[], countAboveThreshold: number }.
 * @returns {object} column descriptor.
 */
const group = function ( name, ids, accessor, options ) {
    if ( typeof name !== 'string' || name.length === 0 ) {
        throw new Error( 'features.group: name must be a non-empty string' );
    }
    if ( !Array.isArray( ids ) || ids.length === 0 ) {
        throw new Error( 'features.group: ids must be a non-empty array' );
    }
    if ( typeof accessor !== 'function' ) {
        throw new Error( 'features.group: accessor must be a function' );
    }

    const stats = ( options && Array.isArray( options.stats ) ) ?
        options.stats :
        [ 'max', 'sum', 'countAbove' ];

    for ( let i = 0; i < stats.length; i += 1 ) {
        if ( AVAILABLE_STATS.indexOf( stats[ i ] ) === -1 ) {
            throw new Error(
                'features.group: unknown stat "' + stats[ i ] +
                '". Available: ' + AVAILABLE_STATS.join( ', ' )
            );
        }
    }

    const countAboveThreshold = ( options && options.countAboveThreshold !== undefined ) ?
        options.countAboveThreshold :
        1.5;

    if ( typeof countAboveThreshold !== 'number' ) {
        throw new Error( 'features.group: countAboveThreshold must be a number' );
    }

    return {
        type: GROUP,
        name: name,
        ids: ids,
        accessor: accessor,
        stats: stats,
        countAboveThreshold: countAboveThreshold
    };
};

/**
 * Schema builder: extract a single numeric value.
 *
 * Use for features that are already aggregate or unique (e.g. T6 coupling
 * z-score, cross-tank Mahalanobis distance).
 *
 * @param {string} name — feature name.
 * @param {Function} accessor — ( record ) → number.
 * @returns {object} column descriptor.
 */
const scalar = function ( name, accessor ) {
    if ( typeof name !== 'string' || name.length === 0 ) {
        throw new Error( 'features.scalar: name must be a non-empty string' );
    }
    if ( typeof accessor !== 'function' ) {
        throw new Error( 'features.scalar: accessor must be a function' );
    }
    return { type: SCALAR, name: name, accessor: accessor };
};

/**
 * Schema builder: count entries satisfying a predicate.
 *
 * Unlike group(), the set of items is dynamic — determined at extraction
 * time from the source object's keys. Use for violation counts where the
 * item set may vary per record.
 *
 * @param {string} name — feature name.
 * @param {Function} sourceAccessor — ( record ) → object. Returns the source object.
 * @param {Function} predicate — ( entry ) → boolean. Tests each value.
 * @returns {object} column descriptor.
 */
const counter = function ( name, sourceAccessor, predicate ) {
    if ( typeof name !== 'string' || name.length === 0 ) {
        throw new Error( 'features.counter: name must be a non-empty string' );
    }
    if ( typeof sourceAccessor !== 'function' ) {
        throw new Error( 'features.counter: sourceAccessor must be a function' );
    }
    if ( typeof predicate !== 'function' ) {
        throw new Error( 'features.counter: predicate must be a function' );
    }
    return { type: COUNTER, name: name, sourceAccessor: sourceAccessor, predicate: predicate };
};

/**
 * Compile a feature schema into an extractor.
 *
 * Validates the schema for structural consistency (unique names, known
 * column types) and returns a compiled { extract, names, width } object.
 *
 * @param {object[]} schema — array of column descriptors from group/scalar/counter.
 * @returns {{ extract: Function, names: string[], width: number }}
 */
const buildExtractor = function ( schema ) {
    if ( !Array.isArray( schema ) || schema.length === 0 ) {
        throw new Error( 'features.buildExtractor: schema must be a non-empty array' );
    }

    // Build feature names from schema
    const names = [];
    for ( let i = 0; i < schema.length; i += 1 ) {
        const col = schema[ i ];
        if ( col.type === GROUP ) {
            for ( let s = 0; s < col.stats.length; s += 1 ) {
                names.push( col.name + '_' + col.stats[ s ] );
            }
        } else if ( col.type === SCALAR || col.type === COUNTER ) {
            names.push( col.name );
        } else {
            throw new Error(
                'features.buildExtractor: unknown column type "' +
                String( col.type ) + '" at index ' + i
            );
        }
    }

    // Validate unique names
    const seen = Object.create( null );
    for ( let i = 0; i < names.length; i += 1 ) {
        if ( seen[ names[ i ] ] ) {
            throw new Error(
                'features.buildExtractor: duplicate feature name "' + names[ i ] + '"'
            );
        }
        seen[ names[ i ] ] = true;
    }

    const width = names.length;

    /**
     * Extract a fixed-width feature vector from a record.
     * @param {object} record — raw input record.
     * @returns {number[]} feature vector of length `width`.
     */
    const extract = function ( record ) {
        const v = new Array( width );
        let idx = 0;

        for ( let i = 0; i < schema.length; i += 1 ) {
            const col = schema[ i ];

            if ( col.type === GROUP ) {
                let max = 0;
                let sum = 0;
                let countAbove = 0;

                for ( let j = 0; j < col.ids.length; j += 1 ) {
                    const val = col.accessor( record, col.ids[ j ] );
                    if ( val > max ) max = val;
                    sum += val;
                    if ( val > col.countAboveThreshold ) countAbove += 1;
                }

                for ( let s = 0; s < col.stats.length; s += 1 ) {
                    const stat = col.stats[ s ];
                    if ( stat === 'max' ) {
                        v[ idx ] = max;
                    } else if ( stat === 'sum' ) {
                        v[ idx ] = sum;
                    } else {
                        v[ idx ] = countAbove;
                    }
                    idx += 1;
                }
            } else if ( col.type === SCALAR ) {
                v[ idx ] = col.accessor( record );
                idx += 1;
            } else {
                const source = col.sourceAccessor( record );
                const keys = Object.keys( source );
                let count = 0;
                for ( let k = 0; k < keys.length; k += 1 ) {
                    if ( col.predicate( source[ keys[ k ] ] ) ) count += 1;
                }
                v[ idx ] = count;
                idx += 1;
            }
        }

        return v;
    };

    return { extract: extract, names: names, width: width };
};

export { group, scalar, counter, buildExtractor };
