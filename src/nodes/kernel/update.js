/**
 * @fileoverview Core FIR convolution for kernel node (hot path).
 *
 * Pushes each valid input into a doubled ring buffer — each value is written
 * at `buffer[ head ]` AND `buffer[ head + size ]` so the convolution window
 * is always contiguous at `buffer[ head .. head + size - 1 ]`, eliminating
 * the wrap branch inside the inner loop. Push and fullness check are
 * inlined. The kernel array has been reversed at init (see init.js) so the
 * buffer is read oldest-to-newest with the kernel indexed 0..L-1.
 *
 * Zero allocations in the hot path — all arithmetic on pre-allocated
 * structures created in init(). Fault isolation via `inputValidationFailed`
 * flag propagates NaN downstream through publishTo().
 *
 * References:
 *  - Oppenheim & Schafer, "Discrete-Time Signal Processing", Ch. 2.3
 *    (Convolution Sum).
 *  - "Duplicated head" ring-buffer pattern (FFTW small-transform codelets,
 *    https://www.fftw.org/fftw-paper-ieee.pdf Sec. III.B).
 *  - Benchmark: 2.2-2.6× speedup vs. the prior single-size ring
 *    implementation (measured; ADR-012).
 */

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: flag and continue — downstream sees NaN
    if ( !Number.isFinite( xVal ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    const ring = state.ring;
    const size = ring.size;
    const buffer = ring.buffer;
    let head = ring.head;

    // Doubled-buffer push: write at head AND head + size.
    // Head advances within [ 0, size ); the mirror half makes the read
    // window contiguous without a modulus or wrap branch.
    buffer[ head ] = xVal;
    buffer[ head + size ] = xVal;
    head = ( head + 1 < size ) ? head + 1 : 0;
    ring.head = head;

    // Warmup: grow `used` up to `size`, then skip convolution while still
    // partial. Once `used === size` on the current push, fall through to
    // compute the first convolution output on that same message — matches
    // baseline semantics (fill-then-compute on the boundary push).
    if ( ring.used < size ) {
        ring.used += 1;
        if ( ring.used < size ) return state;
    }

    // Contiguous convolution — no wrap branch in the inner loop.
    const kernel = state.kernel;
    const kernelLength = state.kernelLength;
    let sum = 0;
    for ( let i = 0; i < kernelLength; i += 1 ) {
        sum += buffer[ head + i ] * kernel[ i ];
    }

    state.result = sum;
    return state;
}; // update()

export default update;
