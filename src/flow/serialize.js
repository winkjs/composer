/**
 * Function-aware, deterministic serializer for generated modules.
 * - Preserves functions verbatim
 * - Single quotes for strings
 * - Stable key order
 * - Identifier keys unquoted when safe
 * - 4-space indents
 */

const INDENT = 4;

const repeat = function ( n ) {
    return ' '.repeat( n );
}; // repeat()

const isIdentifier = function ( key ) {
    return ( /^[A-Za-z_$][A-Za-z0-9_$]*$/ ).test( key );
}; // isIdentifier()

const escapeString = function ( str ) {
    return str
        .replace( /\\/g, '\\\\' )  // Backslashes first
        .replace( /'/g, '\\\'' )    // Single quotes
        .replace( /\n/g, '\\n' )    // Newlines
        .replace( /\r/g, '\\r' )    // Carriage returns
        .replace( /\t/g, '\\t' );   // Tabs
};

const serializeValue = function ( value, indent ) {
    const pad = repeat( indent );
    const next = indent + INDENT;

    // Handle undefined, null & RegExp explicitly
    if ( value === undefined ) {
        return 'undefined';
    } else if ( value === null ) {
        return 'null';
    } else if ( value instanceof RegExp ) {
        return value.toString();
    }

    const t = typeof value;

    if ( t === 'string' ) {
        return `'${escapeString( value )}'`;
    }

    if ( t === 'number' ) {
        // Handle special numbers
        if ( Number.isNaN( value ) ) return 'NaN';
        if ( value === Infinity ) return 'Infinity';
        if ( value === -Infinity ) return '-Infinity';
        return String( value );
    }

    if ( t === 'boolean' ) {
        return String( value );
    }

    if ( t === 'function' ) {
        const funcStr = value.toString();
        if ( funcStr.includes( '[native code]' ) ) throw Error( 'WinkComposer/flow: only regular or arrow functions are supported.' );
        return funcStr;
    }

    if ( Array.isArray( value ) ) {
        if ( value.length === 0 ) {
            return '[]';
        }
        const parts = [];
        for ( let i = 0; i < value.length; i += 1 ) {
            parts.push( `${repeat( next )}${serializeValue( value[ i ], next )}` );
        }
        return `[\n${parts.join( ',\n' )}\n${pad}]`;
    }

    const keys = Object.keys( value ).sort();
    if ( keys.length === 0 ) {
        return '{}';
    }

    const lines = [];
    for ( let i = 0; i < keys.length; i += 1 ) {
        const k = keys[ i ];
        const v = value[ k ];
        const key = isIdentifier( k ) ? k : `'${k.replace( /'/g, '\\\'' )}'`;
        lines.push( `${repeat( next )}${key}: ${serializeValue( v, next )}` );
    }

    return `{\n${lines.join( ',\n' )}\n${pad}}`;
}; // serializeValue()

/**
 * Serializes a case key for code generation.
 * String keys become quoted, numeric keys remain unquoted.
 *
 * @param {string|number} key - The case key
 * @returns {string} Serialized key for code output
 */
const serializeCaseKey = function ( key ) {
    if ( typeof key === 'string' ) {
        return `'${escapeString( key )}'`;
    }
    return String( key );
}; // serializeCaseKey()

/**
 * Generates a JS module from flow specifications.
 * Supports both single-pipeline (backward compatible) and multi-specialization modes.
 *
 * @param {Object} ctx - Serialization context
 * @param {Array} ctx.imports - List of node modules to import
 * @param {string} ctx.flowName - Name of the flow
 * @param {Array} [ctx.specs] - Single-pipeline specs (backward compatible)
 * @param {Object} [ctx.specsByCase] - Multi-specialization specs keyed by case
 * @param {Array} [ctx.caseOrder] - Order of case keys for deterministic output
 * @returns {string} Generated JS module source code
 */
const serializeModule = function ( ctx ) {
    const imports = ctx.imports || [];

    const importLine = ( imports.length > 0 ) ?
        `import { ${imports.join( ', ' )} } from '../src/nodes/index.js';\n\n` : '';

    let body;

    if ( ctx.specsByCase && ctx.caseOrder ) {
        // Multi-specialization mode: generate entry per case
        const entries = [];
        for ( let i = 0; i < ctx.caseOrder.length; i += 1 ) {
            const key = ctx.caseOrder[ i ];
            const specs = ctx.specsByCase[ key ];
            const serializedKey = serializeCaseKey( key );
            const specsBody = serializeValue( specs, INDENT );
            entries.push( `flowBySpecialization[ ${serializedKey} ] = ${specsBody};` );
        }

        body =
`${importLine}const flowBySpecialization = Object.create( null );

${entries.join( '\n\n' )}

export default flowBySpecialization;
`;
    } else {
        // Single-pipeline mode (backward compatible)
        const specs = ctx.specs || [];
        const specsBody = serializeValue( specs, INDENT );

        body =
`${importLine}const flowBySpecialization = Object.create( null );
flowBySpecialization[ 0 ] = ${specsBody};

export default flowBySpecialization;
`;
    }

    return body;
}; // serializeModule()

export { serializeModule };
