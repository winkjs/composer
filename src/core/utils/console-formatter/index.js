/**
 * Console Formatter for WinkComposer
 *
 * Provides rich, colored console output with structured formatting
 * for development, debugging, and edge device monitoring.
 */

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',

    // Background colors
    bgRed: '\x1b[41m',
    bgYellow: '\x1b[43m',
    bgGreen: '\x1b[42m'
};

// Method-specific configurations
const methodConfig = {
    log: {
        color: colors.reset,
        symbol: '  ',
        label: 'INFO'
    },
    warn: {
        color: colors.yellow,
        symbol: '⚠️ ',
        label: 'WARN'
    },
    error: {
        color: colors.red,
        symbol: '✗ ',
        label: 'ERROR'
    },
    table: {
        color: colors.cyan,
        symbol: '📊',
        label: 'DATA'
    },
    debug: {
        color: colors.gray,
        symbol: '🔍',
        label: 'DEBUG'
    },
    success: {
        color: colors.green,
        symbol: '✓ ',
        label: 'OK'
    },
    critical: {
        color: `${colors.bright}${colors.bgRed}${colors.white}`,
        symbol: '🔴',
        label: 'CRITICAL'
    }
};

/**
 * Format timestamp for console output
 */
const formatTimestamp = function () {
    const now = new Date();
    const time = now.toTimeString().split( ' ' )[ 0 ];  // HH:MM:SS
    const ms = now.getMilliseconds().toString().padStart( 3, '0' );
    return `${colors.gray}[${time}.${ms}]${colors.reset}`;
}; // formatTimestamp()

/**
 * Format node identifier
 */
const formatNodeId = function ( partitionKey ) {
    const partition = partitionKey ? `/${partitionKey}` : '';
    return `${colors.cyan}[${partition}]${colors.reset}`;
}; // formatNodeId()

/**
 * Format structured data for console
 */
const formatData = function ( data, indent = 2 ) {
    if ( data === null || data === undefined ) {
        return `${colors.gray}(empty)${colors.reset}`;
    }

    if ( typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' ) {
        return String( data );
    }

    // For objects, create indented key-value display
    const spaces = ' '.repeat( indent );
    const lines = [];

    for ( const [ key, value ] of Object.entries( data ) ) {
        const formattedKey = `${colors.bright}${key}:${colors.reset}`;

        // Handle different value types
        let formattedValue;
        if ( typeof value === 'object' && value !== null ) {
            // Nested object - use JSON stringify with indent
            formattedValue = JSON.stringify( value, null, 2 )
                .split( '\n' )
                .map( ( line, i ) => ( i === 0 ? line : spaces + line ) )
                .join( '\n' );
        } else if ( typeof value === 'string' ) {
            formattedValue = `"${value}"`;
        } else {
            formattedValue = String( value );
        }

        lines.push( `${spaces}${formattedKey} ${formattedValue}` );
    }

    return lines.join( '\n' );
}; // formatData()

/**
 * Create formatted console output
 */
const createConsoleFormatter = function () {

    /**
     * Format and emit to console
     *
     * @param {string} method - Console method (log, warn, error, table)
     * @param {Object} data - Data to output
     * @param {string} [partitionKey] - Optional partition identifier
     * @param {Object} [metadata] - Optional metadata (UNS, etc.)
     */
    const format = function ( method, data, partitionKey, metadata ) {
        const config = methodConfig[ method ] || methodConfig.log;

        // Build header line
        const timestamp = formatTimestamp();
        const nodeId = formatNodeId( partitionKey );
        const header = `${config.symbol} ${timestamp} ${nodeId}`;

        // Handle table method specially
        if ( method === 'table' && ( Array.isArray( data ) || typeof data === 'object' ) ) {
            console.log( `${header} ${config.color}[TABLE]${colors.reset}` );
            console.table( data );
            return;
        }

        // Handle critical alerts with emphasis
        if ( method === 'critical' ) {
            console.log( `\n${config.color} ${config.label} ${colors.reset}` );
            console.log( header );
            console.log( formatData( data, 4 ) );
            console.log( `${config.color} ${'═'.repeat( 40 )} ${colors.reset}\n` );
            return;
        }

        // Standard formatted output
        const output = [];
        output.push( header );

        // Add metadata if present (UNS path, etc.)
        if ( metadata?.uns ) {
            output.push( `  ${colors.gray}UNS: ${metadata.uns}${colors.reset}` );
        }

        // Format main data
        if ( typeof data === 'string' ) {
            output.push( `  ${config.color}${data}${colors.reset}` );
        } else {
            output.push( formatData( data, 2 ) );
        }

        // Output using appropriate console method
        const consoleMethod = [ 'log', 'warn', 'error', 'table' ].includes( method ) ? method : 'log';

        console[ consoleMethod ]( output.join( '\n' ) );
    }; // format()

    /**
     * Create separator line for visual grouping
     */
    const separator = function ( label, char = '═' ) {
        const line = char.repeat( 40 );
        if ( label ) {
            console.log( `${colors.cyan}${line}${colors.reset}` );
            console.log( `${colors.bright}${colors.cyan}   ${label}${colors.reset}` );
            console.log( `${colors.cyan}${line}${colors.reset}` );
        } else {
            console.log( `${colors.gray}${line}${colors.reset}` );
        }
    }; // separator()

    return {
        format: format,
        separator: separator,
        colors: colors  // Export for custom formatting
    };
}; // createConsoleFormatter()

export default createConsoleFormatter;
