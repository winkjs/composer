import wireNode from './wire-node.js';
import nodeTypeToModule from './node-type-to-module.js';

const wireLinearGraph = function ( specs, nodeModules, options = {} ) {
    let nextHop = null;

    // Wire in reverse - terminal to root
    for ( let i = specs.length - 1; i >= 0; i -= 1 ) {
        const spec = specs[ i ];
        const moduleName = nodeTypeToModule( spec.nodeType );
        const nodeModule = nodeModules[ moduleName ];

        if (!nodeModule) {
            throw new Error( `composer/wireGraph: Node module '${moduleName}' not found for nodeType '${spec.nodeType}'` );
        }

        const nextHops = nextHop ? [ nextHop ] : [];
        nextHop = wireNode( nodeModule, i, nextHops, options );
    }

    // After loop, nextHop is the root node
    return nextHop;
};

export default wireLinearGraph;
