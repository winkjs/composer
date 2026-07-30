const nodeTypeToModule = function ( nodeType ) {
    // Trim to handle any whitespace issues
    const trimmed = nodeType.trim();

    // Handle acronyms and simple names
    if ( trimmed === trimmed.toUpperCase() ) {
        return trimmed.toLowerCase();
    }

    // Handle multi-word names: 'Page Hinkley' → 'pageHinkley'
    return trimmed
        .split(' ')
        .map( ( word, i ) => ( i === 0 ? word.toLowerCase() : word ) )
        .join('');
};

export default nodeTypeToModule;
