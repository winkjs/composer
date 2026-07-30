// nodes/test/handbook-coverage.specs.js

/**
 * @fileoverview Handbook coverage contract — the handbook must reflect the code.
 *
 * The developer handbook at `docs/handbook/` is a derived, verified view of the
 * code; the code is the single source of truth. This test reads the code (node
 * registry and each node's `getDSLMetadata().specSchema`, the adapter
 * `configSchema`s, `env-vars.js`, and the semantics schemas) and scans the
 * handbook markdown, then fails the build if:
 *
 *   - a registered node has no entry or is missing from the quick-reference index
 *   - a node option, output stat, adapter option, env var, or semantics property
 *     is not documented where it belongs
 *   - the handbook documents an option that no longer exists in a node's schema
 *   - any OPC-UA reference or emoji appears in the handbook
 *
 * Coverage is a presence check per section, not a full markdown parse — a low
 * false-positive floor that catches the common drift (a new option or node that
 * never made it into the docs). It is deliberately not a prose-quality check.
 *
 * Discovery mirrors registry-consistency.specs.js: a node is DSL-buildable iff
 * its module exports `getDSLMetadata`.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as nodes from '../index.js';
import { csv, mqttSource, mqttEmitter, terminal, questdbAdapter } from '../../composer.js';
import columnSchema, { COLUMN_TYPES } from '../../core/semantics/schemas/column-schema.js';
import assetClassSchema, { insightTypeSchema } from '../../core/semantics/schemas/asset-class-schema.js';
import enumSchema from '../../core/semantics/schemas/enum-schema.js';

// ── Paths ────────────────────────────────────────────────────────────────────
const here = path.dirname( fileURLToPath( import.meta.url ) );
const repoRoot = path.resolve( here, '../../..' );
const handbookDir = path.join( repoRoot, 'docs', 'handbook' );
const nodesDir = path.join( handbookDir, 'nodes' );
const envVarsSrc = path.join( repoRoot, 'src', 'core', 'env-vars.js' );

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_SPEC_FIELDS = new Set( [ 'nodeType', 'name', 'from', 'stats' ] );
// Positional DSL arguments — documented in the DSL syntax, not the Options table.
const POSITIONAL_FIELDS = new Set( [ 'predicate', 'logic' ] );
const NON_OPTION_TOKENS = new Set( [
    'number', 'boolean', 'string', 'object', 'array', 'function', 'true', 'false',
    'null', 'undefined', 'required', 'Option', 'Type', 'Default', 'Description'
] );
// appraise documents the `deviation` sub-field's allowed VALUES as bullets; they
// read as option names to the extractor but are not options.
const ORPHAN_ALLOWLIST = new Set( [
    'identity', 'absolute', 'highExceedance', 'lowExceedance', 'bandExceedance'
] );
// Semantics nested fields mirrored from column-schema.js (not exported); asserted
// so a rename in the schema surfaces here.
const OPS_FIELDS = [ 'criticalLow', 'warningLow', 'target', 'warningHigh', 'criticalHigh', 'hysteresis' ];
const SPEC_FIELDS = [ 'lowerSpecLimit', 'upperSpecLimit', 'target' ];
const RANGE_FIELDS = [ 'min', 'max' ];
const WHEN_KEYS = [ 'column', 'equals', 'oneOf', 'default' ];

// Targeted emoji ranges: pictographs, symbols/dingbats (⚡ ✓ ✗), symbols-and-
// arrows-B, and regional indicators. Geometric shapes (◆ □ ◇), math (⊗), and box
// drawing (╦) sit below these ranges and stay — they are diagram notation.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u;
const OPCUA_RE = /opc[\s-]?ua|OPCUA|opc\.tcp/i;
// The schema SSOT marker property; read via a const key so neither
// no-underscore-dangle nor dot-notation fires.
const PROP_NAMES = '_propertyNames';

// ── Markdown loading ─────────────────────────────────────────────────────────
const loadDir = function ( dir ) {
    const out = {};
    const walk = function ( d ) {
        for ( const entry of readdirSync( d ) ) {
            const full = path.join( d, entry );
            if ( statSync( full ).isDirectory() ) {
                walk( full );
            } else if ( entry.endsWith( '.md' ) ) {
                out[ full ] = readFileSync( full, 'utf8' );
            }
        }
    };
    walk( dir );
    return out;
};

const HB = loadDir( handbookDir );
const NODE_FILES = Object.keys( HB ).filter( ( f ) => f.startsWith( nodesDir + path.sep ) );
const INDEX_MD = HB[ path.join( nodesDir, 'index.md' ) ] || '';
const CONFIG_MD = HB[ path.join( nodesDir, 'configuration.md' ) ] || '';
const ENV_MD = HB[ path.join( handbookDir, 'environment-variables.md' ) ] || '';
const SEM_COLUMNS = HB[ path.join( handbookDir, 'semantics', 'columns.md' ) ] || '';
const SEM_ASSETS = HB[ path.join( handbookDir, 'semantics', 'asset-classes.md' ) ] || '';
const SEM_ENUMS = HB[ path.join( handbookDir, 'semantics', 'enums.md' ) ] || '';

// ── Text helpers (static regexes only) ───────────────────────────────────────
const headingInfo = function ( line ) {
    const m = line.match( /^(#{1,6})\s+(.+?)\s*$/ );
    if ( !m ) return null;
    return { level: m[ 1 ].length, firstWord: m[ 2 ].trim().split( /\s+/ )[ 0 ] };
};

// The section of a doc under the `## name` (or `### name`) heading, up to the
// next heading of the same or higher level.
const sectionFor = function ( fileText, name ) {
    const lines = fileText.split( '\n' );
    let start = -1;
    let level = 0;
    for ( let i = 0; i < lines.length; i += 1 ) {
        const h = headingInfo( lines[ i ] );
        if ( h && h.firstWord === name ) {
            start = i;
            level = h.level;
            break;
        }
    }
    if ( start === -1 ) return null;
    let end = lines.length;
    for ( let i = start + 1; i < lines.length; i += 1 ) {
        const h = headingInfo( lines[ i ] );
        if ( h && h.level <= level ) {
            end = i;
            break;
        }
    }
    return lines.slice( start, end ).join( '\n' );
};

const sectionInNodeFiles = function ( name ) {
    for ( const f of NODE_FILES ) {
        const s = sectionFor( HB[ f ], name );
        if ( s ) return s;
    }
    return null;
};

// The "**Options:**" block of a section, up to the next bold header, code fence,
// or horizontal rule.
const optionsBlockOf = function ( sectionText ) {
    const lines = sectionText.split( '\n' );
    let start = -1;
    for ( let i = 0; i < lines.length; i += 1 ) {
        if ( lines[ i ].includes( '**Options:**' ) ) {
            start = i + 1;
            break;
        }
    }
    if ( start === -1 ) return '';
    const out = [];
    for ( let i = start; i < lines.length; i += 1 ) {
        const ln = lines[ i ];
        if ( ( /^\*\*[A-Z]/ ).test( ln ) || ln.startsWith( '```' ) || ln.startsWith( '---' ) ) {
            break;
        }
        out.push( ln );
    }
    return out.join( '\n' );
};

// Word-boundary presence without a dynamic regex: split into identifier runs.
const wordSet = function ( text ) {
    return new Set( text.split( /[^A-Za-z0-9_]+/ ).filter( Boolean ) );
};

// The first backtick-wrapped identifier on each line — the name column of a
// table row or the leading token of a bullet.
const firstBacktickNames = function ( optsBlk ) {
    const names = [];
    for ( const line of optsBlk.split( '\n' ) ) {
        const m = line.match( /`([A-Za-z_][A-Za-z0-9_]*)`/ );
        if ( m && !NON_OPTION_TOKENS.has( m[ 1 ] ) ) {
            names.push( m[ 1 ] );
        }
    }
    return names;
};

const missingFrom = function ( text, tokens ) {
    const words = wordSet( text );
    return [ ...new Set( tokens ) ].filter( ( t ) => !words.has( t ) );
};

// ── Node registry (mirror registry-consistency.specs.js) ─────────────────────
const dslNodes = Object.keys( nodes )
    .filter( ( n ) => typeof nodes[ n ]?.getDSLMetadata === 'function' )
    .sort();

describe( 'handbook coverage — nodes', function () {

    it( 'discovers the node set (floor guard, not vacuous)', function () {
        expect( dslNodes.length ).to.be.greaterThan( 35 );
    } );

    it( 'every registered node has an entry and a quick-reference row', function () {
        const noEntry = dslNodes.filter( ( n ) => sectionInNodeFiles( n ) === null );
        const indexWords = wordSet( INDEX_MD );
        const noRow = dslNodes.filter( ( n ) => !indexWords.has( n ) );
        expect(
            noEntry.length,
            `nodes with no handbook entry: ${noEntry.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
        expect(
            noRow.length,
            `nodes missing from the quick-reference index: ${noRow.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'every node option appears in its Options block', function () {
        const offenders = [];
        for ( const n of dslNodes ) {
            const specSchema = nodes[ n ].getDSLMetadata().specSchema || {};
            const options = Object.keys( specSchema )
                .filter( ( k ) => !BASE_SPEC_FIELDS.has( k ) && !POSITIONAL_FIELDS.has( k ) );
            const section = sectionInNodeFiles( n ) || '';
            const missing = missingFrom( optionsBlockOf( section ), options );
            if ( missing.length ) offenders.push( `${n}: ${missing.join( ', ' )}` );
        }
        expect(
            offenders.length,
            `undocumented options: ${offenders.join( ' | ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'every node output stat appears in its section', function () {
        const offenders = [];
        for ( const n of dslNodes ) {
            const stats = typeof nodes[ n ].getSupportedStats === 'function' ?
                nodes[ n ].getSupportedStats() : [];
            const section = sectionInNodeFiles( n ) || '';
            const missing = missingFrom( section, stats );
            if ( missing.length ) offenders.push( `${n}: ${missing.join( ', ' )}` );
        }
        expect(
            offenders.length,
            `undocumented output stats: ${offenders.join( ' | ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'documents no option that has been removed from a node schema', function () {
        const offenders = [];
        for ( const n of dslNodes ) {
            const specSchema = nodes[ n ].getDSLMetadata().specSchema || {};
            const known = new Set( Object.keys( specSchema ) );
            const section = sectionInNodeFiles( n ) || '';
            const orphans = firstBacktickNames( optionsBlockOf( section ) )
                .filter( ( d ) => !known.has( d ) && !ORPHAN_ALLOWLIST.has( d ) );
            if ( orphans.length ) offenders.push( `${n}: ${[ ...new Set( orphans ) ].join( ', ' )}` );
        }
        expect(
            offenders.length,
            `orphan options (documented, not in schema): ${offenders.join( ' | ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

} );

describe( 'handbook coverage — adapters and environment', function () {

    it( 'every adapter config option is documented in configuration.md', function () {
        const adapters = { csv, mqttSource, mqttEmitter, terminal, questdbAdapter };
        const configWords = wordSet( CONFIG_MD );
        const offenders = [];
        for ( const [ id, adapter ] of Object.entries( adapters ) ) {
            const schema = adapter && adapter.configSchema;
            if ( schema ) {
                // Keys starting with '_' are validator directives
                // (_propertyNames, _crossFieldValidators), not user
                // options — validateWithSchema skips them the same way.
                const missing = Object.keys( schema )
                    .filter( ( o ) => !o.startsWith( '_' ) )
                    .filter( ( o ) => !configWords.has( o ) );
                if ( missing.length ) offenders.push( `${id}: ${missing.join( ', ' )}` );
            }
        }
        expect(
            offenders.length,
            `undocumented adapter options: ${offenders.join( ' | ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'every env var is documented in the env-vars page', function () {
        const src = readFileSync( envVarsSrc, 'utf8' );
        const names = [ ...new Set(
            [ ...src.matchAll( /process\.env\.([A-Z0-9_]+)/g ) ].map( ( m ) => m[ 1 ] )
        ) ];
        const missing = missingFrom( ENV_MD, names );
        expect(
            missing.length,
            `env vars missing from the env-vars page: ${missing.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

} );

describe( 'handbook coverage — semantics', function () {

    it( 'documents every column schema property, type, and limit field', function () {
        const expected = [
            ...columnSchema[ PROP_NAMES ], ...COLUMN_TYPES,
            ...OPS_FIELDS, ...SPEC_FIELDS, ...RANGE_FIELDS, ...WHEN_KEYS
        ];
        const missing = missingFrom( SEM_COLUMNS, expected );
        expect(
            missing.length,
            `column semantics missing from columns.md: ${missing.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'documents every asset-class and insightType property', function () {
        const expected = [ ...assetClassSchema[ PROP_NAMES ], ...Object.keys( insightTypeSchema ) ];
        const missing = missingFrom( SEM_ASSETS, expected );
        expect(
            missing.length,
            `asset-class semantics missing from asset-classes.md: ${missing.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'documents every enum schema property', function () {
        const missing = missingFrom( SEM_ENUMS, enumSchema[ PROP_NAMES ] );
        expect(
            missing.length,
            `enum semantics missing from enums.md: ${missing.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

} );

describe( 'handbook hygiene', function () {

    it( 'contains no OPC-UA reference', function () {
        const offenders = Object.keys( HB )
            .filter( ( f ) => OPCUA_RE.test( HB[ f ] ) )
            .map( ( f ) => path.relative( repoRoot, f ) );
        expect(
            offenders.length,
            `OPC-UA references found in: ${offenders.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

    it( 'contains no emoji', function () {
        const offenders = Object.keys( HB )
            .filter( ( f ) => EMOJI_RE.test( HB[ f ] ) )
            .map( ( f ) => path.relative( repoRoot, f ) );
        expect(
            offenders.length,
            `emoji found in: ${offenders.join( ', ' ) || '(none)'}`
        ).to.equal( 0 );
    } );

} );
