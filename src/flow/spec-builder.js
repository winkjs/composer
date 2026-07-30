const buildStatsFromOutputs = function ( outputs ) {
    const stats = Object.create( null );
    const seenStoreAs = Object.create( null );

    // eslint-disable-next-line guard-for-in
    for ( const stat in outputs ) {
        const storeAs = outputs[ stat ];

        // A duplicate storeAs within one node is always a mistake (two stats fighting
        // over one field), so it throws here. Duplicates ACROSS nodes on one path are the
        // overwrite case, caught at build time by check-output-collisions.js.
        if ( seenStoreAs[ storeAs ] ) {
            throw new Error(
                `WinkComposer/flow: Node has duplicate storeAs '${storeAs}' ` +
                `for stats '${seenStoreAs[ storeAs ]}' and '${stat}'`
            );
        }

        seenStoreAs[ storeAs ] = stat;

        stats[ stat ] = Object.create( null );
        stats[ stat ].storeAs = storeAs;
    }

    return stats;
};

export const specBuilder = function ( meta ) {
    const patterns = Object.create( null );

    patterns.NAME_PREDICATE_OPTIONS = function ( params ) {
        const [ name, predicate, options ] = params;
        return meta.buildSpec( name, predicate, options );
    };

    patterns.NAME_PREDICATE_OUTPUTS_OPTIONS = function ( params ) {
        const [ name, predicate, outputs, options ] = params;
        const stats = buildStatsFromOutputs( outputs );
        return meta.buildSpec( name, predicate, stats, options );
    };

    patterns.NAME_LOGIC = function ( params ) {
        const [ name, logic ] = params;
        return meta.buildSpec( name, logic );
    };

    patterns.NAME_X_OUTPUTS_OPTIONS = function ( params ) {
        const [ name, x, outputs, options ] = params;
        const stats = buildStatsFromOutputs( outputs );
        return meta.buildSpec( name, x, stats, options );
    };

    patterns.NAME_X_Y_OUTPUTS_OPTIONS = function ( params ) {
        const [ name, x, y, outputs, options ] = params;
        const stats = buildStatsFromOutputs( outputs );
        return meta.buildSpec( name, x, y, stats, options );
    };

    patterns.NAME_X_OPTIONS = function ( params ) {
        const [ name, x, options ] = params;
        return meta.buildSpec( name, x, options );
    };

    return patterns;
}; // specBuilder()
