// nodes/csv-source/simple-csv-parser.js

const SimpleCSV = {
    parse: function ( csvText, config = {} ) {
        // Default configuration
        const options = {
            delimiter: config.delimiter || ',',
            header: config.header !== false,
            dynamicTyping: config.dynamicTyping !== false,
            skipEmptyLines: config.skipEmptyLines !== false,
            transformHeader: config.transformHeader || null,
            transform: config.transform || null,
            comments: config.comments || false,
            quoteChar: config.quoteChar || '"',
            parseDates: config.parseDates || false
        };

        const result = {
            data: [],
            errors: [],
            meta: {
                delimiter: options.delimiter,
                linebreak: '\n',
                aborted: false,
                fields: []
            }
        };

        try {
            // Normalize line breaks
            csvText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            // Split into lines (handling quoted newlines)
            const lines = this.splitLines( csvText, options.quoteChar );

            // Filter empty lines and comments
            const processedLines = lines.filter( (line, index) => {
                if ( options.skipEmptyLines && line.trim() === '' ) return false;
                if ( options.comments && line.trim().startsWith( options.comments ) ) return false;
                return true;
            });

            if ( processedLines.length === 0 ) {
                return result;
            }

            // Parse header if present
            let headers = [];
            let dataStartIndex = 0;

            if ( options.header ) {
                headers = this.parseLine( processedLines[0], options );

                // Transform headers if function provided
                if ( options.transformHeader ) {
                    headers = headers.map( (h) => options.transformHeader( h ) );
                }

                result.meta.fields = headers;
                dataStartIndex = 1;
            }

            // Parse data rows
            for ( let i = dataStartIndex; i < processedLines.length; i += 1 ) {
                const values = this.parseLine( processedLines[i], options );

                if ( values.length === 0 ) continue;

                // Create row object or array
                let row;
                if ( options.header && headers.length > 0 ) {
                    row = {};
                    headers.forEach( (header, index) => {
                        let value = values[index];

                        // Apply dynamic typing
                        if ( options.dynamicTyping ) {
                            value = this.castValue( value, options );
                        }

                        // Apply transform if provided
                        if ( options.transform ) {
                            value = options.transform( value, header );
                        }

                        row[header] = value;
                    });
                } else {
                    row = values.map( (value) => {
                        if ( options.dynamicTyping ) {
                            return this.castValue( value );
                        }
                        return value;
                    });
                }

                result.data.push( row );
            }

        } catch ( error ) {
            result.errors.push({
                type: 'ParseError',
                code: 'ParseError',
                message: error.message,
                row: result.data.length
            });
        }

        return result;
    },

    // Split CSV into lines, respecting quoted newlines
    splitLines: function ( text, quoteChar ) {
        const lines = [];
        let currentLine = '';
        let inQuotes = false;

        for ( let i = 0; i < text.length; i += 1 ) {
            const char = text[i];
            const nextChar = text[i + 1];

            if ( char === quoteChar ) {
                // Check if it's an escaped quote
                if ( nextChar === quoteChar && inQuotes ) {
                    currentLine += quoteChar;
                    i += 1; // Skip next quote
                } else {
                    inQuotes = !inQuotes;
                    currentLine += char;
                }
            } else if ( char === '\n' && !inQuotes ) {
                lines.push( currentLine );
                currentLine = '';
            } else {
                currentLine += char;
            }
        }

        // Don't forget the last line
        if ( currentLine !== '' ) {
            lines.push( currentLine );
        }

        return lines;
    },

    // Parse a single line into values
    parseLine: function ( line, options ) {
        const values = [];
        let currentValue = '';
        let inQuotes = false;
        const delimiter = options.delimiter;
        const quoteChar = options.quoteChar;

        for ( let i = 0; i < line.length; i += 1 ) {
            const char = line[i];
            const nextChar = line[i + 1];

            if ( char === quoteChar ) {
                if ( inQuotes && nextChar === quoteChar ) {
                    // Escaped quote
                    currentValue += quoteChar;
                    i += 1; // Skip next quote
                } else if ( inQuotes && ( nextChar === delimiter || nextChar === undefined || i === line.length - 1 ) ) {
                    // End of quoted value
                    inQuotes = false;
                } else if ( !inQuotes && ( currentValue === '' || currentValue === ' '.repeat( currentValue.length ) ) ) {
                    // Start of quoted value
                    inQuotes = true;
                } else {
                    currentValue += char;
                }
            } else if ( char === delimiter && !inQuotes ) {
                // End of value
                values.push( currentValue.trim() );
                currentValue = '';
            } else {
                currentValue += char;
            }
        }

        // Don't forget the last value
        values.push( currentValue.trim() );

        return values;
    },

    // Convert string values to appropriate types
    castValue: function ( value, options ) {
        if ( value === '' || value === null || value === undefined ) {
            return value;
        }

        // Boolean
        if ( value.toLowerCase() === 'true' ) return true;
        if ( value.toLowerCase() === 'false' ) return false;

        // Number
        if ( !isNaN( value ) && !isNaN( parseFloat( value ) ) ) {
            return value.indexOf( '.' ) > -1 ? parseFloat( value ) : parseInt( value, 10 );
        }

        // Date (only if parseDates is true)
        if ( options.parseDates && (/^\d{4}-\d{2}-\d{2}/).test( value ) ) {
            const date = new Date( value );
            if ( !isNaN( date.getTime() ) ) {
                return date;
            }
        }

        // String (default)
        return value;
    }
};

export default SimpleCSV;
