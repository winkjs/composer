/**
 * @fileoverview Pre-built transform helpers — pure math primitives.
 *
 * Each helper is a single-argument pure function suitable for the
 * transform node's `using` option. Helpers carry a `.semantics`
 * property for introspection, consistent with tunable helpers.
 *
 * @example
 * import { square, abs } from '@winkjs/composer';
 * .transform( 'sq', 'ecgDeriv', { result: 'ecgSquared' }, { using: square } )
 */

/** Squares the input: x * x */
export const square = ( x ) => ( x * x );
square.semantics = { type: 'transform', name: 'square', formula: 'x * x' };

/** Absolute value: |x| */
export const abs = ( x ) => Math.abs( x );
abs.semantics = { type: 'transform', name: 'abs', formula: '|x|' };

/** Square root: √x (NaN if x < 0) */
export const sqrt = ( x ) => Math.sqrt( x );
sqrt.semantics = { type: 'transform', name: 'sqrt', formula: '√x' };

/** Natural logarithm: ln(x) (-Infinity if x = 0, NaN if x < 0) */
export const log = ( x ) => Math.log( x );
log.semantics = { type: 'transform', name: 'log', formula: 'ln(x)' };

/** Base-10 logarithm: log₁₀(x) (-Infinity if x = 0, NaN if x < 0) */
export const log10 = ( x ) => Math.log10( x );
log10.semantics = { type: 'transform', name: 'log10', formula: 'log₁₀(x)' };

/** Reciprocal: 1/x (Infinity if x = 0) */
export const reciprocal = ( x ) => ( 1 / x );
reciprocal.semantics = { type: 'transform', name: 'reciprocal', formula: '1/x' };

/** Negation: -x */
export const negate = ( x ) => ( -x );
negate.semantics = { type: 'transform', name: 'negate', formula: '-x' };
