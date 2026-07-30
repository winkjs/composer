// core/batch/index.js
// Purpose:
//   Batch data handling subsystem for efficient transmission of tabular data.
//   Provides sliding windows for history retention and encoders for compression.

export { createAooEncoder } from './aoo-encoder.js';
export { createWindow } from './sliding-window.js';

// These work together:
// 1. Window maintains recent history (sliding-window.js)
// 2. Encoder compresses for transmission (aoo-encoder.js)
// 3. Both use same field order for structure stability
