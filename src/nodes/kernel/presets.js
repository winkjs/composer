/**
 * @fileoverview Scientifically validated filter kernels for common streaming operations.
 *
 * Each preset is optimized for specific use cases in industrial, financial,
 * and quality control applications. Kernels are defined in newest-to-oldest
 * order (kernel[0] = weight for x[n]).
 */

const PRESETS = Object.create( null );
// Basic smoothing operations
PRESETS.smooth3 = [ 0.25, 0.5, 0.25 ];                      // 3-point Gaussian approximation
PRESETS.smooth5 = [ 0.1, 0.2, 0.4, 0.2, 0.1 ];              // 5-point Gaussian approximation

// Derivatives
PRESETS.rate = [ -1, 1 ];                                   // Simple difference (1st derivative)
PRESETS.rate3 = [ -1, 0, 1 ];                               // Centered difference (less noise)
PRESETS.accel = [ 1, -2, 1 ];                               // 2nd derivative (acceleration)

// Savitzky-Golay filters (preserves peaks while smoothing)
PRESETS.sg5 = [ -3 / 35, 12 / 35, 17 / 35, 12 / 35, -3 / 35 ]; // 5-point, 2nd order polynomial
PRESETS.sg7 = [ -2 / 21, 3 / 21, 6 / 21, 7 / 21, 6 / 21, 3 / 21, -2 / 21 ]; // 7-point, 2nd order
PRESETS.sgRate5 = [ -2 / 10, -1 / 10, 0, 1 / 10, 2 / 10 ];     // SG 1st derivative

// Trend kernels — Savitzky-Golay 1st-derivative (slope) filters, with
// the sign chosen so that a rising signal produces a POSITIVE slope and
// a falling signal produces a NEGATIVE slope. This matches the standard
// calculus/academic convention and reads naturally in thresholding code:
// `threshold({ below: -0.06 })` fires on a downward trend.
//
// Note: the older `sgRate5` preset uses the opposite sign (falling →
// positive) because kernel weights are user-defined newest-to-oldest
// and sgRate5 pre-dates this convention discussion. The trend family
// is independent — use these when the sign should read as a slope.
//
// weights_i = −i / Σi²   for i = −N..N (newest-to-oldest user order).
// Wider windows trade latency for smoothness: trend5 is the most
// responsive, trend11 the smoothest. Pair with threshold +
// persistenceCheck to detect sustained rising or falling trends.
// Reference: Savitzky & Golay (1964), Anal. Chem. 36(8), 1627.
PRESETS.trend5  = [ 2 / 10, 1 / 10, 0, -1 / 10, -2 / 10 ];            // Σi² = 10
PRESETS.trend7  = [ 3 / 28, 2 / 28, 1 / 28, 0, -1 / 28, -2 / 28, -3 / 28 ];  // Σi² = 28
PRESETS.trend9  = [ 4 / 60, 3 / 60, 2 / 60, 1 / 60, 0,
                    -1 / 60, -2 / 60, -3 / 60, -4 / 60 ];              // Σi² = 60
PRESETS.trend11 = [ 5 / 110, 4 / 110, 3 / 110, 2 / 110, 1 / 110, 0,
                    -1 / 110, -2 / 110, -3 / 110, -4 / 110, -5 / 110 ]; // Σi² = 110

// Binomial filters (optimal noise reduction)
PRESETS.binomial5 = [ 1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16 ]; // Pascal's triangle row 4
PRESETS.binomial7 = [ 1 / 64, 6 / 64, 15 / 64, 20 / 64, 15 / 64, 6 / 64, 1 / 64 ]; // Row 6

// Industrial process control
PRESETS.debounce5 = [ 0.1, 0.2, 0.4, 0.2, 0.1 ];            // Digital signal debouncing

// Detection filters
PRESETS.spike3 = [ -1, 2, -1 ];                             // Spike/transient detection
PRESETS.edge5 = [ -1, -1, 5, -1, -1 ];                      // Edge enhancement (Laplacian)
PRESETS.impulse = [ 0.25, -1, 1.5, -1, 0.25 ];              // Impulse/event detection

// Mechanical/vibration analysis
PRESETS.shock = [ 1, -2, 1 ];                               // Shock/impact detection
PRESETS.jerk = [ -1, 3, -3, 1 ];                            // 3rd derivative (jerk)
PRESETS.envelope = [ 0.1, 0.15, 0.5, 0.15, 0.1 ];           // Envelope extraction

// Business/financial metrics
PRESETS.momentum5 = [ -0.3, -0.1, 0, 0.1, 0.3 ];            // Weighted momentum
PRESETS.volatility = [ -1, 2, -1 ];                         // Local variance proxy

export default PRESETS;

// Helper to validate preset names
export const isValidPreset = ( name ) => Object.prototype.hasOwnProperty.call( PRESETS, name );

// Get list of all preset names for validation
export const getPresetNames = () => Object.keys( PRESETS );
