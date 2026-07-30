import { SIGNATURE_PATTERNS } from './consts.js';

const expandXOutputsOptions = function ( meta, nodeArgs, flowState ) {
    const { isNodeNameDuplicate } = flowState;
    const specs = [];
    const seenX = Object.create( null );
    const [ baseName, inputs, outputs, ...balanceArgs ] = nodeArgs;
    // const inputs = args[ 1 ];
    // const outputs = args[ 2 ]

    for ( let i = 0; i < inputs.length; i += 1 ) {
        const param = inputs[ i ];

        if ( seenX[ param ] === 1 ) {
            throw new Error( `WinkComposer/flow: duplicate input found: '${param}'.` );
        }
        seenX[ param ] = 1;

        const instName = `${baseName}_${param}`;
        if ( isNodeNameDuplicate( instName ) ) throw Error( `WinkComposer/flow: duplicate node ${instName} found.` );
        const stats = Object.create( null );
        for ( const st in outputs ) {
            if (Object.prototype.hasOwnProperty.call( outputs, st ) ) {
                const stName = outputs[ st ];
                stats[ st ] = Object.create( null );
                // Fixed fan naming: ${field}_${label}. The same rule forEach uses, so
                // array sugar and forEach name outputs identically. (Overwrites on one
                // path are caught by the build-time guard, check-output-collisions.js.)
                stats[ st ].storeAs = `${param}_${stName}`;
            }
        }

        const spec = meta.buildSpec( instName, param, stats, ...balanceArgs );
        specs.push( spec );
    }

    return specs;
}; // expandXOutputsOptions()

const expandXOptions = function ( meta, nodeArgs, flowState ) {
    const { isNodeNameDuplicate } = flowState;
    const specs = [];
    const seenX = Object.create( null );
    const [ baseName, inputs, ...balanceArgs ] = nodeArgs;

    for ( let i = 0; i < inputs.length; i += 1 ) {
        const param = inputs[ i ];

        if ( seenX[ param ] === 1 ) {
            throw new Error( `WinkComposer/flow: duplicate input found: '${param}'.` );
        }
        seenX[ param ] = 1;

        const instName = `${baseName}_${param}`;
        if ( isNodeNameDuplicate( instName ) ) throw Error( `WinkComposer/flow: duplicate node ${instName} found.` );

        const spec = meta.buildSpec( instName, param, ...balanceArgs );
        specs.push( spec );
    }

    return specs;
}; // expandXOptions()

/**
 * Expand array sugar for single-input nodes into multiple canonical calls.
 * Assumes canonical signature: buildSpec( name, x, storeAs, options )
 * - name is made unique per input as `${baseName}_${param}`
 * - storeAs follows the fixed fan rule `${param}_${stat}` (same as forEach)
 * Returns an array of per-input specs (throws on invalid inputs).
 *
 * nodeArgs: baseName, inputs, outputs, balance stuff
 */
export const expandSingleInputArraySugar = function ( meta, nodeArgs, flowState, pattern ) {
    if ( pattern === SIGNATURE_PATTERNS.nameXOptions ) return expandXOptions( meta, nodeArgs, flowState );
    return expandXOutputsOptions( meta, nodeArgs, flowState );
}; // expandSingleInputArraySugar()
