// Flow build-time utilities. The naming-policy helpers (renderName / template
// rendering) were retired when fan naming converged on the fixed
// ${field}_${label} rule shared by the forEach and pick fan constructs.
export { makeCollisionChecker } from './make-collision-checker.js';
export { toKebab } from './to-kebab.js';
